# 阶段 2 · 身份与社交（个人中心 · 宠物增改 · 关注 · 发布动态）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付 spec §8 阶段 2「可提交小程序审核」的完整能力：个人中心、宠物增改、关注关系与关注列表、浏览历史与收藏列表、发布动态 + 内容安全接入 + 统一审核状态机。

**Architecture:** 服务端新增 4 张表（`follows`、`view_history`、`posts`、`post_images`）与 3 个业务模块（follows、history、posts），全部沿用既有「InMemory 默认 + `DATABASE_URL` 存在时切 Postgres」双绑定（`useFactory` + `inject: [PG_POOL]`，见 `users.module.ts`）。内容安全走 `WECHAT_SESSION_API` 同款 DI seam：`CONTENT_SECURITY_API` 令牌 + 真实 `msgSecCheck`/`imgSecCheck` 实现 + `FAKE_CONTENT_SECURITY=1` 的假实现。审核状态机（spec §4.5）落成独立的纯函数模块，`posts`/`post_images` 共用。小程序端 6 个页面壳（当前 3 行）填实，个人中心为 tabBar 页，其余走 `packages/profile` 与 `packages/post` 分包。

**Tech Stack:** 沿用阶段 0/1 全部技术栈，**不新增任何依赖**。微信内容安全 `security.msgSecCheck`（v2）/ `security.imgSecCheck`，经 `AccessTokenService`（Redis 单点缓存唯一出口）取 token。图片上传沿用小程序 `wx.uploadFile` → 服务端落私有存储，本阶段先用本地磁盘 + 静态路由占位（正式对象存储属外部事项，见 spec §10）。

## Global Constraints

以下约束**每条任务的验收都隐式包含**。前 14 条继承阶段 1 计划的 Global Constraints（逐字有效，不再重复），本阶段新增：

15. **审核状态机唯一实现**：`pending → approved → pending_review → rejected` 的迁移规则只允许存在一份纯函数实现（`server/src/moderation/audit-state.ts`），`posts`/`post_images`/后续 `messages`/`pet_licenses` 全部复用。任何页面或仓储里手写状态字符串比较即为违规。
16. **未 approved 内容对他人不可见**：这是 spec §4.5 与 §7 的**过审必要条件**，必须有专门的安全测试：作者本人能看到自己 `pending` 的动态（带「审核中」角标），**其他任何用户（含未登录）都看不到**。列表、详情、关注流三条路径各自断言。
17. **`FAKE_CONTENT_SECURITY=1` 默认拒绝而非放行**：假实现**不得**把内容置为 `approved`。它跳过微信调用后一律落 `pending`，理由是若假实现直接放行，第 16 条那个安全测试就被测空了。启动时打 WARN，`RELEASE_CHECKLIST.md` 增加核对项（与 `FAKE_WECHAT_LOGIN` 同规格）。
18. **内容安全失败时 fail-closed**：`msgSecCheck` 调用失败（网络、配额、token 不可用）时内容留在 `pending`，**绝不**因为检查不了就放行。这与限流的 fail-open 取向相反，因为这里的代价不对称：放行未审内容会直接威胁小程序过审。
19. **`view_history` 幂等**：按 `(user_id, target_type, target_id)` 唯一约束 + `ON CONFLICT DO UPDATE SET viewed_at = now()`，不产生重复行（spec §4.2 明确「按 (user, target) 幂等更新时间戳」）。
20. **`follows` 的目标是宠物不是用户**：spec §4.2 写的是 `target_pet_id`。关注列表展示的是宠物卡，不是用户卡。不得擅自改成关注用户。
21. **图片尺寸非可选**：`post_images.width/height` 为瀑布流预估高度而存在（spec §4.1 明确「非可选字段」）。上传接口必须拿到真实宽高，缺失即 422。
22. **迁移只增不改**：`schema.sql` 追加新表，不修改阶段 1 已有 5 张表的既有列。迁移仍走 `runMigrations` 的 advisory lock 路径。
23. **本阶段不做私信**：`conversations`/`messages` 属阶段 3，且需先确认社交类目资质（spec §10）。`packages/chat` 的两个页面壳保持 3 行不动。

---

## 任务分组

分两组，**2A 无外部依赖可立即开工**，**2B 依赖内容安全的真实凭据**（用户已选定先用假实现开关跑通链路，故 2B 也可开工，只是过审前必须回填真实 AppID）。

| 组 | 任务 | 阻塞项 |
|---|---|---|
| 2A | Task 1–9 | 无 |
| 2B | Task 10–15 | 正式 AppID（用 `FAKE_CONTENT_SECURITY=1` 可先跑通） |
| 收口 | Task 16 | 全部 |

---

### Task 1: 数据库迁移 —— 4 张新表 + 索引 + 种子

- [ ] **RED**：`test/migrations-phase2.spec.ts` 断言 `schema.sql` 含 `follows`/`view_history`/`posts`/`post_images` 四张表；`test/postgres.integration.spec.ts` 追加断言（门控）：四表存在、`follows` 有 `(follower_id, target_pet_id)` 唯一约束、`view_history` 有 `(user_id, target_type, target_id)` 唯一约束、`posts.audit_status` 有 CHECK 约束限定四个状态值。
- [ ] **GREEN**：`server/src/database/schema.sql` 追加建表语句（逐字见附录 A）。只追加，不改动既有 5 张表。
- [ ] 追加 `seed.sql` 种子：3 条 `follows`（`u-1` 关注 `p-2`/`p-3`/`p-5`）、4 条 `view_history`、5 条 `posts`（其中 1 条 `pending` 用于第 16 条安全测试、1 条 `rejected`）、6 条 `post_images`。全部 `ON CONFLICT DO NOTHING` 保证幂等。
- [ ] 种子行数写进 `postgres.integration.spec.ts` 的计数断言，沿用阶段 1 的「只数种子前缀行」写法（`WHERE id ~ '^f-[0-9]+$'`），避免测试数据污染计数。
- [ ] **验收**：`DATABASE_URL` 存在时集成测试全绿；`runMigrations` 二次执行仍幂等（既有幂等测试覆盖）。

### Task 2: 审核状态机 —— 补 `isVisibleTo`

**已核实**：状态机在阶段 0 就已实现于 `packages/types/src/audit.ts`（`AuditStatus`、`ALLOWED`、`canTransition`、`assertTransition`、`AuditTransitionError`、`isPubliclyVisible`），并有 `test/audit.spec.ts` 覆盖全部迁移。**不要重写，也不要新建 `moderation/audit-state.ts`。**

另需修正本计划附录 B 的一处错误：既有实现允许 `rejected → pending`（作者修改重提通道，spec §6），`rejected` **不是**终态。附录 B 已更正。

- [ ] **RED**：`packages/types/test/audit.spec.ts` 追加 `isVisibleTo(status, isAuthor)` 真值表（8 种组合，见附录 B）。
- [ ] **GREEN**：在 `audit.ts` 实现 `isVisibleTo`，内部复用 `isPubliclyVisible`，不复制状态字面量。
- [ ] **验收**：新增 guard 测试扫 `server/src/`，除 `packages/types` 外不得手写 `'approved'` / `'pending_review'` 字面量比较（spec §4.5 说这五张表共用状态机，阶段 3/4 还要加 `messages`/`pet_licenses`，散落的字面量比较迟早漏掉可见性过滤）。

### Task 3: `packages/types` 扩展 + `sync:types`

- [ ] **RED**：`packages/types` 测试断言新增 DTO 形状：`FollowDto`、`ViewHistoryItemDto`、`PostDto`（含 `auditStatus`、`images`）、`PostImageDto`（含必填 `width`/`height`）、`ProfileDto`、`PetUpsertDto`。
- [ ] **GREEN**：新增类型 + 新错误码。**先核对已占用的**：`AUDIT_REJECTED:42201` 与 `LOCATION_REQUIRED:42202` 已存在，内容被审核驳回**复用 `AUDIT_REJECTED`**，不要新造 `CONTENT_REJECTED`。本阶段只新增 `FOLLOW_SELF:42203`（关注自己的宠物）与 `UPSTREAM_WECHAT_SECURITY:50203`（内容安全接口不可用）。
- [ ] 跑 `npm run sync:types` 同步到 `miniprogram/shared/types`，`sync-types` guard 保持绿。
- [ ] **验收**：`npm run build -w @paws/types` 通过；两端 `tsc --noEmit` 干净。

### Task 4: Follows 域 —— 仓储 + 服务 + 控制器

- [ ] **RED**：`test/follow-repository.spec.ts`（InMemory + 门控 Postgres 双跑）：`follow` 幂等（重复关注仍返回 true，不产生第二行）、`unfollow` 幂等、`listFollowing(userId)` 按关注时间倒序、`isFollowing` 批量查询。
- [ ] **RED**：`test/follows.controller.spec.ts`：`POST /pets/:id/follow` 未登录 401；已登录返回 `{ isFollowing: true }`；重复 POST 仍 200（幂等，非 201）；`DELETE` 返回 `{ isFollowing: false }`；关注自己的宠物返回 422 `42203`；关注不存在的宠物 404。
- [ ] **GREEN**：`FollowRepository` 接口 + `InMemoryFollowRepository` + `PostgresFollowRepository`（`INSERT ... ON CONFLICT DO NOTHING`）；`FollowsModule` 用 `useFactory` + `inject: [PG_POOL]` 双绑定。
- [ ] `GET /pets/:id` 与 `GET /pets` 的响应追加 `isFollowing` 字段（登录态才有值，未登录为 `false`），沿用 `favorites` 的 `isFavorite` 批量查询写法避免 N+1。
- [ ] **验收**：`follows` 的外键要求宠物与用户真实存在 —— 集成测试断言 FK 生效（这条在阶段 1 的 `PostgresUserRepository` 缺失时踩过坑）。

### Task 5: `GET /me/following` —— 我关注的宠物列表

- [ ] **RED**：未登录 401；已登录返回宠物卡数组（含封面、宽高、距离可选）、`hasMore`、按关注时间倒序；分页 `page`/`pageSize` 生效。
- [ ] **GREEN**：`FollowsController` 增加端点，复用 `PetsService` 的卡片投影逻辑（不复制 SQL）。
- [ ] **验收**：无坐标时 `distanceMeters: null`（沿用阶段 1 城市模式约定）。

### Task 6: View History 域 —— 幂等写入 + 列表

- [x] **RED**：`test/view-history-repository.spec.ts`：同一 `(user, target)` 重复 `record` 只更新 `viewed_at` 不新增行（Global Constraint 19）；`list` 按 `viewed_at` 倒序；`target_type` 支持 `pet`/`venue` 两种。
- [x] **RED**：`GET /me/history` 未登录 401；返回混合类型条目，每条带 `targetType` 与投影后的卡片数据。
- [x] **GREEN**：仓储双绑定 + `HistoryModule` + 控制器。写入时机：`GET /pets/:id` 与 `GET /venues/:id` 在登录态下**异步**记录（不阻塞响应，失败只写日志 —— 浏览历史丢一条不值得让详情页 500）。
- [x] **验收**：未登录访问详情页不写历史、不报错；写入失败时详情页仍 200（用 mock 仓储抛错断言）。

### Task 7: `GET /me/favorites` —— 收藏列表（含 favorites 表迁移）

**已核实的既有偏差**：spec §4.2 要求 `favorites` 有 `target_type`(pet/venue) + `target_id`，但阶段 1 实际建的是 `(user_id TEXT, poi_id TEXT)` 复合主键，**只支持场所收藏**。宠物详情页的收藏心标（spec `_2`）在阶段 1 没有真正落地。这是本任务必须先处理的前置项。

- [ ] **RED**：迁移测试 —— 新增 `target_type`/`target_id` 列，既有 `poi_id` 数据迁为 `('venue', poi_id)`，唯一约束改为 `(user_id, target_type, target_id)`。迁移必须幂等（`runMigrations` 会重复执行）。
- [ ] **GREEN**：迁移语句用 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` + 数据回填 + 换主键。**这违反 Global Constraint 22「只增不改」**——属有意例外，因为不改就无法满足 spec §4.2，且阶段 1 的表结构本身是偏差。在 `phase2-notes.md` 的「与计划的偏差」里记录。
- [ ] **GREEN**：`FavoriteRepository` 的 `isFavorite`/`add`/`remove` 签名加 `targetType` 参数，既有 venues 调用点全部更新；补 `listByUser`（阶段 1 只有 `isFavorite`/`add`/`remove`）。
- [ ] **RED**：`GET /me/favorites` 未登录 401；返回 pet 与 venue 两类收藏，按收藏时间倒序；分页生效。
- [ ] **RED**：`POST /pets/:id/favorite` / `DELETE`（宠物收藏，阶段 1 缺失）。
- [ ] **验收**：阶段 1 的场所收藏用例全部仍绿（迁移不能破坏既有行为）；两类卡片投影都正确。

### Task 8: `GET /me` + `PATCH /me` —— 个人中心资料

- [ ] **RED**：`GET /me` 未登录 401；已登录返回昵称、头像、宠物数、关注数、收藏数聚合计数。`PATCH /me` 可改昵称与头像；昵称空串或超 20 字 422。
- [ ] **GREEN**：`UsersController`（当前只有 service）+ 聚合计数查询（单条 SQL 用子查询，不要 4 次往返）。
- [ ] **验收**：昵称为阶段 1 占位值「微信用户」的用户能正常改名（`PostgresUserRepository.create` 落的就是这个占位值）。

### Task 9: 宠物增改 —— `POST /pets` + `PATCH /pets/:id` + 删除

- [ ] **RED**：未登录 401；创建返回宠物 id；改别人的宠物 403；必填校验（名字、物种）422；物种非法 422（复用阶段 1 的 `species` 白名单）；`DELETE /pets/:id` 软删或硬删（选硬删 + FK cascade，本阶段无审计要求）。
- [ ] **RED**：宠物照片 `pet_photos` 的增删；`is_cover` 唯一性（一只宠物只能有一张封面）。
- [ ] **GREEN**：`PetsController` 增加写端点；`PetRepository` 补 `create`/`update`/`remove`；照片走 Task 11 的上传通道。
- [ ] **验收**：创建的宠物立即出现在 `GET /pets`（若坐标在范围内）与 `GET /me` 的宠物数里。

---

## 2B：内容安全与 UGC（可用假实现开关先跑通）

### Task 10: 内容安全 DI seam + 假实现开关

- [ ] **RED**：`test/content-security.spec.ts`：`shouldFakeContentSecurity(raw)` 只认 `'1'`（`'true'`/`'0'`/`undefined` 全为 false，与 `shouldFakeWechatLogin` 同规格）。
- [ ] **RED**：`test/content-security-wiring.spec.ts`：`FAKE_CONTENT_SECURITY=1` 时容器解析到假实现且启动打 WARN；未设时解析到真实现。用 `useFactory` provider（**不是**在 `@Module` 装饰器里调函数 —— 装饰器在 import 时求值，读不到测试设的 env，阶段 1 踩过这个坑）。
- [ ] **RED**：假实现的返回值断言 —— **必须是 `pending`，不能是 `approved`**（Global Constraint 17）。这条测试是防止有人「顺手」把假实现改成放行。
- [ ] **GREEN**：`CONTENT_SECURITY_API` 令牌 + `WechatContentSecurityApi`（真实 `msgSecCheck`/`imgSecCheck`，经 `AccessTokenService` 取 token）+ `FakeContentSecurityApi`。
- [ ] **GREEN**：真实实现的失败路径 fail-closed（Global Constraint 18）：任何异常都返回「未通过」而非「通过」，`errcode`/`errmsg` 仅写日志（Global Constraint 5）。
- [ ] **验收**：`RELEASE_CHECKLIST.md` 增加 `FAKE_CONTENT_SECURITY` 核对项；`README.md` 「已知问题」说明本地行为。

### Task 11: 图片上传通道

- [ ] **RED**：`POST /uploads` 未登录 401；缺 `width`/`height` 返回 422（Global Constraint 21）；非图片 MIME 422；超过尺寸上限 422；成功返回可访问 URL + 落库所需的 key。
- [ ] **GREEN**：上传端点 + 本地磁盘存储 + 静态路由。**注意**：证件照走私有桶是阶段 4 的合规硬约束，本阶段的动态图片是公开内容，可走公开路径；但存储抽象要留出私有/公开两档，避免阶段 4 重写。
- [ ] **验收**：上传的图片经 `imgSecCheck`（或假实现）后才置 `approved`；未过审图片的 URL 对他人返回 404 而非直接可访问。

### Task 12: Posts 域 —— 发布 + 列表 + 详情

- [ ] **RED**：`POST /posts` 未登录 401；空内容 422；内容超长 422；成功返回 `auditStatus: 'pending'`（**不是** `approved`，即使内容安全通过也要走状态机）。
- [ ] **RED**：`GET /posts?petId=` 列表、`GET /posts/:id` 详情；分页生效；按 `published_at` 倒序。
- [ ] **GREEN**：`PostRepository` 双绑定 + `PostsModule` + 控制器；发布流程：落 `pending` → 调内容安全 → 按状态机迁移 → 更新状态。内容安全调用**不阻塞响应**（先返回 `pending`，异步检查），失败留 `pending`。
- [ ] **验收**：`post_images` 与 `posts` 的审核状态独立 —— 文字过审但某张图未过审时，该图不返回，文字正常显示。

### Task 13: 可见性安全测试（过审必要条件）

- [ ] **RED**：这是 Global Constraint 16 的专项测试，独立成文件 `test/post-visibility.security.spec.ts`：
  - 作者本人 `GET /posts?petId=` 能看到自己的 `pending` 与 `rejected` 动态，带 `auditStatus` 供角标使用
  - **其他登录用户**看不到（列表不含、详情 404）
  - **未登录用户**看不到（列表不含、详情 404）
  - 关注流 `GET /me/feed`（若本阶段实现）同样过滤
  - `approved` 后所有人可见
- [ ] **验收**：这 5 条断言必须全部真跑过 Postgres（门控），不能只在 InMemory 上验 —— 可见性过滤是 SQL WHERE 子句，InMemory 实现容易与 SQL 行为不一致。

### Task 14: 小程序端 API 层 + 纯函数

- [ ] **RED**：`miniprogram/test/` 新增用例：`api/follows.ts`、`api/posts.ts`、`api/me.ts` 的请求参数拼装；`buildPostView`（含审核角标可见性：`pending` 显示「审核中」、`rejected` 显示「未通过」+ 原因、`approved` 不显示角标）。
- [ ] **GREEN**：API 层沿用 `api/request.ts`（Global Constraint 3，页面不得直接 `wx.request`）；`audit-badge` 组件（spec §5.3 已列出）。
- [ ] **验收**：`wx-guard` / `style-guard` / `module-guard` / `sync-types` 全绿。

### Task 15: 小程序端 6 个页面

- [ ] **RED**：每页各自的 markup 与数据装配测试（沿用阶段 1 的页面测试写法）。
- [ ] **GREEN** 按顺序填实：
  - `pages/profile/index`（tabBar 页，8 行 → 资料头 + 计数 + 入口列表）
  - `packages/profile/pages/pet-edit/index`（宠物增改表单 + 图片上传）
  - `packages/profile/pages/following/index`（关注列表，复用 wf-list）
  - `packages/profile/pages/favorites/index`（收藏列表，pet/venue 混排）
  - `packages/profile/pages/history/index`（浏览历史，按日期分组）
  - `packages/profile/pages/my-posts/index` + `packages/post/pages/compose/index`（我的动态 + 发布）
- [ ] **验收**：`app.json` 分包声明与实际路径一致（`app-json` guard 覆盖）；发布页的图片选择走 `wx.chooseMedia` 并拿到真实宽高（Global Constraint 21）。

### Task 16: 全量回归 + 阶段 2 验收

- [ ] 三个包全量测试绿：server（真库 + 真 Redis 与无库无 Redis 两种环境各跑一次）、miniprogram、`@paws/types`。
- [ ] `tsc --noEmit` 三处干净；`npm run build` 通过。
- [ ] 端到端演示走查（真实 HTTP，仿阶段 1 的做法逐条记录响应）：登录 → 改资料 → 建宠物 → 传图 → 关注 → 发动态 → 验可见性 → 看历史与收藏。
- [ ] 写 `docs/superpowers/phase2-notes.md`，格式对齐 `phase1-notes.md`：自动化回归表、演示走查、本轮暴露的限制、与计划的偏差、遗留到阶段 3。
- [ ] 更新 `RELEASE_CHECKLIST.md` 与 `README.md`。
- [ ] **过审前必办**（写进 notes 的遗留项）：把 `FAKE_CONTENT_SECURITY` 关掉、用正式 AppID 真跑一次 `msgSecCheck`/`imgSecCheck`，验证 Task 10 的真实实现路径。假实现只证明了链路接得上，没证明微信那端的调用是对的。

---

## 附录 A：新增 schema（Task 1 逐字使用）

**主键类型注意**：既有 schema 的 `users.id` / `pets.id` 都是 `TEXT`（不是 `uuid`），值形如 `u-1`、`p-2`。新表的外键必须同为 `TEXT`，否则建表直接失败。

```sql
-- 关注关系。spec §4.2：目标是宠物不是用户。
CREATE TABLE IF NOT EXISTS follows (
  id           TEXT PRIMARY KEY,
  follower_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_pet_id TEXT NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (follower_id, target_pet_id)
);
CREATE INDEX IF NOT EXISTS follows_follower_idx ON follows (follower_id, created_at DESC);

-- 浏览历史。spec §4.2：按 (user, target) 幂等更新时间戳。
CREATE TABLE IF NOT EXISTS view_history (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('pet', 'venue')),
  target_id   TEXT NOT NULL,
  viewed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, target_type, target_id)
);
CREATE INDEX IF NOT EXISTS view_history_user_idx ON view_history (user_id, viewed_at DESC);

-- 动态。audit_status 走 spec §4.5 统一状态机。
CREATE TABLE IF NOT EXISTS posts (
  id           TEXT PRIMARY KEY,
  pet_id       TEXT NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  author_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content      TEXT NOT NULL,
  audit_status TEXT NOT NULL DEFAULT 'pending'
               CHECK (audit_status IN ('pending', 'approved', 'pending_review', 'rejected')),
  reject_reason TEXT,
  published_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- 可见性过滤是最热的查询路径，状态入索引。
CREATE INDEX IF NOT EXISTS posts_pet_visible_idx
  ON posts (pet_id, audit_status, published_at DESC);
CREATE INDEX IF NOT EXISTS posts_author_idx ON posts (author_id, published_at DESC);

-- 动态图片。width/height 为瀑布流预估高度而存在，spec §4.1 明确非可选。
CREATE TABLE IF NOT EXISTS post_images (
  id           TEXT PRIMARY KEY,
  post_id      TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  url          TEXT NOT NULL,
  width        INTEGER NOT NULL CHECK (width > 0),
  height       INTEGER NOT NULL CHECK (height > 0),
  sort_order   INTEGER NOT NULL DEFAULT 0,
  audit_status TEXT NOT NULL DEFAULT 'pending'
               CHECK (audit_status IN ('pending', 'approved', 'pending_review', 'rejected'))
);
CREATE INDEX IF NOT EXISTS post_images_post_idx ON post_images (post_id, sort_order);
```

## 附录 B：审核状态机迁移表（Task 2 逐字使用）

**这一节描述的是既有实现（`packages/types/src/audit.ts` 的 `ALLOWED`），不是待建规格。**

| from | to | 含义 |
|---|---|---|
| `pending` | `approved` | 机审通过 |
| `pending` | `rejected` | 机审驳回 |
| `approved` | `pending_review` | 被举报，撤下待人工复核 |
| `pending_review` | `approved` | 举报不成立，恢复可见 |
| `pending_review` | `rejected` | 人工驳回 |
| `rejected` | `pending` | **作者修改重提**（spec §6）。`rejected` 不是终态 |

其余组合非法，`assertTransition` 抛 `AuditTransitionError`。

可见性真值表（`isVisibleTo`）：

| status | 作者本人 | 他人 / 未登录 |
|---|---|---|
| `pending` | 可见（「审核中」角标） | 不可见 |
| `approved` | 可见 | 可见 |
| `pending_review` | 可见（「审核中」角标） | **不可见** |
| `rejected` | 可见（「未通过」+ 原因） | 不可见 |

`pending_review` 对他人不可见是有意的：内容被举报后应先撤下再人工复核，而不是继续公开展示。

## 自审（Self-Review）

- **为什么 2B 不真等 AppID**：用户选定「做假实现开关，先跑通链路」。风险已在 Global Constraint 17/18 与 Task 16 末条对冲 —— 假实现默认 `pending` 而非放行，可见性安全测试因此仍然有效；真实调用路径的验证作为过审前必办项留在 notes 里，不会被悄悄跳过。
- **为什么内容安全 fail-closed 而限流 fail-open**：代价不对称。限流失效的代价是被刷（可观测、可事后补救），未审内容放行的代价是小程序过审失败（不可逆、影响整个项目上线）。两个方向都写进了 Global Constraints，避免后来者以「保持一致」为由改错方向。
- **状态字面量的 guard 是否过度**：不是。spec §4.5 说这五张表共用状态机，阶段 3/4 还会加 `messages`/`pet_licenses`。允许各处手写 `=== 'approved'` 的话，第 16 条那个过审必要条件迟早会在某个新路径上漏掉。
- **可见性测试为何必须跑真 Postgres**：过滤逻辑落在 SQL WHERE 子句里，InMemory 实现是另一份代码。只在 InMemory 上验会漏掉 SQL 侧的错误，而这条恰好是过审必要条件。
- **未覆盖的**：`GET /me/feed`（关注流）在 Task 13 里以「若本阶段实现」出现——它不在 spec §8 阶段 2 的完成标志里，属可选。若时间紧可推到阶段 3，但 Task 13 的可见性断言要相应减一条。
- **写计划时核对出的三处事实错误**（已修，记此备忘）：① 附录 A 初稿把新表主键写成 `uuid`，实际既有 schema 的 `users.id`/`pets.id` 全是 `TEXT`（值形如 `u-1`/`p-2`），FK 类型不匹配会直接建表失败；② 初稿新造 `CONTENT_REJECTED` 错误码，实际 `AUDIT_REJECTED:42201` 已存在且语义相同，且 `42202` 已被 `LOCATION_REQUIRED` 占用；③ Task 7 初稿假定 `favorites` 有 `target_type`，实际阶段 1 建的是 `(user_id, poi_id)`，只支持场所收藏——这是与 spec §4.2 的真实偏差，已升级为该任务的前置迁移项。**教训**：计划里的表结构与错误码必须对着仓库核，不能照 spec 抄。

