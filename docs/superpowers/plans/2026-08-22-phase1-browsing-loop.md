# 阶段 1 · 浏览闭环（Plaza · Pet Detail · Nearby）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付「可完整演示」的浏览闭环：广场双层筛选 + 瀑布流、宠物详情、周边 POI 列表 + 场所详情 + 收藏，服务端接入 PostgreSQL 16 + PostGIS 地理查询。

**Architecture:** 服务端 NestJS 增加 DatabaseModule（raw `pg`、懒连接池、SQL 迁移 + 种子），users/pets/venues 三个域均采用「InMemory 默认 + DATABASE_URL 存在时切 Postgres」的双绑定（沿用阶段 0 的 `InMemoryUserRepository` 既定模式，占位注释本就声明阶段 1 换成 PostgreSQL 实现）。周边域走「腾讯地图 POI 代理 + Redis geohash+类目缓存 10 分钟 + 配额耗尽回退 venue_extras」三段降级（spec §4.2/§6）。小程序端 packages/types 扩展新 DTO → `sync:types` 同步到 `miniprogram/shared/types`；广场瀑布流用 JS 分配纯函数 + wf-list 组件（Skyline 下 column-count 不可靠，spec §5.2 强制 JS 分配）；无坐标（城市模式）不显示距离、按 last_active 排序。

**Tech Stack:** PostgreSQL 16 + PostGIS（`postgis/postgis:16-3.4`）、Redis 7（`redis:7-alpine`）、`pg`（node-postgres，无 ORM）、NestJS（沿用 DI token + interface 模式）、supertest、腾讯地图 WebService POI（`apis.map.qq.com/ws/place/v1/search`，经服务端代理）、微信小程序 Skyline + glass-easel。

## Global Constraints

以下约束**每条任务的验收都隐式包含**，逐字来自 spec 与本仓库已固化的规则：

1. **TDD**：先写失败测试（RED）→ 实现最小代码（GREEN）→ 全量相关 suite 绿 → `tsc --noEmit` 干净 → 单条 commit。集成测试（PostGIS/Redis）无环境时优雅 skip（沿用 `REDIS_INTEGRATION` env-gated 模式），绝不假绿。
2. **接口包络**：统一 `{ code, message, data }`，`code: 0` 成功；错误码只用 `packages/types/src/api.ts` 的 `ERROR_CODES`（`NOT_FOUND:40400`、`UNAUTHORIZED:40100`、`VALIDATION_FAILED:42200`、`RATE_LIMITED:42900`、`UPSTREAM_MAP:50202` 等）。`AllExceptionsFilter` + `ResponseInterceptor` 全局生效，错误响应走 `ApiException`。
3. **小程序不直连微信/地图 API**：页面不得直接 `wx.request` / `wx.getLocation`，必须经 `api/request.ts` / `store/location.ts`；腾讯地图 POI 只允许服务端代理（`server/src/venues/poi-client.ts`），小程序永远不持有 `TENCENT_MAP_KEY`。
4. **CommonJS 目录解析**：小程序端 `require('../shared/types')` 会解析成字面量 `shared/types.js`，**不会**回退到 `shared/types/index.js`。所有消费者必须写显式 `/index`。
5. **`access_token` 只能经 Redis 单点缓存获取**；微信 `errcode`/`errmsg` 仅写日志，不进客户端响应。
6. **PHI/合规**：接口返回脱敏；`approved` 未过审内容对他人不可见（本阶段宠物/照片均 seed 为可见，字段保留为后续用）；`--radius-full: 19998rpx` 非 bug，不得重开。
7. **样式纪律**：`style-guard` / `module-guard` 必须保持绿（wxss 只用 `--token-*` 与 rpx；不出现 `wx.` 直呼；小程序 import 全部显式 `/index`）。新组件若渲染在 page 子树之外（本阶段没有）会被 `OUTSIDE_PAGE_SLOTS` 扫描。
8. **依赖**：全阶段只允许**一次** `npm install`（`pg` + `@types/pg`，root 执行，同步更新 server/package.json）；不得再装任何包（ioredis、jsonwebtoken、supertest 等已有）。docker-compose 只描述 postgis + redis 两个镜像，不新增镜像。
9. **Env 门控集成测试**：PostGIS 集成测试以 `DATABASE_URL` 存在为门控（`describe.skipIf(!DATABASE_URL)`），与 Redis 集成测试同款；本机起数据库用 `docker compose up -d`。启动 Docker Desktop 需用户确认。
10. **设计豁免（既定决策，不得作为缺陷重开）**：`urlCheck: false`、`touristappid` 为计划规定的开发期豁免；不做暗色模式、附近活动 chip、点赞/评论（spec §9 YAGNI）；字体子集（Quicksand）推迟（无字体资产）。
11. **分页**：本阶段用 `page`/`pageSize`（offset 分页），返回 `{ items, hasMore, page }`，不用 cursor。
12. **坐标**：定位被拒绝 → 城市模式（`mode:'city'`），请求不带 lat/lng，服务端按 `last_active_at DESC` 排序且不返回距离（`distanceMeters: null`），小程序隐藏距离文案。
13. **种子数据**：演示中心点北京 `39.9042, 116.4074`。InMemory 种子与 SQL 种子内容一致（8 只宠物 / 10 家场所 / 8 位主人），照片用 `https://picsum.photos/seed/<key>/<w>/<h>` 占位图（本地 `urlCheck:false` 可加载）。
14. **间距数值**：页面左右 gutter 40rpx、两列间距 24rpx → 内容宽 670rpx、列宽 323rpx（wf-list 内部按此计算占位高度）。

---

### Task 1: 数据库地基（DatabaseModule + 迁移 + docker-compose + 集成测试骨架）

**Files:**
- Create: `docker-compose.yml`（仓库根）
- Create: `server/src/database/database.module.ts`
- Create: `server/src/database/database.pool.ts`
- Create: `server/src/database/migrations.ts`
- Create: `server/src/database/schema.sql`
- Create: `server/src/database/seed.sql`
- Create: `server/test/postgres.integration.spec.ts`
- Modify: `server/package.json`（加 `pg`、`@types/pg`）
- Modify: `server/src/app.module.ts`（import DatabaseModule）

**Interfaces:**
- Produces:
  - `PG_POOL = 'PgPool'`（string token）；`DatabaseModule` 导出 `PG_POOL`，值为 `pg.Pool | null`（`DATABASE_URL` 未设时为 null，懒创建不连接）。
  - `runMigrations(pool: Pool): Promise<void>` —— 幂等执行 schema.sql + seed.sql。
  - `DATABASE_URL`（PostgreSQL 连接串，如 `postgres://postgres:postgres@localhost:5432/paws`）。

- [ ] **Step 1: 一次 npm install（唯一一次）**

修改 `server/package.json`：`dependencies` 加 `"pg": "^8.11.0"`，`devDependencies` 加 `"@types/pg": "^8.10.0"`。然后在仓库根执行一次：

```bash
npm install
```

预期：lockfile 更新，`pg` 与 `@types/pg` 装进共享 node_modules（junction 链到 phase0-impl 的 node_modules）。之后全阶段不再 npm install。

- [ ] **Step 2: 写失败测试（迁移 + 建表）**

`server/test/postgres.integration.spec.ts`（门控在 `DATABASE_URL`，未设时 skip）：

```ts
import { Pool } from 'pg';
import { runMigrations } from '../src/database/migrations';

const DB_URL = process.env.DATABASE_URL;
const describeDb = DB_URL ? describe : describe.skip;

describeDb('postgres integration', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DB_URL });
    await runMigrations(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('建出 5 张业务表', async () => {
    const { rows } = await pool.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
    );
    const names = rows.map((r) => r.tablename);
    for (const t of ['users', 'pets', 'pet_photos', 'venue_extras', 'favorites']) {
      expect(names).toContain(t);
    }
  });

  it('postgis 扩展可用且 pets.location 有 GiST 索引', async () => {
    const { rows } = await pool.query(
      `SELECT 1 FROM pg_extension WHERE extname = 'postgis'`,
    );
    expect(rows.length).toBe(1);
    const idx = await pool.query(
      `SELECT 1 FROM pg_indexes WHERE tablename = 'pets' AND indexdef LIKE '%GIST%'`,
    );
    expect(idx.rows.length).toBe(1);
  });

  it('seed 后 8 只宠物、10 家场所、8 位主人', async () => {
    for (const [t, n] of [['pets', 8], ['venue_extras', 10], ['users', 8]] as const) {
      const { rows } = await pool.query(`SELECT count(*)::int AS c FROM ${t}`);
      expect(rows[0].c).toBe(n);
    }
  });

  it('迁移幂等：重复执行不报错、计数不变', async () => {
    await runMigrations(pool);
    const { rows } = await pool.query(`SELECT count(*)::int AS c FROM pets`);
    expect(rows[0].c).toBe(8);
  });
});
```

- [ ] **Step 3: 运行测试确认失败（或确认 skip）**

```bash
cd D:/tmp/test/.claude/worktrees/phase1-prep/server && npx jest test/postgres.integration.spec.ts
```

未设 `DATABASE_URL` 时预期输出 `skipped`（这是本机常态）。设了 `DATABASE_URL` 且有数据库时预期 FAIL（`migrations` 模块不存在）。

- [ ] **Step 4: 实现 schema.sql + seed.sql**

`schema.sql`（`CREATE EXTENSION IF NOT EXISTS postgis;` 开头，全部 `IF NOT EXISTS`，见 Global Constraints 之外本节附录 A 的表定义，逐字使用）。

`seed.sql`（内容与附录 A 的 seed 数据一致，逐字使用；`INSERT ... ON CONFLICT DO NOTHING` 保证幂等）。

- [ ] **Step 5: 实现 migrations.ts + database.pool.ts + database.module.ts**

`migrations.ts`：

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';

export async function runMigrations(pool: Pool): Promise<void> {
  const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
  const seed = readFileSync(join(__dirname, 'seed.sql'), 'utf8');
  await pool.query(schema);
  await pool.query(seed);
}
```

`database.pool.ts`：

```ts
import { Pool } from 'pg';

export function createPool(): Pool | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  return new Pool({ connectionString: url, max: 5, idleTimeoutMillis: 30_000 });
}
```

`database.module.ts`：`@Module({ providers: [{ provide: PG_POOL, useFactory: createPool }], exports: [PG_POOL] })`，`PG_POOL = 'PgPool'`。`app.module.ts` imports 加 `DatabaseModule`。

- [ ] **Step 6: 起库验证（需用户确认启动 Docker Desktop）**

```bash
cd D:/tmp/test && docker compose up -d
DATABASE_URL=postgres://postgres:postgres@localhost:5432/paws npx jest test/postgres.integration.spec.ts --runInBand
```

预期：4 条断言全 PASS。验证完可 `docker compose stop`（容器保留便于后续任务复用）。

- [ ] **Step 7: 提交**

```bash
git add docker-compose.yml server/package.json server/package-lock.json server/src/database server/src/app.module.ts server/test/postgres.integration.spec.ts
git commit -m "feat(server): postgres foundation with postgis migrations + seed"
```

---

### Task 2: AuthGuard + @CurrentUser（必需 / 可选两档）

**Files:**
- Create: `server/src/auth/auth.guard.ts`
- Create: `server/src/auth/current-user.decorator.ts`
- Create: `server/src/auth/optional-auth.guard.ts`
- Create: `server/test/auth-guard.spec.ts`
- Modify: `server/src/auth/auth.module.ts`（export 两个 guard + decorator，供 venues module 用）

**Interfaces:**
- Produces:
  - `AuthGuard implements CanActivate` —— 解析 `Authorization: Bearer <jwt>`，`verify(token, process.env.JWT_SECRET)`，把 `payload.sub` 挂到 `req.userId`；无 token / 验签失败抛 `ApiException(ERROR_CODES.UNAUTHORIZED, undefined, HttpStatus.UNAUTHORIZED)`。
  - `OptionalAuthGuard implements CanActivate` —— 有合法 token 则挂 `req.userId`，无/坏 token **不报错**，`req.userId = null`。
  - `@CurrentUser()` 参数装饰器：`(req) => req.userId ?? null`。

- [ ] **Step 1: 写失败测试**

`server/test/auth-guard.spec.ts`：用 `Test.createTestingModule({ controllers: [DummyController] })`，DummyController 两个路由：

```ts
@Controller('dummy')
class DummyController {
  @Get('required')
  required(@CurrentUser() userId: string | null): { userId: string | null } {
    return { userId };
  }
  @Get('optional')
  @UseGuards(OptionalAuthGuard)
  optional(@CurrentUser() userId: string | null): { userId: string | null } {
    return { userId };
  }
}
```

测试用例（supertest，`JWT_SECRET='test-secret'`，用 `sign({ sub: 'u-1' }, 'test-secret')` 造合法 token）：
1. required 无 token → 401 + `code: UNAUTHORIZED`。
2. required 坏 token（`Bearer garbage`）→ 401。
3. required 合法 token → 200 + `{ userId: 'u-1' }`。
4. optional 无 token → 200 + `{ userId: null }`。
5. optional 坏 token → 200 + `{ userId: null }`（不 401）。
6. optional 合法 token → `{ userId: 'u-1' }`。

- [ ] **Step 2: 运行确认失败**（`npx jest test/auth-guard.spec.ts`，报 `Cannot find module`）
- [ ] **Step 3: 最小实现**（三个文件如上。guard 用 `jsonwebtoken` 的 `verify`，`JWT_SECRET` 从 `process.env.JWT_SECRET` 读；`@CurrentUser` 用 `createParamDecorator((_, ctx) => ctx.switchToHttp().getRequest().userId ?? null)`。）
- [ ] **Step 4: 运行确认全绿**；auth.module.ts 的 exports 加 `AuthGuard`、`OptionalAuthGuard`、`CURRENT_USER`（如果装饰器需要 token 化导出则导出，装饰器本身可直接 import，不强制 token）。
- [ ] **Step 5: 提交**

```bash
git add server/src/auth/auth.guard.ts server/src/auth/optional-auth.guard.ts server/src/auth/current-user.decorator.ts server/src/auth/auth.module.ts server/test/auth-guard.spec.ts
git commit -m "feat(server): auth guard with required/optional tiers + current user decorator"
```

---

### Task 3: Pets 域 —— 仓储接口 + InMemory + Postgres 实现

**Files:**
- Create: `server/src/pets/pet.repository.ts`
- Create: `server/src/pets/pets.service.ts`
- Create: `server/src/pets/pets.module.ts`
- Create: `server/test/pet-repository.spec.ts`
- Create: `server/test/pets.service.spec.ts`
- Create: `server/test/pets-postgres.integration.spec.ts`

**Interfaces:**
- Produces:
  - `PET_REPOSITORY = 'PetRepository'`（token）。
  - `PetFilter = { species: 'all' | 'dog' | 'cat' | 'other'; breed: string /* 'all' 或具体品种 */ }`
  - `PetQuery = { filter: PetFilter; page: number; pageSize: number; lat?: number; lng?: number; radiusMeters?: number }`
  - `PetRow`（域记录，camelCase）：
    ```ts
    type PetRow = {
      id: string; name: string; species: 'dog'|'cat'|'other'; breed: string;
      gender: 'male'|'female'|'unknown'; birthDate: string; personalityTags: string[];
      bio: string; distanceMeters: number | null;
      coverUrl: string; coverWidth: number; coverHeight: number;
      ownerNickname: string; ownerAvatarUrl: string | null; ownerVerified: boolean;
    };
    type PetPhotoRow = { id: string; url: string; width: number; height: number };
    ```
  - `interface PetRepository { list(query: PetQuery): Promise<{ items: PetRow[]; hasMore: boolean }>; getById(id: string): Promise<{ pet: PetRow; photos: PetPhotoRow[] } | null>; }`
  - `InMemoryPetRepository`（seed 与 Task 1 的 SQL seed 相同 8 只；`list` 支持物种/品种过滤、haversine 距离排序、半径过滤、分页；无坐标时按 `lastActiveAt` 倒序、距离 null；`getById` 返回宠物 + 全部照片）。内部用 `squaredHaversineMeters(a, b)`（附在 repository 文件里，导出便于测试）。
  - `PostgresPetRepository`（构造 `(pool: Pool)`；`list` 用 PostGIS 查询，见附录 B 的 SQL，逐字使用）。
  - `PetsService`：
    ```ts
    class PetsService {
      constructor(@Inject(PET_REPOSITORY) private readonly repo: PetRepository) {}
      list(query: PetQuery): Promise<PetListResponse>;
      detail(id: string, opts: { lat?: number; lng?: number }): Promise<PetDetail | null>;
    }
    ```
    `PetListResponse = { items: PetSummary[]; hasMore: boolean; page: number }`（`PetSummary` 见附录 C，与 packages/types 一致；`distanceMeters` 直接透传）。`detail` 组装 `PetDetail`（附录 C）。`species/breed` 非法值在 service 层抛 `ApiException(VALIDATION_FAILED, undefined, 422)`（`species` 白名单 + `breed` 非空）。
  - `PetsModule`：providers `[{ provide: PET_REPOSITORY, useFactory: (pool) => pool ? new PostgresPetRepository(pool) : new InMemoryPetRepository(), inject: [PG_POOL] }, PetsService]`，exports `[PetsService]`。

- [ ] **Step 1: 写失败测试（InMemory 仓储行为）**

`server/test/pet-repository.spec.ts`（不依赖 DATABASE_URL）：

```ts
import { InMemoryPetRepository, type PetQuery } from '../src/pets/pet.repository';

describe('InMemoryPetRepository', () => {
  const repo = new InMemoryPetRepository();
  const center = { lat: 39.9042, lng: 116.4074 };

  it('无过滤：按距离升序返回全部，带距离', async () => {
    const { items, hasMore } = await repo.list({ filter: { species: 'all', breed: 'all' }, page: 1, pageSize: 20, ...center });
    expect(items.length).toBe(8);
    expect(items[0].distanceMeters).not.toBeNull();
    const ds = items.map((i) => i.distanceMeters as number);
    expect([...ds].sort((a, b) => a - b)).toEqual(ds); // 已按距离升序
    expect(hasMore).toBe(false);
  });

  it('物种过滤只回该物种', async () => {
    const { items } = await repo.list({ filter: { species: 'cat', breed: 'all' }, page: 1, pageSize: 20, ...center });
    expect(items.every((i) => i.species === 'cat')).toBe(true);
  });

  it('品种过滤命中 breed', async () => {
    const { items } = await repo.list({ filter: { species: 'dog', breed: '金毛' }, page: 1, pageSize: 20, ...center });
    expect(items.length).toBe(1);
    expect(items[0].name).toBe('大黄');
  });

  it('半径过滤裁剪范围', async () => {
    const { items } = await repo.list({ filter: { species: 'all', breed: 'all' }, page: 1, pageSize: 20, ...center, radiusMeters: 800 });
    const ds = items.map((i) => i.distanceMeters as number);
    expect(ds.every((d) => d <= 800)).toBe(true);
    expect(items.length).toBeLessThan(8);
  });

  it('分页：page=2 与第一页不重叠且 hasMore 正确', async () => {
    const a = await repo.list({ filter: { species: 'all', breed: 'all' }, page: 1, pageSize: 3, ...center });
    expect(a.hasMore).toBe(true);
    const b = await repo.list({ filter: { species: 'all', breed: 'all' }, page: 2, pageSize: 3, ...center });
    expect(b.items.length).toBe(3);
    expect(b.hasMore).toBe(true);
    expect(a.items.map((i) => i.id)).not.toEqual(expect.arrayContaining(b.items.map((i) => i.id)));
  });

  it('无坐标（城市模式）：距离为 null，按 lastActiveAt 倒序', async () => {
    const { items } = await repo.list({ filter: { species: 'all', breed: 'all' }, page: 1, pageSize: 20 });
    expect(items.every((i) => i.distanceMeters === null)).toBe(true);
    expect(items[0].name).toBe('旺财'); // last_active 最新
  });

  it('getById 返回宠物与全部照片', async () => {
    const found = await repo.getById('p-1');
    expect(found?.pet.name).toBe('大黄');
    expect((found?.photos.length ?? 0)).toBeGreaterThanOrEqual(2);
    expect(await repo.getById('nope')).toBeNull();
  });
});
```

- [ ] **Step 2: 运行确认失败**（`Cannot find module`）
- [ ] **Step 3: 实现 InMemoryPetRepository**（seed 数据用附录 A 的 8 只宠物 + 8 位主人 + 照片清单；haversine 函数、过滤、排序、分页逻辑如上；`lastActiveAt` 种子给每个宠物一个递增值，旺财最新）
- [ ] **Step 4: 运行确认全绿**（`npx jest test/pet-repository.spec.ts`）
- [ ] **Step 5: 写 PetsService 测试**

`server/test/pets.service.spec.ts`：用真实 `InMemoryPetRepository` 注入 `PetsService`：
1. `list` 返回 `{ items, hasMore, page }`，page 透传，species='dog' 过滤生效。
2. `list` species='alien' → 抛 `ApiException` 且 `code=VALIDATION_FAILED`（用 `expect(...).rejects.toMatchObject({ code: ERROR_CODES.VALIDATION_FAILED })`，`ApiException` 实例有 `code` 字段——实现时给 ApiException 加 `code` 属性或让 service 直接构造）。
3. `detail('p-1')` 返回 `PetDetail`：含 owner 对象、photos 数组、personalityTags。
4. `detail('nope')` 返回 null。
5. `list` 无坐标时 items 的 `distanceMeters` 全 null。

（若 ApiException 缺 `code` 公共属性，Step 6 中给 `server/src/common/api.exception.ts` 补一个 `readonly code` 字段——该字段本就有，断言用它。）

- [ ] **Step 6: 运行确认全绿**
- [ ] **Step 7: 写 Postgres 集成测试（门控 DATABASE_URL）**

`server/test/pets-postgres.integration.spec.ts`（`describe.skipIf(!DATABASE_URL)`，beforeAll `runMigrations`）：
1. `list`（中心点、无过滤）返回 8 只、按距离升序、`distanceMeters` 非 null。
2. `list` species='cat' 只回猫。
3. `getById('p-1')` 返回 `pet.name === '大黄'` 且 photos ≥ 2。
4. 距离与 InMemory 的 haversine 结果在 ±50m 内一致（对同一只宠物分别用 InMemory 与 Postgres 查询同一坐标，比较 `distanceMeters`）。

- [ ] **Step 8: 实现 PostgresPetRepository**（SQL 用附录 B；无坐标分支：`ORDER BY p.last_active_at DESC`、不 SELECT 距离、`distance_meters AS distanceMeters` 用 `null::float8`；行映射 camelCase）
- [ ] **Step 9: 起库跑集成测试**（同 Task 1 Step 6，`docker compose up -d` 若未起）
- [ ] **Step 10: 提交**

```bash
git add server/src/pets server/test/pet-repository.spec.ts server/test/pets.service.spec.ts server/test/pets-postgres.integration.spec.ts server/src/common/api.exception.ts
git commit -m "feat(server): pets domain with in-memory + postgis repositories"
```

---

### Task 4: PetsController + PetsModule 接线（GET /pets、GET /pets/:id）

**Files:**
- Create: `server/src/pets/pets.controller.ts`
- Modify: `server/src/pets/pets.module.ts`（加 controller）
- Create: `server/test/pets.controller.spec.ts`
- Modify: `server/src/app.module.ts`（import PetsModule）

**Interfaces:**
- Produces:
  - `GET /pets?species=&breed=&page=&pageSize=&lat=&lng=&radiusMeters=` → 200 `{ code:0, data: PetListResponse }`。参数校验：`species` ∈ `all|dog|cat|other`（缺省 `all`）、`breed` 缺省 `all`、`page` ≥ 1（缺省 1）、`pageSize` ∈ [1,20]（缺省 10）、`lat`/`lng` 成对出现否则按城市模式、`radiusMeters` ∈ [1, 50000]。非法 → 422 `VALIDATION_FAILED`。
  - `GET /pets/:id?lat=&lng=` → 200 `{ code:0, data: PetDetail }`；不存在 → 404 `NOT_FOUND`（中文文案「宠物不存在」）。
  - 两个端点都用 `OptionalAuthGuard`（为后续 isFavorite 预留，本阶段不读 userId，但注入不破坏）。

- [ ] **Step 1: 写失败测试**

`server/test/pets.controller.spec.ts`（`Test.createTestingModule({ imports: [PetsModule] })` + 真实 InMemory 仓储，不 override；`app.useGlobalInterceptors(new ResponseInterceptor()); app.useGlobalFilters(new AllExceptionsFilter())`）：

1. `GET /pets` → 200，`data.items.length === 8`，`data.page === 1`，首项是距离最近者。
2. `GET /pets?species=cat` → items 全为 cat。
3. `GET /pets?page=2&pageSize=3` → 3 项且 `hasMore === true`。
4. `GET /pets?lat=39.9&lng=116.4`（带坐标）→ 首项 `distanceMeters` 非 null。
5. `GET /pets?species=alien` → 422 + `code: VALIDATION_FAILED`。
6. `GET /pets?page=0` → 422。
7. `GET /pets?lat=39.9`（缺 lng）→ 422（经纬度成对）。
8. `GET /pets/p-1` → 200，`data.name === '大黄'`、`data.photos.length >= 2`、`data.owner.nickname` 非空。
9. `GET /pets/nope` → 404 + `code: NOT_FOUND`。

- [ ] **Step 2: 运行确认失败**（PetsModule 无 controller，404 或模块缺失）
- [ ] **Step 3: 实现 controller**（`@Controller('pets')`，`@Get()` / `@Get(':id')`，用 `@Query()` 解析并收敛到 `PetQuery`；数值用 `Number()` 解析 + 白名单校验，非法抛 `ApiException(VALIDATION_FAILED, undefined, 422)`；detail 不存在抛 `ApiException(NOT_FOUND, '宠物不存在', 404)`）
- [ ] **Step 4: 运行确认全绿**
- [ ] **Step 5: 提交**

```bash
git add server/src/pets/pets.controller.ts server/src/pets/pets.module.ts server/src/app.module.ts server/test/pets.controller.spec.ts
git commit -m "feat(server): pets listing + detail endpoints"
```

---

### Task 5: Venues 域 —— venue_extras 仓储（InMemory + Postgres）

**Files:**
- Create: `server/src/venues/venue.repository.ts`
- Create: `server/src/venues/venues.module.ts`
- Create: `server/test/venue-repository.spec.ts`
- Create: `server/test/venues-postgres.integration.spec.ts`

**Interfaces:**
- Produces:
  - `VENUE_REPOSITORY = 'VenueRepository'`（token）。
  - `VenueExtrasRow`（camelCase）：
    ```ts
    type VenueExtrasRow = {
      poiId: string; name: string; address: string; category: VenueCategory;
      rating: number | null; avgPrice: number | null; tags: string[];
      curatedPhoto: string | null; distanceMeters: number | null;
    };
    ```
    `VenueCategory = 'hospital'|'shop'|'grooming'|'park'|'cafe'|'other'`（与 packages/types 一致）。
  - `interface VenueRepository { search(q: { keyword?: string; category?: 'all' | VenueCategory; lat?: number; lng?: number; radiusMeters?: number }): Promise<VenueExtrasRow[]>; getById(poiId: string): Promise<VenueExtrasRow | null>; }`
  - `InMemoryVenueRepository`（seed 10 家，与 Task 1 SQL seed 一致；`search` 支持 keyword 匹配 name/address（包含即中，大小写不敏感）、category 过滤、距离排序 + 半径过滤；无坐标按 name 排序、距离 null）。
  - `PostgresVenueRepository`（构造 `(pool: Pool)`；SQL 见附录 D）。

- [ ] **Step 1: 写失败测试** `server/test/venue-repository.spec.ts`（真实 InMemory，不依赖 DB）：

```ts
describe('InMemoryVenueRepository', () => {
  const repo = new InMemoryVenueRepository();
  const center = { lat: 39.9042, lng: 116.4074 };

  it('无过滤返回全部 10 家，按距离升序', async () => {
    const rows = await repo.search({ ...center });
    expect(rows.length).toBe(10);
    const ds = rows.map((r) => r.distanceMeters as number);
    expect([...ds].sort((a, b) => a - b)).toEqual(ds);
  });

  it('category 过滤只回该类目', async () => {
    const rows = await repo.search({ category: 'park', ...center });
    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.category === 'park')).toBe(true);
  });

  it('keyword 命中名称（子串、大小写不敏感）', async () => {
    const rows = await repo.search({ keyword: '医院', ...center });
    expect(rows.length).toBe(2);
  });

  it('半径过滤裁剪', async () => {
    const rows = await repo.search({ ...center, radiusMeters: 1500 });
    expect(rows.every((r) => (r.distanceMeters as number) <= 1500)).toBe(true);
  });

  it('无坐标：距离 null、按名称排序', async () => {
    const rows = await repo.search({});
    expect(rows.every((r) => r.distanceMeters === null)).toBe(true);
    const names = rows.map((r) => r.name);
    expect([...names].sort((a, b) => a.localeCompare(b, 'zh'))).toEqual(names);
  });

  it('getById 命中与 miss', async () => {
    expect((await repo.getById('v-1'))?.name).toBe('宠福康宠物医院');
    expect(await repo.getById('nope')).toBeNull();
  });
});
```

- [ ] **Step 2: 运行确认失败 → Step 3 实现 InMemoryVenueRepository（seed 用附录 A venue 表）→ Step 4 全绿**
- [ ] **Step 5: Postgres 集成测试**（门控）：`search({...center})` 10 家升序；`category='hospital'` 只回医院；`getById('v-1')` 名字正确；距离与 InMemory haversine 一致 ±50m。
- [ ] **Step 6: 实现 PostgresVenueRepository**（附录 D SQL）
- [ ] **Step 7: 起库跑集成测试 → 全绿**
- [ ] **Step 8: 提交**

```bash
git add server/src/venues/venue.repository.ts server/src/venues/venues.module.ts server/test/venue-repository.spec.ts server/test/venues-postgres.integration.spec.ts
git commit -m "feat(server): venues domain with venue_extras repositories"
```

---

### Task 6: POI 代理 —— 腾讯地图客户端 + Redis 缓存 + 降级

**Files:**
- Create: `server/src/common/geohash.ts`
- Create: `server/src/venues/poi-client.ts`
- Create: `server/src/venues/poi-cache.ts`
- Create: `server/src/venues/poi-proxy.service.ts`
- Create: `server/test/geohash.spec.ts`
- Create: `server/test/poi-proxy.spec.ts`

**Interfaces:**
- Produces:
  - `encodeGeohash(lat: number, lng: number, precision = 6): string`（base32、0-9b-z 去 a/i/l/o；unit test 与已知值比对：`encodeGeohash(39.9042, 116.4074, 6) === 'wx4g0f'`）。
  - `MAP_POI_CLIENT = 'MapPoiClient'`（token）。
  - `MapPlace = { poiId: string; name: string; address: string; category: string; lat: number; lng: number }`
  - `interface MapPoiClient { searchPlace(opts: { keyword: string; category: string; lat: number; lng: number; radiusMeters?: number }): Promise<MapPlace[] | null> }`
  - `TencentPoiClient`（构造 `(key: string)`）：`fetch('https://apis.map.qq.com/ws/place/v1/search?' + new URLSearchParams({ key, keyword, category, boundary: 'nearby(' + lat + ',' + lng + ',' + (radius ?? 3000) + ')', page_size: '20' }))`；HTTP 失败 / 非 0 status / 网络异常 → **返回 null**（不是 throw）；`data[]` 映射为 `MapPlace`（`poiId = item.id`）。
  - `POI_CACHE = 'PoiCache'`（token）。
  - `interface PoiCache { get(key: string): Promise<string | null>; set(key: string, value: string, ttlSeconds: number): Promise<void> }`
  - `RedisPoiCache`（懒连接 ioredis，`get`/`set` 带 TTL；无 Redis 时 `get` 返回 null、`set` no-op——与 RedisRateLimitStore 同款懒连接 + null 安全）。
  - `PoiProxyService`：
    ```ts
    class PoiProxyService {
      constructor(@Inject(MAP_POI_CLIENT) client: MapPoiClient, @Inject(POI_CACHE) cache: PoiCache) {}
      search(opts: { keyword: string; category: string; lat: number; lng: number }): Promise<MapPlace[] | null>;
    }
    ```
    逻辑：`key = poi:gh:${encodeGeohash(lat,lng)}:${category}`（keyword 也拼进 key 后缀，`poi:gh:wx4g0f:dog-hospital:宠物医院`，防不同搜索互相污染）→ cache.get 命中则 JSON.parse 返回 → 未命中调 `client.searchPlace` → 成功且非空：cache.set(key, JSON.stringify(places), 600) 并返回 → client 返回 null（配额耗尽/网络失败）→ **返回 null**（上层降级 venue_extras）。
  - `PoiCategoryMapper`: `mapPoiCategory(raw: string): VenueCategory`（`/医院|clinic/i → 'hospital'`；`/店|超市|商场|用品|食品|粮/i → 'shop'`；`/美容|洗澡|洗护|spa|造型/i → 'grooming'`；`/公园|景区|绿地|广场|草坪/i → 'park'`；`/咖啡|cafe|餐厅|饭店|餐饮|宠物友好/i → 'cafe'`；默认 `'other'`），导出常量 `CATEGORY_LABELS: Record<VenueCategory, string>`（`{ hospital:'宠物医院', shop:'宠物店', grooming:'美容洗护', park:'宠物公园', cafe:'宠物友好', other:'其他' }`）。
  - `PoiProxyModule` 或并入 `VenuesModule`：providers 用 `useFactory` 绑定 `MAP_POI_CLIENT = process.env.TENCENT_MAP_KEY ? new TencentPoiClient(key) : null`（null 时 `PoiProxyService.search` 直接返回 null → 纯 venue_extras 模式，本机无 key 的常态）；`POI_CACHE = new RedisPoiCache()`。

- [ ] **Step 1: 写失败测试（geohash）** `server/test/geohash.spec.ts`：`encodeGeohash(39.9042,116.4074,6)==='wx4g0f'`；`encodeGeohash(31.2304,121.4737,6)==='wtw3sm'`（上海）；`encodeGeohash(0,0,6)==='s00000'`；精度参数生效（6 位 vs 4 位长度）。
- [ ] **Step 2: 实现 geohash → 全绿**
- [ ] **Step 3: 写失败测试（PoiProxyService，fakes）**

`server/test/poi-proxy.spec.ts`：`FakePoiClient { result: MapPlace[] | null }`、`FakePoiCache { map: Map<string,string> }`。
1. cache 未命中 → 调 client → 结果写入 cache（key 含 geohash 与 category）→ 返回 places。
2. cache 命中 → 不调 client（client 计数为 0）→ 返回缓存 JSON。
3. client 返回 null（配额耗尽）→ **返回 null**，不写缓存。
4. 无 key 场景（`client` 为 null）→ 返回 null，不崩。
5. 不同 keyword 不同缓存键（两次 search 不同 keyword → client 被调 2 次）。
6. `mapPoiCategory`：`'狗狗宠物医院'→'hospital'`、`'XX宠物美容会所'→'grooming'`、`'朝阳公园'→'park'`、`'有猫咖啡'→'cafe'`、`'神秘小店'→'other'`。

- [ ] **Step 4: 实现 PoiProxyService + RedisPoiCache + TencentPoiClient + mapper → 全绿**
- [ ] **Step 5: 提交**

```bash
git add server/src/common/geohash.ts server/src/venues/poi-client.ts server/src/venues/poi-cache.ts server/src/venues/poi-proxy.service.ts server/test/geohash.spec.ts server/test/poi-proxy.spec.ts
git commit -m "feat(server): poi proxy with geohash+category redis cache and quota fallback"
```

---

### Task 7: VenuesController —— 列表 + 详情 + 收藏

**Files:**
- Create: `server/src/venues/favorites.repository.ts`
- Create: `server/src/venues/venues.service.ts`
- Create: `server/src/venues/venues.controller.ts`
- Modify: `server/src/venues/venues.module.ts`
- Create: `server/test/venues.service.spec.ts`
- Create: `server/test/venues.controller.spec.ts`

**Interfaces:**
- Produces:
  - `FAVORITES_REPOSITORY = 'FavoritesRepository'`（token）。
  - `interface FavoritesRepository { list(userId: string): Promise<string[]>; add(userId: string, poiId: string): Promise<void>; remove(userId: string, poiId: string): Promise<void>; }`
  - `InMemoryFavoritesRepository`（Map<string, Set<string>>；add 幂等）；`PostgresFavoritesRepository`（`INSERT ... ON CONFLICT DO NOTHING` / `DELETE` / `SELECT poi_id`）。
  - `VenuesService`：
    ```ts
    class VenuesService {
      constructor(@Inject(POI_PROXY) proxy: PoiProxyService | null, @Inject(VENUE_REPOSITORY) repo: VenueRepository, @Inject(FAVORITES_REPOSITORY) favs: FavoritesRepository) {}
      search(opts: { keyword?: string; category?: 'all'|VenueCategory; lat?: number; lng?: number; userId: string | null }): Promise<Venue[]>;
      detail(poiId: string, userId: string | null): Promise<Venue | null>;
      setFavorite(poiId: string, userId: string, favorite: boolean): Promise<{ isFavorite: boolean }>;
    }
    ```
    映射规则（spec §4.2 降级）：
    - 有坐标且有 `TENCENT_MAP_KEY`：先 `proxy.search`；非 null → POI 结果映射为 `Venue`（`poiId/name/address` 取 POI；`category = mapPoiCategory(poi.category)`；`categoryLabel = CATEGORY_LABELS[category]`；`rating/avgPrice/curatedPhoto = null`；`tags = [categoryLabel]`；`distanceMeters` 用 POI 坐标与查询点 haversine）；再尝试 `repo.getById(poiId)` 补 `rating/avgPrice/tags/curatedPhoto`（有 extras 则覆盖）。
    - 其余情况（无 key / proxy null / proxy 返回 null）：`repo.search` 结果直接映射（extras 齐全，`tags` 取 extras.tags，空则 `[categoryLabel]`；`distanceMeters` 透传）。
    - `isFavorite`：`userId` 非 null 时查 favorites 集合（每项一次 contains，或一次 `list(userId)` 建 Set）。
  - `Venue` DTO 见附录 C（与 packages/types 一致）。
  - `VenuesController`（`@Controller('venues')`，全部挂 `OptionalAuthGuard`，收藏动作挂 `AuthGuard`）：
    - `GET /venues?keyword=&category=&lat=&lng=&radiusMeters=` → 200 `{ code:0, data: Venue[] }`（列表不分页，量小）。
    - `GET /venues/:poiId` → 200 `{ code:0, data: Venue }`；不存在 → 404 `NOT_FOUND`「场所不存在」。
    - `POST /venues/:poiId/favorite` → 200 `{ code:0, data: { isFavorite: true } }`（幂等）。
    - `DELETE /venues/:poiId/favorite` → 200 `{ code:0, data: { isFavorite: false } }`（幂等）。
  - `POI_PROXY = 'PoiProxyService'`（token，VenuesModule 内绑定；无 `TENCENT_MAP_KEY` 时 `useValue: null`）。

- [ ] **Step 1: 写失败测试（降级映射，service 层）**

`server/test/venues.service.spec.ts`（真实 InMemoryVenueRepository + InMemoryFavoritesRepository + `FakePoiProxy { result: MapPlace[] | null }`）：
1. proxy 返回 null（配额耗尽）→ `search` 回 venue_extras 全量（10 家），`rating/avgPrice` 有值，`tags` 来自 extras。
2. proxy 返回 POI 列表 → 结果来自 POI（如 2 家），`rating/avgPrice` 为 null、`tags === [categoryLabel]`（降级标签）。
3. POI 的 category 经 `mapPoiCategory` 映射（`'狗狗宠物医院' → 'hospital'`，`categoryLabel === '宠物医院'`）。
4. 无坐标（`lat/lng` 缺省）→ 直接 extras，`distanceMeters` null。
5. `userId` 传入且收藏过 v-2 → 结果中 v-2 `isFavorite === true`，其余 false。
6. `detail('v-1')` 返回 extras 补全的 Venue；`detail('nope')` → null。
7. `setFavorite('v-1', 'u-1', true)` 后 `detail('v-1','u-1').isFavorite === true`；再 `setFavorite(..., false)` 后 false；重复 add 不崩（幂等）。

- [ ] **Step 2: 运行确认失败 → Step 3: 实现 favorites.repository + venues.service + POI_PROXY 绑定 → Step 4: 全绿**
- [ ] **Step 5: 写失败测试（controller）**

`server/test/venues.controller.spec.ts`（imports: `[VenuesModule, AuthModule]` 或 `[VenuesModule]` + guard 直接挂；`JWT_SECRET='test-secret'`；用 `sign` 造 token）：
1. `GET /venues` → 200，10 家，首项距离最近。
2. `GET /venues?category=park` → 2 家。
3. `GET /venues?keyword=医院` → 2 家。
4. `GET /venues?category=alien` → 422。
5. `GET /venues/v-1` → 200，`name === '宠福康宠物医院'`、`rating === 4.8`。
6. `GET /venues/nope` → 404。
7. 带 `Authorization: Bearer <token>` 的 `POST /venues/v-3/favorite` → 200 `isFavorite: true`；再 `DELETE` → false。
8. 无 token 的 `POST /venues/v-3/favorite` → 401。
9. 带 token 的 `GET /venues` → 收藏过的项 `isFavorite: true`（先收藏再查）。

- [ ] **Step 6: 运行确认失败 → Step 7: 实现 controller（含校验：category 白名单、keyword ≤ 50 字符、lat/lng 成对、radiusMeters ∈ [1,50000]，非法 422）→ Step 8: 全绿**
- [ ] **Step 9: 实现 PostgresFavoritesRepository + 集成测试**（`server/test/favorites-postgres.integration.spec.ts` 门控：add 幂等两次、list 回 1、remove 后空；与 PostgresVenueRepository 一起在 venues-postgres.integration.spec.ts 扩展亦可）
- [ ] **Step 10: 提交**

```bash
git add server/src/venues/favorites.repository.ts server/src/venues/venues.service.ts server/src/venues/venues.controller.ts server/src/venues/venues.module.ts server/test/venues.service.spec.ts server/test/venues.controller.spec.ts server/test/favorites-postgres.integration.spec.ts
git commit -m "feat(server): venues endpoints with poi fallback and favorites"
```

---

### Task 8: shared 类型 + 小程序 API 层

**Files:**
- Create: `packages/types/src/pet.ts`
- Create: `packages/types/src/venue.ts`
- Create: `packages/types/src/filter.ts`
- Modify: `packages/types/src/index.ts`
- Create: `miniprogram/api/pets.ts`
- Create: `miniprogram/api/venues.ts`
- Create: `miniprogram/test/api-methods.spec.ts`

**Interfaces:**
- Produces（packages/types 导出，全部 camelCase，逐字定义）：

```ts
// pet.ts
export type PetSpecies = 'dog' | 'cat' | 'other';
export type PetGender = 'male' | 'female' | 'unknown';
export interface PetSummary {
  id: string; name: string; species: PetSpecies; breed: string; gender: PetGender;
  birthDate: string; coverUrl: string; coverWidth: number; coverHeight: number;
  personalityTags: string[]; distanceMeters: number | null;
  ownerNickname: string; ownerAvatarUrl: string | null; ownerVerified: boolean;
}
export interface PetPhoto { id: string; url: string; width: number; height: number; }
export interface PetDetail {
  id: string; name: string; species: PetSpecies; breed: string; gender: PetGender;
  birthDate: string; bio: string; personalityTags: string[];
  distanceMeters: number | null;
  owner: { nickname: string; avatarUrl: string | null; ownerVerified: boolean };
  photos: PetPhoto[];
}
export interface PetListResponse { items: PetSummary[]; hasMore: boolean; page: number; }

// venue.ts
export type VenueCategory = 'hospital' | 'shop' | 'grooming' | 'park' | 'cafe' | 'other';
export interface Venue {
  poiId: string; name: string; address: string; category: VenueCategory;
  categoryLabel: string; distanceMeters: number | null;
  rating: number | null; avgPrice: number | null; tags: string[];
  coverUrl: string | null; isFavorite: boolean;
}

// filter.ts
export interface FilterOption { value: string; label: string; }
export const DOG_BREEDS: string[] = ['金毛', '柯基', '柴犬', '边牧', '拉布拉多', '泰迪', '萨摩耶', '哈士奇', '博美', '法斗'];
export const CAT_BREEDS: string[] = ['布偶', '英国短毛猫', '美国短毛猫', '中华田园猫', '暹罗', '缅因', '加菲', '橘猫'];
export interface PetFilter { species: 'all' | PetSpecies; breed: string; }
```

`miniprogram/api/pets.ts` / `venues.ts`（`api` 为 `miniprogram/api/client.ts` 导出的单例，`api.call(path, { data })`；GET 的 data 由 wx.request 拼进 query）：

```ts
import { api } from './client';
import type { PetDetail, PetFilter, PetListResponse } from '../shared/types/index';

export interface FetchPetsParams extends PetFilter {
  page: number; pageSize: number; lat?: number; lng?: number; radiusMeters?: number;
}
export async function fetchPets(params: FetchPetsParams): Promise<PetListResponse> {
  return api.call('/pets', { data: params });
}
export async function fetchPetDetail(id: string, lat?: number, lng?: number): Promise<PetDetail> {
  return api.call(`/pets/${id}`, { data: { lat, lng } });
}
// venues.ts
export async function fetchVenues(params: { keyword?: string; category?: string; lat?: number; lng?: number }): Promise<Venue[]> {
  return api.call('/venues', { data: params });
}
export async function fetchVenueDetail(poiId: string): Promise<Venue> { return api.call(`/venues/${poiId}`); }
export async function addFavorite(poiId: string): Promise<{ isFavorite: boolean }> { return api.call(`/venues/${poiId}/favorite`, { method: 'POST' }); }
export async function removeFavorite(poiId: string): Promise<{ isFavorite: boolean }> { return api.call(`/venues/${poiId}/favorite`, { method: 'DELETE' }); }
```

- [ ] **Step 1: 在 packages/types 写 3 个新模块 + index.ts 导出**（`export * from './pet'; export * from './venue'; export * from './filter';`），`npm run build`（在 packages/types 目录），再 `npm run sync:types`（root 或 miniprogram，把 .js/.d.ts 同步进 `miniprogram/shared/types/`）。
- [ ] **Step 2: 写失败测试（api 层）**

`miniprogram/test/api-methods.spec.ts`（用 `FakeWx`（已有 `wx-promise.ts` 的 WxAdapter 模式）替换 `api` 的底层实现——先读 `miniprogram/api/client.ts` 确认单例如何暴露 adapter；若 `api` 内部持有 `wxAdapter`，通过设置 `wxAdapter` 的 fake 驱动）：
1. `fetchPets({ species:'cat', breed:'all', page:1, pageSize:10 })` → 发出的请求 method GET、url `/pets`、data 含 `species:'cat'`。
2. `fetchPetDetail('p-1', 39.9, 116.4)` → url `/pets/p-1`。
3. `addFavorite('v-1')` → method POST、url `/venues/v-1/favorite`。
4. 返回的 data 是 `PetListResponse` 形状（fake 响应 `{ code:0, data:{ items:[...], hasMore:false, page:1 } }` → 解析后得到 items）。

（若 `api.call` 返回已解包 data，断言用解包后的对象；先读 client.ts 的实际签名。）

- [ ] **Step 3: 运行确认失败（模块不存在）→ Step 4: 实现两个 api 文件 → Step 5: 全绿**
- [ ] **Step 6: 提交**

```bash
git add packages/types/src/pet.ts packages/types/src/venue.ts packages/types/src/filter.ts packages/types/src/index.ts miniprogram/api/pets.ts miniprogram/api/venues.ts miniprogram/shared/types miniprogram/test/api-methods.spec.ts
git commit -m "feat(types+mp): browsing dto types and typed api wrappers"
```

---

### Task 9: 小程序纯函数工具（formatDistance + distributeWaterfall + 品种筛选）

**Files:**
- Create: `miniprogram/utils/format.ts`
- Create: `miniprogram/tools/waterfall.ts`
- Create: `miniprogram/test/format.spec.ts`
- Create: `miniprogram/test/waterfall.spec.ts`
- Create: `miniprogram/test/filter.spec.ts`

**Interfaces:**
- Produces:

```ts
// utils/format.ts
export function formatDistance(meters: number | null): string;
//   null → ''；< 1000 → `${Math.round(m)}m`；否则 `${(m/1000).toFixed(1)}km`
export function formatPetAge(birthDate: string): string;
//   复用既有 shared 的 age 逻辑？—— 若 miniprogram/shared/types 已有 formatPetAge 则直接 re-export 不用新写；否则实现：
//   距今不足 1 月 → 'X 天'; 不足 12 月 → 'X 个月'; 否则 'X 岁'
// tools/waterfall.ts
export interface WaterfallItem { id: string; ratio: number; }  // ratio = height / width
export function distributeWaterfall(items: WaterfallItem[], columnCount: number): WaterfallItem[][];
//   把每个 item 放进当前累计 ratio 最小的一列；返回 columnCount 个数组
```

- [ ] **Step 1: 写失败测试**

`miniprogram/test/format.spec.ts`：
1. `formatDistance(null) === ''`；`formatDistance(0) === '0m'`；`formatDistance(999) === '999m'`；`formatDistance(1000) === '1.0km'`；`formatDistance(1530) === '1.5km'`。
2. `formatPetAge`（若实现）：birthDate 为今天 → `'0 天'`；40 天前 → `'1 个月'`；13 个月前 → `'1 岁'`（用 `Date.now` 差值，测试里固定 `new Date(...)` 与函数内部 `Date.now` 的对比——若函数读 `Date.now()`，测试用 `vi.useFakeTimers` 或传参；实现改为 `formatPetAge(birthDate, now = Date.now())` 便于测试）。

`miniprogram/test/waterfall.spec.ts`：
1. 空数组 → 两个空列。
2. 4 个等 ratio 项 → 每列 2 个、累计 ratio 相等。
3. 2 列、ratio 差异大：`[ {r:9},{r:1},{r:1} ]` → 第一列 [9]，第二列 [1,1]（9 单独去最短列）。
4. `columnCount=1` → 单列全量。
5. 稳定性：相同 ratio 的项按输入顺序进列（`id` 顺序断言）。

`miniprogram/test/filter.spec.ts`（品种联动）：
1. `breedsForSpecies('dog')` 返回 `DOG_BREEDS`；`breedsForSpecies('cat')` 返回 `CAT_BREEDS`；`breedsForSpecies('other')` 返回 `[]`。→ 此函数放 `miniprogram/shared/filter.ts`（或直接从 shared/types 的常量派生，实现放 filter.ts）。

- [ ] **Step 2: 实现 format.ts / waterfall.ts / filter.ts → 全绿**
- [ ] **Step 3: 提交**

```bash
git add miniprogram/utils/format.ts miniprogram/tools/waterfall.ts miniprogram/shared/filter.ts miniprogram/test/format.spec.ts miniprogram/test/waterfall.spec.ts miniprogram/test/filter.spec.ts
git commit -m "feat(mp): pure helpers for distance, age, waterfall distribution, breed options"
```

---

### Task 10: 基础组件 sq-button + empty-state

**Files:**
- Create: `miniprogram/components/sq-button/index.{json,ts,wxml,wxss}`
- Create: `miniprogram/components/empty-state/index.{json,ts,wxml,wxss}`
- Create: `miniprogram/test/components-basic.spec.ts`

**Interfaces:**
- Produces:
  - `sq-button`：properties `{ type: { value: 'primary'|'plain'|'danger'|'ghost', default: 'primary' }, size: { value: 'md'|'lg', default: 'md' }, disabled: Boolean, loading: Boolean }`；`tap` 事件（disabled/loading 时不触发）；class 用 token：`--token-color-surface`、`--token-color-primary`、`--token-color-text-primary`、`--token-radius-lg`、`--token-space-md` 等（对照 `miniprogram/styles/tokens.wxss` 里实际存在的 token 名，不得引入新 token）。
  - `empty-state`：properties `{ icon: { value: 'paw' }, title: String, hint: String }`；布局居中、`page, .token-scope` 继承。
- 两个组件 `"styleIsolation": "apply-shared"`（app.wxss 的语义类与 token 才能进组件；这是既定模式，见 phase0 计划对 `apply-shared` 的论证——隔离模式只影响选择器匹配）。

- [ ] **Step 1: 先读 `miniprogram/styles/tokens.wxss` 与 `miniprogram/styles/` 现有语义类**，确认 token 名与类名（`--token-*`、`.card`、`.chip` 等），写组件时只用已存在的。
- [ ] **Step 2: 写失败测试** `miniprogram/test/components-basic.spec.ts`（node 环境无法真渲染，测试为「配置与结构断言」）：
  1. 每个新组件 json 是合法 `{ component: true, styleIsolation: 'apply-shared' }`。
  2. sq-button 的 wxss 只出现 token/rpx（跑 style-guard 断言工具函数，或直接跑现成 guard suite）。
  3. sq-button.wxml 的 `tap` 绑定存在。
- [ ] **Step 3: 实现 4 文件 × 2 组件 → Step 4: 全绿（含既有 style-guard/module-guard suite 回归）**
- [ ] **Step 5: 提交**

```bash
git add miniprogram/components/sq-button miniprogram/components/empty-state miniprogram/test/components-basic.spec.ts
git commit -m "feat(mp): sq-button and empty-state components"
```

---

### Task 11: filter-chips 组件（双层受控筛选）

**Files:**
- Create: `miniprogram/components/filter-chips/index.{json,ts,wxml,wxss}`
- Create: `miniprogram/test/filter-chips.spec.ts`

**Interfaces:**
- Produces（spec §5.3 受控组件：props 下发、事件上抛，页面持有状态）：

```ts
// component ts
properties: {
  categories: { type: Array, value: [] as FilterOption[] },   // 第一层：全部/犬/猫/其他
  selected: { type: String, value: 'all' },
  subOptions: { type: Array, value: [] as FilterOption[] },   // 第二层：品种（可为空）
  subSelected: { type: String, value: 'all' },
}
methods: {
  onCategoryTap(e): void      // 触发 this.triggerEvent('change', { selected, subSelected: 'all' })
  onSubTap(e): void           // 触发 this.triggerEvent('change', { selected, subSelected })
}
```
- 交互规则：点第一层 → 重置第二层为 `all` 并上抛；点第二层 → 仅更新 subSelected 上抛。第二层在 `subOptions` 为空时不渲染（`other` 物种无品种层）。
- 样式：`page, .token-scope` 继承 token；选中态用 `--token-color-primary` 底 + `--token-color-on-primary` 字；未选态 `--token-color-surface` 底 + `--token-color-text-secondary` 字；chip 圆角 `--token-radius-pill`。

- [ ] **Step 1: 写失败测试** `miniprogram/test/filter-chips.spec.ts`：
  1. json 合法且 apply-shared。
  2. wxml 存在 `bindtap="onCategoryTap"` 与 `bindtap="onSubTap"`、第二层区块带 `wx:if="{{subOptions.length}}"`。
  3. wxss 只 token/rpx（guard）。
- [ ] **Step 2: 实现组件 → Step 3: 全绿**
- [ ] **Step 4: 提交**

```bash
git add miniprogram/components/filter-chips miniprogram/test/filter-chips.spec.ts
git commit -m "feat(mp): controlled two-layer filter chips component"
```

---

### Task 12: wf-list 组件 + 卡片模板（pet-card / photo）

**Files:**
- Create: `miniprogram/components/wf-list/index.{json,ts,wxml,wxss}`
- Create: `miniprogram/shared/card-templates.wxml`
- Create: `miniprogram/test/wf-list.spec.ts`

**Interfaces:**
- Produces（spec §5.3 wf-list：双列瀑布流容器，输入 `items[{id,width,height}]` + 模板名，不关心内容类型；广场卡与详情相册复用）：

```ts
// component ts
properties: {
  items: { type: Array, value: [] as { id: string; width: number; height: number }[] },
  itemTemplate: { type: String, value: 'pet-card-tpl' },   // 'pet-card-tpl' | 'photo-tpl'
  columnCount: { type: Number, value: 2 },
}
data: { columns: { id: string; ratio: number }[][] }
observers: { items() { this.setData({ columns: distributeWaterfall(computeRatios(this.data.items), this.data.columnCount) }) } }
```

`wf-list/index.wxml`：

```xml
<import src="../../shared/card-templates.wxml"/>
<view class="wf-list">
  <view class="wf-col" wx:for="{{columns}}" wx:key="index" wx:for-item="col">
    <block wx:for="{{col}}" wx:key="id">
      <template is="{{itemTemplate}}" data="{{item}}"/>
    </block>
  </view>
</view>
```

`wf-list/index.wxss`：`.wf-list { display: flex; flex-direction: row; align-items: flex-start; }`、`.wf-col { flex: 1; min-width: 0; }`、两列间距用 `gap`（Skyline 支持 flex gap；若 glass-easel 不支持则第一列 `margin-right: 24rpx`，二选一在实现时确认）。

`miniprogram/shared/card-templates.wxml`（被 wf-list `<import>`，模板内变量名固定为 `item`）：

```xml
<template name="pet-card-tpl">
  <view class="card pet-card" data-id="{{item.id}}" bindtap="onItemTap">
    <view class="pet-card-cover" style="height: {{item.ratio * 323}}rpx; overflow: hidden;">
      <image class="pet-card-img" src="{{item.coverUrl}}" mode="aspectFill"/>
    </view>
    <view class="pet-card-body">
      <view class="pet-card-title">
        <text class="pet-card-name">{{item.name}}</text>
        <text class="pet-card-distance" wx:if="{{item.distanceText}}">{{item.distanceText}}</text>
      </view>
      <view class="pet-card-meta">{{item.breed}} · {{item.genderText}} · {{item.ageText}}</view>
      <view class="pet-card-tags">
        <text class="chip chip-sm" wx:for="{{item.personalityTags}}" wx:key="*this">{{item}}</text>
      </view>
      <view class="pet-card-owner">
        <image class="pet-card-avatar" src="{{item.ownerAvatarUrl}}"/>
        <text class="pet-card-owner-name">{{item.ownerNickname}}</text>
      </view>
    </view>
  </view>
</template>

<template name="photo-tpl">
  <view class="photo-cell" data-index="{{item.index}}" bindtap="onPhotoTap">
    <image class="photo-img" src="{{item.url}}" mode="aspectFill"
           style="height: {{item.ratio * 323}}rpx; width: 323rpx;"/>
  </view>
</template>
```

- 说明：模板里 `onItemTap`/`onPhotoTap` 由 wf-list 组件提供（methods），`triggerEvent('item-tap', { id })` / `('photo-tap', { index })` 上抛给页面——**模板在 wf-list 的作用域内编译，事件绑定解析到 wf-list 的方法**。`ratio` 由 wf-list 的 observer 预计算（`height/width`）后传入模板，占位高度 `ratio * 323rpx` 消除图片加载抖动（Global Constraint 14）。页面向 items 注入展示字段（`distanceText/genderText/ageText` 等在页面组装好放进 item，模板只渲染）。
- **已知风险与回退**：`<template is="{{itemTemplate}}">` 动态模板 + import 在 Skyline/glass-easel 下的兼容性需在开发者工具验证。若模板渲染失败，回退方案：页面 WXML 直接写双列 `<view class="wf-col">` + `<block wx:for>` 循环 `<pet-card pet="{{item}}"/>`（pet-card 改回独立组件，含自身 json/ts/wxss），wf-list 退化为只导 `distributeWaterfall` 纯函数 + 共享列样式类。回退不改变任何对外接口（页面数据契约一致），实现时二选一，验收以开发者工具实际渲染为准。

- [ ] **Step 1: 写失败测试** `miniprogram/test/wf-list.spec.ts`：
  1. json 合法、apply-shared。
  2. wxml 含 `<import src="../../shared/card-templates.wxml"/>`、`wx:for="{{columns}}"`、`<template is="{{itemTemplate}}".../>`。
  3. wxml 用 `bindtap="onItemTap"` / `bindtap="onPhotoTap"`（模板内）。
  4. wxss 只 token/rpx。
  5. `card-templates.wxml` 存在且含 `name="pet-card-tpl"` 与 `name="photo-tpl"`。
- [ ] **Step 2: 实现 wf-list + card-templates → Step 3: 全绿**
- [ ] **Step 4: 提交**

```bash
git add miniprogram/components/wf-list miniprogram/shared/card-templates.wxml miniprogram/test/wf-list.spec.ts
git commit -m "feat(mp): waterfall list component with pet-card and photo templates"
```

---

### Task 13: 广场页（双层筛选 + 瀑布流 + 分页 + 定位）

**Files:**
- Modify: `miniprogram/pages/plaza/index.{json,ts,wxml,wxss}`
- Create: `miniprogram/test/plaza-page.spec.ts`

**Interfaces:**
- Consumes: `locationStore.ensure()` / `locationStore.state`（`store/location.ts`）、`fetchPets`（api/pets.ts）、`distributeWaterfall`、`formatDistance`/`formatPetAge`、`breedsForSpecies`、组件 sq-button/empty-state/filter-chips/wf-list。
- Produces（页面行为契约）：
  - `data`：`filter: PetFilter`、`breedOptions: FilterOption[]`、`items: FeedItem[]`（页面组装后的瀑布流卡数据，含 `distanceText/ageText/genderText/ratio`）、`page`、`hasMore`、`loading`、`empty`、`modeText`（'精确'|'城市'）。
  - `onLoad/onShow`：`locationStore.ensure()`（失败 → 城市模式，不阻塞页面），拉第一页。
  - `onFilterChange(e)`：更新 `filter`，`breedOptions = breedsForSpecies(species)`，重置分页并重拉。
  - `onReachBottom`：`hasMore && !loading` 时拉下一页。
  - `onPullDownRefresh`：重置并重拉（`wx.stopPullDownRefresh`）。
  - `onPetTap(e)`：`wx.navigateTo('/pages/pet-detail/index?id=' + id)`。
  - 距离文案：`distanceMeters == null` → 不显示；否则 `formatDistance`。
  - 分页参数：`page`/`pageSize=10`；有坐标时带 `lat/lng`。

**文件结构（修改后）：**
- `index.json`：`{ "navigationBarTitleText": "萌宠广场", "enablePullDownRefresh": true, "onReachBottomDistance": 200, "usingComponents": { "wf-list": "/components/wf-list/index", "filter-chips": "/components/filter-chips/index", "empty-state": "/components/empty-state/index", "sq-button": "/components/sq-button/index" } }`
- `index.wxml`：顶部定位条（模式 + 「去开启」→ `wx.openSetting` 仅精确模式失败时）、`<filter-chips>`（categories=`[{value:'all',label:'全部'},{value:'dog',label:'犬'},{value:'cat',label:'猫'},{value:'other',label:'其他'}]`）、`<wf-list wx:if="{{items.length}}" items="{{items}}" itemTemplate="pet-card-tpl" bind:item-tap="onPetTap"/>`、`<empty-state wx:elif="{{!loading}}" title="没有找到合适的毛孩子" hint="换个筛选条件试试"/>`、底部 loading 态（`<sq-button type="plain" loading="{{loading}}">加载中…</sq-button>` 仅加载时）。
- `index.wxss`：只用 token/rpx；列表外层 `page-gutter` 类已由 app.wxss 提供。

- [ ] **Step 1: 写失败测试** `miniprogram/test/plaza-page.spec.ts`（页面逻辑以可测试的纯函数提取到 `pages/plaza/plaza-model.ts`——`buildFeedItem(pet: PetSummary): FeedItem`、`mergePage(prev, next)`、`shouldLoadMore(hasMore, loading)`，页面 ts 只做绑定）：
  1. `buildFeedItem`：distance 999 → `distanceText:'999m'`；null → `''`；ratio = height/width。
  2. `mergePage`：拼接 items、更新 hasMore/page。
  3. `shouldLoadMore(true,false)` → true；`(false,true)` → false。
  4. 品种联动：`breedsForSpecies('other') === []` → 页面不渲染第二层。
- [ ] **Step 2: 实现 plaza-model + 页面 → Step 3: 全绿（含 guard suite：页面不得 `wx.request`/`wx.getLocation` 直呼——定位必须经 `store/location.ts`）**
- [ ] **Step 4: 开发者工具冒烟**（见 Task 18 的验收清单，此处仅确认页面能编译、数据能拉到）
- [ ] **Step 5: 提交**

```bash
git add miniprogram/pages/plaza miniprogram/test/plaza-page.spec.ts
git commit -m "feat(mp): plaza page with dual-layer filter and waterfall feed"
```

---

### Task 14: 宠物详情页（轮播 + 资料 + 标签 + 主人 + 相册）

**Files:**
- Modify: `miniprogram/pages/pet-detail/index.{json,ts,wxml,wxss}`
- Create: `miniprogram/test/pet-detail-page.spec.ts`

**Interfaces:**
- Consumes: `fetchPetDetail`、`formatPetAge`、`formatDistance`、wf-list（photo-tpl）。
- Produces（行为契约）：
  - `onLoad({ id })` → `fetchPetDetail(id, lat, lng)`；`data.pet: PetDetail | null`、`data.album: PhotoItem[]`（`{ id, url, width, height, ratio, index }`）、`data.loading`、`data.error`。
  - 轮播：`<swiper>` + `<swiper-item>` 用 `pet.photos` 前 N 张（`indicator-dots`、`circular`），`image mode="aspectFill"`。
  - 信息区：名字 + 品种 · 性别 · 年龄；`bio`（空则隐藏该行）；`personalityTags` 用 `.chip chip-sm`。
  - 主人卡：头像 + 昵称 + 「已认证」角标（`ownerVerified`，用 `--token-color-primary` 系）。
  - 相册：`pet.photos` 全部走 wf-list（photo-tpl），`bind:photo-tap` → `wx.previewImage({ urls, current })`。
  - 距离文案同广场规则。
  - 错误态：404/网络失败 → `data.error`，渲染 empty-state + 重试按钮（`wx.navigateBack` 或重拉）。
  - `onShareAppMessage`：返回 `{ title: name, path: '/pages/pet-detail/index?id=' + id }`（分享属于浏览闭环的一部分，miniprogram 天然支持）。

- [ ] **Step 1: 写失败测试** `miniprogram/test/pet-detail-page.spec.ts`（纯函数 `miniprogram/pages/pet-detail/detail-model.ts`）：
  1. `buildDetailView(pet: PetDetail)`：返回 `{ name, metaText:'布偶 · 雌 · 2 岁', ageText, bioShown: boolean, album }`。
  2. `album` 每项含 `ratio` 与递增 `index`。
  3. `bio` 为空字符串 → `bioShown:false`。
- [ ] **Step 2: 实现 detail-model + 页面 → Step 3: 全绿 → Step 4: 提交**

```bash
git add miniprogram/pages/pet-detail miniprogram/test/pet-detail-page.spec.ts
git commit -m "feat(mp): pet detail page with carousel, profile and album"
```

---

### Task 15: 周边列表页（搜索 + 类目 chips + 卡片 + 降级）

**Files:**
- Modify: `miniprogram/pages/venue-list/index.{json,ts,wxml,wxss}`
- Create: `miniprogram/components/venue-card/index.{json,ts,wxml,wxss}`
- Create: `miniprogram/test/venue-list-page.spec.ts`
- Create: `miniprogram/test/venue-card.spec.ts`

**Interfaces:**
- Produces:
  - `venue-card` 组件（垂直列表卡片，非瀑布流）：properties `{ venue: Object }`；点击 `triggerEvent('tap', { poiId })`；渲染 name、address、`categoryLabel` chip、rating 行（`wx:if="{{venue.rating}}"`，`★ 4.8`）、人均行（`wx:if="{{venue.avgPrice}}"`，`人均 ¥120`）、tags 行、cover 图（`coverUrl` 非 null 才渲染）、距离（`distanceText`）；**extras 缺失时评分/人均行不渲染、标签区只显示 `categoryLabel`（spec §4.2 降级，卡片不留空洞）**。
  - 页面行为契约：
    - `data`：`keyword: string`、`category: 'all'|VenueCategory`、`venues: Venue[]`、`loading`、`empty`、`submitting`（防抖搜索）。
    - 搜索：input `bindinput` 防抖 300ms → `fetchVenues({ keyword, category, lat, lng })`（无坐标不发 lat/lng）。
    - 类目 chips：固定 `[{all 全部},{hospital 宠物医院},{shop 宠物店},{grooming 美容洗护},{park 宠物公园},{cafe 宠物友好}]`，点击切 category 并重拉。
    - `onVenueTap` → `wx.navigateTo('/pages/venue-detail/index?poiId=' + poiId)`。
    - 空结果 → empty-state。
    - 搜索框清空按钮；`onLoad` 时 `locationStore.ensure()` 并带坐标拉首屏。
- 页面「周边」入口在 tabBar（现有），导航栏标题「周边」。

- [ ] **Step 1: 写失败测试**（venue-card 配置/结构断言 + 页面纯函数 `pages/venue-list/venue-list-model.ts`）：
  1. venue-card json 合法、apply-shared；wxml 含 `bindtap` 与 rating/人均 `wx:if`。
  2. `buildVenueView(venue)`：rating null → `ratingText:''`；avgPrice 120 → `priceText:'人均 ¥120'`；`distanceText` 用 `formatDistance`；`tags` 空 → `[categoryLabel]`。
  3. 降级断言：`rating:null` 时 view 的 `showRating === false`。
- [ ] **Step 2: 实现 venue-card + 页面 → Step 3: 全绿 → Step 4: 提交**

```bash
git add miniprogram/components/venue-card miniprogram/pages/venue-list miniprogram/test/venue-list-page.spec.ts miniprogram/test/venue-card.spec.ts
git commit -m "feat(mp): nearby venue list with search, category chips and degraded cards"
```

---

### Task 16: 场所详情页（信息 + 降级 + 导航 + 收藏）

**Files:**
- Modify: `miniprogram/pages/venue-detail/index.{json,ts,wxml,wxss}`
- Create: `miniprogram/utils/navigation.ts`
- Create: `miniprogram/test/venue-detail-page.spec.ts`

**Interfaces:**
- Produces:
  - `miniprogram/utils/navigation.ts`：
    ```ts
    export function openMapNavigation(lat: number, lng: number, name: string): void {
      wx.openLocation({ latitude: lat, longitude: lng, name, scale: 18 });
    }
    ```
    （场所详情页需要自身坐标：`venue` DTO 不含 lat/lng——**实现时在 `Venue` DTO 增加 `lat: number | null; lng: number | null`**，服务端 POI 分支有坐标、extras 分支从 venue_extras.location 取。相应更新 Task 7 的 `VenuesService` 映射与 Task 8 的 types。此变更在 Task 8 的 types 定义里一并落实，Task 7 在实现 service 时直接带上。）
  - 页面行为契约：
    - `onLoad({ poiId })` → `fetchVenueDetail(poiId)`；`data.venue: Venue | null`、`data.favorite`、`data.loading`、`data.error`。
    - 信息区：名称、`categoryLabel` chip、地址（`<text selectable>` + 复制按钮 `wx.setClipboardData`）、评分行/人均行（`wx:if` 降级）、tags。
    - cover 大图（`coverUrl` 有则渲染）。
    - 收藏按钮：`sq-button type="{{favorite ? 'plain' : 'primary'}}"`，onTap → `addFavorite`/`removeFavorite` → 更新 `data.favorite` + `wx.showToast`。未登录（token 缺失）时 `api` 层自动登录会先完成，失败则 toast「请先登录」。
    - 导航按钮：`lat && lng` 非 null 时渲染「导航前往」→ `openMapNavigation(lat, lng, name)`；坐标缺失则不渲染该按钮。
    - 404/错误态：empty-state + 返回。

- [ ] **Step 1: 写失败测试** `miniprogram/test/venue-detail-page.spec.ts`（纯函数 `pages/venue-detail/venue-detail-model.ts`）：
  1. `canNavigate(venue)`：lat/lng 都有 → true；任一 null → false。
  2. `detailView(venue)`：rating/price 降级字段、`showFavorite` 恒 true。
- [ ] **Step 2: 实现 navigation.ts + venue-detail-model + 页面 → Step 3: 全绿 → Step 4: 提交**

```bash
git add miniprogram/utils/navigation.ts miniprogram/pages/venue-detail miniprogram/test/venue-detail-page.spec.ts
git commit -m "feat(mp): venue detail with degraded info, navigation and favorite"
```

---

### Task 17: 全量回归 + 演示验收（阶段 1 完成线）

**Files:**
- Modify: `docs/superpowers/phase0-carryforward.md`（若演示暴露新限制，追加到已知限制）
- Create: `docs/superpowers/phase1-notes.md`（阶段 1 验收记录 + 演示走查脚本）
- Create: `docs/superpowers/plans/` 内本计划的验收核对清单（或并入 phase1-notes）

**步骤（全部在 phase1-prep worktree 内）：**
- [ ] **Step 1: 全量测试**
  - server：`cd server && npx jest --runInBand`（25+ 旧用例 + 新增全绿；集成用例在无 DB 时 skip，有 DB 时全绿）。
  - miniprogram：`cd miniprogram && npm test`（167 + 新增全绿）。
  - 双包 `tsc --noEmit` 干净。
  - guard suites（style-guard、module-guard、freshness）全绿。
- [ ] **Step 2: Docker 演示环境**（需用户确认启动 Docker Desktop）：`docker compose up -d` → `DATABASE_URL` 设入 `server/.env`（本机）→ server 以 Postgres 模式启动。
- [ ] **Step 3: 演示走查**（开发者工具，touristappid + urlCheck:false）：
  1. 广场首屏：瀑布流 10 只宠物、距离由近到远、模式条显示「精确」。
  2. 筛选：切「猫」→ 第二层品种 chips 出现；选「布偶」→ 只回奶昔。
  3. 下拉刷新 + 上拉加载第二页（hasMore 逻辑）。
  4. 进详情：轮播滑动、信息/标签/主人卡、相册瀑布流、图片预览、分享卡片。
  5. 周边：搜索「医院」→ 2 家；切「公园」类目；卡片降级（无 TENCENT_MAP_KEY 时走 extras，rating/人均正常显示——用 `wx.setStorageSync` 或临时改 env 关闭 key 验证「extras 缺失 → 评分行隐藏」的另一侧：临时从 seed 删一家 rating 或在 service 层短路）。
  6. 场所详情：收藏 toggle、地址复制、导航按钮（有坐标）。
  7. 定位拒绝：关闭模拟器定位 → 城市模式 → 广场无距离文案、列表不崩。
- [ ] **Step 4: 记录 phase1-notes.md**：演示结果、发现的限制、遗留到阶段 2 的项（follow、view_history、UGC 动态、字体子集、automator 5 条主链路）。
- [ ] **Step 5: 提交**

```bash
git add docs/superpowers/phase1-notes.md docs/superpowers/phase0-carryforward.md
git commit -m "docs: phase 1 acceptance notes and demo walkthrough"
```

---

## 附录 A：Schema 与 Seed 数据（Task 1/3/5 逐字使用）

### schema.sql（完整内容）

```sql
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  openid TEXT UNIQUE NOT NULL,
  nickname TEXT NOT NULL,
  avatar_url TEXT,
  is_verified_owner BOOLEAN NOT NULL DEFAULT false,
  last_location geography(Point,4326),
  city TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pets (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  species TEXT NOT NULL CHECK (species IN ('dog','cat','other')),
  breed TEXT NOT NULL,
  gender TEXT NOT NULL CHECK (gender IN ('male','female','unknown')),
  birth_date DATE NOT NULL,
  bio TEXT NOT NULL DEFAULT '',
  personality_tags TEXT[] NOT NULL DEFAULT '{}',
  visibility TEXT NOT NULL DEFAULT 'public',
  location geography(Point,4326),
  cover_photo_id TEXT,
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pets_location_gix ON pets USING GIST (location);
CREATE INDEX IF NOT EXISTS pets_visibility_active_idx ON pets (visibility, last_active_at DESC);

CREATE TABLE IF NOT EXISTS pet_photos (
  id TEXT PRIMARY KEY,
  pet_id TEXT NOT NULL REFERENCES pets(id),
  url TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pet_photos_pet_idx ON pet_photos (pet_id, sort_order);

CREATE TABLE IF NOT EXISTS venue_extras (
  poi_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('hospital','shop','grooming','park','cafe','other')),
  rating NUMERIC(2,1),
  avg_price INTEGER,
  tags TEXT[] NOT NULL DEFAULT '{}',
  curated_photo TEXT,
  location geography(Point,4326) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS venue_extras_location_gix ON venue_extras USING GIST (location);
CREATE INDEX IF NOT EXISTS venue_extras_category_idx ON venue_extras (category);

CREATE TABLE IF NOT EXISTS favorites (
  user_id TEXT NOT NULL REFERENCES users(id),
  poi_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, poi_id)
);
```

（`pets.cover_photo_id` 不建 FK：种子插入顺序为 users → pets → photos → 回填 cover，避免循环依赖。）

### seed.sql（完整内容，`ON CONFLICT DO NOTHING` 保证幂等）

```sql
INSERT INTO users (id, openid, nickname, avatar_url, is_verified_owner) VALUES
  ('u-1','openid-huang','小陈','https://picsum.photos/seed/paw-u1/120/120',true),
  ('u-2','openid-naixi','阿喵','https://picsum.photos/seed/paw-u2/120/120',true),
  ('u-3','openid-kele','老王','https://picsum.photos/seed/paw-u3/120/120',false),
  ('u-4','openid-doubao','小周','https://picsum.photos/seed/paw-u4/120/120',false),
  ('u-5','openid-huahua','安安','https://picsum.photos/seed/paw-u5/120/120',true),
  ('u-6','openid-tuanzi','七七','https://picsum.photos/seed/paw-u6/120/120',false),
  ('u-7','openid-wangcai','老李','https://picsum.photos/seed/paw-u7/120/120',true),
  ('u-8','openid-mimi','点点','https://picsum.photos/seed/paw-u8/120/120',false)
ON CONFLICT (openid) DO NOTHING;

INSERT INTO pets (id, owner_id, name, species, breed, gender, birth_date, bio, personality_tags, location, last_active_at) VALUES
  ('p-1','u-1','大黄','dog','金毛','male','2022-05-01','爱玩水的暖男，见到谁都摇尾巴。','{"黏人","爱玩水"}',ST_SetSRID(ST_MakePoint(116.4040,39.9060),4326),'2026-08-20T10:00:00Z'),
  ('p-2','u-2','奶昔','cat','布偶','female','2024-02-14','蓝眼睛的小公主，喜欢被摸下巴。','{"温柔","爱睡觉"}',ST_SetSRID(ST_MakePoint(116.4100,39.9020),4326),'2026-08-21T08:30:00Z'),
  ('p-3','u-3','可乐','dog','柯基','male','2023-08-20','小短腿大嗓门，对零食毫无抵抗力。','{"活泼","贪吃"}',ST_SetSRID(ST_MakePoint(116.4000,39.9100),4326),'2026-08-19T18:00:00Z'),
  ('p-4','u-4','豆包','dog','柴犬','female','2021-11-11','高冷柴，出门必带围巾。','{"高冷","独立"}',ST_SetSRID(ST_MakePoint(116.4150,39.9000),4326),'2026-08-18T09:00:00Z'),
  ('p-5','u-5','花花','cat','中华田园猫','female','2023-03-08','小区明星，尾巴上有朵花。','{"粘人","怕生"}',ST_SetSRID(ST_MakePoint(116.4120,39.9080),4326),'2026-08-17T15:00:00Z'),
  ('p-6','u-6','团子','cat','英国短毛猫','male','2024-06-01','圆脸橘白，站着都能睡着。','{"安静","圆脸"}',ST_SetSRID(ST_MakePoint(116.4000,39.8950),4326),'2026-08-16T12:00:00Z'),
  ('p-7','u-7','旺财','dog','边牧','male','2022-12-25','智商担当，会开门会拿快递。','{"聪明","精力旺盛"}',ST_SetSRID(ST_MakePoint(116.4180,39.9150),4326),'2026-08-22T07:00:00Z'),
  ('p-8','u-8','咪咪','cat','美国短毛猫','female','2024-09-10','好奇心旺盛，家里的探索者。','{"好奇","活泼"}',ST_SetSRID(ST_MakePoint(116.4060,39.8990),4326),'2026-08-15T20:00:00Z')
ON CONFLICT (id) DO NOTHING;

INSERT INTO pet_photos (id, pet_id, url, width, height, sort_order) VALUES
  ('ph-1','p-1','https://picsum.photos/seed/paws-huang/600/800',600,800,0),
  ('ph-2','p-1','https://picsum.photos/seed/paws-huang2/800/600',800,600,1),
  ('ph-3','p-1','https://picsum.photos/seed/paws-huang3/600/800',600,800,2),
  ('ph-4','p-2','https://picsum.photos/seed/paws-naixi/800/600',800,600,0),
  ('ph-5','p-2','https://picsum.photos/seed/paws-naixi2/600/800',600,800,1),
  ('ph-6','p-3','https://picsum.photos/seed/paws-kele/600/800',600,800,0),
  ('ph-7','p-3','https://picsum.photos/seed/paws-kele2/900/600',900,600,1),
  ('ph-8','p-4','https://picsum.photos/seed/paws-doubao/900/600',900,600,0),
  ('ph-9','p-4','https://picsum.photos/seed/paws-doubao2/600/800',600,800,1),
  ('ph-10','p-5','https://picsum.photos/seed/paws-huahua/600/800',600,800,0),
  ('ph-11','p-5','https://picsum.photos/seed/paws-huahua2/800/800',800,800,1),
  ('ph-12','p-6','https://picsum.photos/seed/paws-tuanzi/800/800',800,800,0),
  ('ph-13','p-6','https://picsum.photos/seed/paws-tuanzi2/600/800',600,800,1),
  ('ph-14','p-7','https://picsum.photos/seed/paws-wangcai/600/900',600,900,0),
  ('ph-15','p-7','https://picsum.photos/seed/paws-wangcai2/800/600',800,600,1),
  ('ph-16','p-8','https://picsum.photos/seed/paws-mimi/700/700',700,700,0),
  ('ph-17','p-8','https://picsum.photos/seed/paws-mimi2/600/800',600,800,1)
ON CONFLICT (id) DO NOTHING;

-- 回填 cover_photo_id：第一张即封面
UPDATE pets SET cover_photo_id = 'ph-1' WHERE id = 'p-1' AND cover_photo_id IS NULL;
UPDATE pets SET cover_photo_id = 'ph-4' WHERE id = 'p-2' AND cover_photo_id IS NULL;
UPDATE pets SET cover_photo_id = 'ph-6' WHERE id = 'p-3' AND cover_photo_id IS NULL;
UPDATE pets SET cover_photo_id = 'ph-8' WHERE id = 'p-4' AND cover_photo_id IS NULL;
UPDATE pets SET cover_photo_id = 'ph-10' WHERE id = 'p-5' AND cover_photo_id IS NULL;
UPDATE pets SET cover_photo_id = 'ph-12' WHERE id = 'p-6' AND cover_photo_id IS NULL;
UPDATE pets SET cover_photo_id = 'ph-14' WHERE id = 'p-7' AND cover_photo_id IS NULL;
UPDATE pets SET cover_photo_id = 'ph-16' WHERE id = 'p-8' AND cover_photo_id IS NULL;

INSERT INTO venue_extras (poi_id, name, address, category, rating, avg_price, tags, curated_photo, location) VALUES
  ('v-1','宠福康宠物医院','朝阳区望京西路 48 号','hospital',4.8,320,'{"夜间急诊","猫友好"}','https://picsum.photos/seed/venue-v1/800/500',ST_SetSRID(ST_MakePoint(116.4050,39.9050),4326)),
  ('v-2','贝恩宠物医院','朝阳区广顺北大街 33 号','hospital',4.5,280,'{"犬猫分区","住院部"}','https://picsum.photos/seed/venue-v2/800/500',ST_SetSRID(ST_MakePoint(116.4020,39.9120),4326)),
  ('v-3','萌宠之家宠物用品店','朝阳区望京街 9 号','shop',4.6,150,'{"进口粮","美容工具"}','https://picsum.photos/seed/venue-v3/800/500',ST_SetSRID(ST_MakePoint(116.4090,39.9010),4326)),
  ('v-4','汪汪星球宠物店','朝阳区阜通东大街 12 号','shop',4.7,180,'{"活体选购","寄养"}','https://picsum.photos/seed/venue-v4/800/500',ST_SetSRID(ST_MakePoint(116.4140,39.9070),4326)),
  ('v-5','靓靓宠物美容','朝阳区望京西路 27 号','grooming',4.9,120,'{"造型设计","SPA"}','https://picsum.photos/seed/venue-v5/800/500',ST_SetSRID(ST_MakePoint(116.4060,39.9030),4326)),
  ('v-6','爪爪洗澡屋','朝阳区湖光中街 5 号','grooming',4.4,80,'{"洗护","修剪"}','https://picsum.photos/seed/venue-v6/800/500',ST_SetSRID(ST_MakePoint(116.4080,39.9100),4326)),
  ('v-7','朝阳公园宠物区','朝阳区朝阳公园南路 1 号','park',4.6,0,'{"大草坪","宠物厕所"}','https://picsum.photos/seed/venue-v7/800/500',ST_SetSRID(ST_MakePoint(116.4160,39.9080),4326)),
  ('v-8','奥森宠物公园','朝阳区科荟路 33 号','park',4.8,0,'{"围栏区","饮水点"}','https://picsum.photos/seed/venue-v8/800/500',ST_SetSRID(ST_MakePoint(116.4120,39.9150),4326)),
  ('v-9','有猫咖啡','朝阳区望京西路 19 号','cafe',4.7,45,'{"猫咪互动","咖啡"}','https://picsum.photos/seed/venue-v9/800/500',ST_SetSRID(ST_MakePoint(116.4030,39.9020),4326)),
  ('v-10','萌宠主题餐厅','朝阳区阜通西大街 8 号','cafe',4.3,88,'{"宠物餐","人宠同食"}','https://picsum.photos/seed/venue-v10/800/500',ST_SetSRID(ST_MakePoint(116.4110,39.9060),4326))
ON CONFLICT (poi_id) DO NOTHING;
```

### InMemory 种子（Task 3/5 逐字使用，与 SQL seed 一一对应）

`InMemoryPetRepository` 内部数组：8 只宠物（字段与 `PetRow` 一致；`lastActiveAt` 用 ISO 字符串，旺财 `2026-08-22T07:00:00Z` 最新）；photos 数组与 seed.sql 的 pet_photos 完全一致（17 条）。`coverUrl` 取 `sort_order=0` 那张。

`InMemoryVenueRepository` 内部数组：10 家，字段与 `VenueExtrasRow` 一致（`distanceMeters` 初始 null，查询时算）。

---

## 附录 B：PostgresPetRepository SQL（Task 3 逐字使用）

```ts
// 有坐标（lat/lng 齐备）：
const sql = `
  SELECT p.id, p.name, p.species, p.breed, p.gender, to_char(p.birth_date, 'YYYY-MM-DD') AS "birthDate",
         p.personality_tags AS "personalityTags", p.bio,
         ST_Distance(p.location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) AS "distanceMeters",
         ph.url AS "coverUrl", ph.width AS "coverWidth", ph.height AS "coverHeight",
         u.nickname AS "ownerNickname", u.avatar_url AS "ownerAvatarUrl", u.is_verified_owner AS "ownerVerified"
  FROM pets p
  JOIN pet_photos ph ON ph.id = p.cover_photo_id
  JOIN users u ON u.id = p.owner_id
  WHERE p.visibility = 'public'
    AND ($3 = 'all' OR p.species = $3)
    AND ($4 = 'all' OR p.breed = $4)
    AND ($5::float8 IS NULL OR ST_DWithin(p.location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $5))
  ORDER BY "distanceMeters" ASC
  LIMIT $6 OFFSET $7
`;
// 参数：[lng, lat, species, breed, radiusMeters, pageSize, (page-1)*pageSize]
// 无坐标：去掉 $1/$2/$5 与 distance 列（用 null::float8 AS "distanceMeters"），
//         ORDER BY p.last_active_at DESC, p.id
// hasMore：查 count(*)（同 WHERE），> offset + pageSize 为 true
```

`getById`：

```sql
SELECT p.id, p.name, p.species, p.breed, p.gender, to_char(p.birth_date, 'YYYY-MM-DD') AS "birthDate",
       p.personality_tags AS "personalityTags", p.bio,
       ph.url AS "coverUrl", ph.width AS "coverWidth", ph.height AS "coverHeight",
       u.nickname AS "ownerNickname", u.avatar_url AS "ownerAvatarUrl", u.is_verified_owner AS "ownerVerified",
       ST_Distance(p.location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) AS "distanceMeters"
FROM pets p
JOIN pet_photos ph ON ph.id = p.cover_photo_id
JOIN users u ON u.id = p.owner_id
WHERE p.id = $3
-- 无坐标：distanceMeters 用 null::float8 AS "distanceMeters"

SELECT id, url, width, height FROM pet_photos WHERE pet_id = $1 ORDER BY sort_order ASC
```

`pg` 返回 `bigint`/`numeric` 列是字符串——`ST_Distance` 返回 float8 直接是 number；`rating`（NUMERIC）在附录 D 用 `rating::float8` 转回 number。

---

## 附录 C：DTO 形状（Task 3/7/8 共用）

`PetSummary` / `PetDetail` / `PetListResponse` / `Venue` 定义见 Task 8 的 `packages/types/src/pet.ts` / `venue.ts`，服务端 `PetsService`/`VenuesService` 输出的对象字面量与之一致（camelCase 字段名逐一对应）。`Venue` 额外含 `lat: number | null; lng: number | null`（Task 16 的导航需要，服务端映射时从 location 取）。

`genderText`：`male→'公'`、`female→'母'`、`unknown→'未知'`（页面组装，不进 DTO）。

---

## 附录 D：PostgresVenueRepository SQL（Task 5 逐字使用）

```ts
// 有坐标：
const sql = `
  SELECT poi_id AS "poiId", name, address, category, rating::float8 AS rating,
         avg_price AS "avgPrice", tags, curated_photo AS "curatedPhoto",
         ST_X(location::geometry) AS lat, ST_Y(location::geometry) AS lng,
         ST_Distance(location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) AS "distanceMeters"
  FROM venue_extras
  WHERE ($3::text IS NULL OR name ILIKE '%' || $3 || '%' OR address ILIKE '%' || $3 || '%')
    AND ($4 = 'all' OR category = $4)
    AND ($5::float8 IS NULL OR ST_DWithin(location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $5))
  ORDER BY "distanceMeters" ASC
`;
// 参数：[lng, lat, keyword, category, radiusMeters]
// 无坐标：去掉 $1/$2/$5 与 distance 列（null::float8 AS "distanceMeters"），ORDER BY name
```

`getById`：同 SELECT 但 `WHERE poi_id = $1`（无坐标时不带 ST_Distance，用 `null::float8 AS "distanceMeters"`）。

---

## 自审（Self-Review）

**Spec 覆盖核对：**
- §4.2 venue_extras 降级 → Task 6/7（proxy null → extras；extras 缺 rating → 隐藏行）。
- §5.2 瀑布流 JS 分配 → Task 9（distributeWaterfall）+ Task 12（wf-list）+ Task 13/14 接入。
- §5.3 组件拆分（filter-chips/wf-list/pet-card/venue-card/empty-state/sq-button）→ Task 10/11/12/15；pet-card 以模板落地（wf-list 需要按列分发，组件形态无法动态实例化；职责与数据契约不变，已在 Task 12 注明回退方案）。
- §6 错误处理（定位拒绝→城市模式、POI 配额→fallback）→ Task 7 + Task 13/15/16。
- §7 测试策略（PostGIS 集成、5 条主链路）→ 各域 integration spec + Task 17 演示走查；testcontainers 换为 env-gated DATABASE_URL（Global Constraint 9，理由：零额外依赖、与 Redis 集成测试同款、Docker daemon 关闭时优雅 skip）。
- §8 阶段 1 功能（广场筛选/瀑布流、宠物详情、周边 POI+降级）→ Task 13/14/15/16。
- §9 YAGNI（不做附近活动 chip、点赞/评论、暗色）→ 未列入任何任务。
- 收藏（venue favorites，属于浏览闭环的保留行为）→ Task 7/16。
- 分享（宠物详情分享卡片）→ Task 14（`onShareAppMessage`）。

**Placeholder 扫描：** 无 TBD/TODO；所有任务都带具体测试断言与代码/接口签名；集成测试的「起库」步骤依赖 Docker（Global Constraint 9 已声明，且 Step 明确给出 skip 预期，不假绿）。

**类型一致性核对：**
- `PetRow`（Task 3）字段名与 `PetSummary`（Task 8）逐一对上；`VenueExtrasRow`/`Venue` 一致。
- `PoiProxyService.search` 返回 `MapPlace[] | null`，`VenuesService.search` 的降级分支按 `null` 判定（Task 6/7 一致）。
- `distributeWaterfall`（Task 9）签名 `(WaterfallItem[], columnCount)` 与 wf-list（Task 12）的 observer 调用一致；模板变量名 `item` 固定（Task 12 模板与 wf-list wxml 一致）。
- `formatDistance`/`formatPetAge`（Task 9）被 Task 13/14/15/16 复用，签名一致。
- `Venue.lat/lng` 由 Task 16 引入，Task 7 的映射与 Task 8 的 types 同步落实（Task 16 Interfaces 已注明）。
- 分页字段 `{ items, hasMore, page }` 在 Task 3/4/8 三处一致。
- `FilterOption { value, label }` 在 filter-chips（Task 11）与 plaza（Task 13）一致；`breedsForSpecies`（Task 9）被 Task 13 复用。

**风险登记：** wf-list 的 `<template is>` 动态模板在 Skyline/glass-easel 的兼容性（Task 12 已给回退方案）；无 Docker 时集成测试 skip（Global Constraint 9）；`TENCENT_MAP_KEY` 缺失时周边走纯 extras（本机常态，降级路径本身就是演示内容）。
