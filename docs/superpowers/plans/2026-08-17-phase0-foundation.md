# 阶段 0 · 地基 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 搭出萌宠社交圈的 monorepo 骨架，让小程序空壳能跑通登录、渲染出设计系统样式、并通过 CI 上传体验版。

**Architecture:** npm workspaces 单仓，三个工作区：`packages/types`（前后端共享的 DTO 与领域规则，含年龄渲染和审核状态机）、`server`（NestJS + PostGIS + Redis）、`miniprogram`（原生小程序 + TypeScript + Skyline）。共享类型编译后由脚本同步进小程序目录，CI 校验同步产物不过期。设计 token 由 `stitch_/paws_paths/DESIGN.md` 编译生成，不手写。

**Tech Stack:** TypeScript 5.4、NestJS 10、Node 20、Jest 29、ioredis、jsonwebtoken、yaml、miniprogram-ci、miniprogram-automator

## Global Constraints

- 共享领域规则一律写在 `packages/types`，前后端不得各写一份（年龄渲染、审核状态机、错误码）。
- 单位换算固定 `1px = 2rpx`、`1rem = 16px = 32rpx`；`margin-mobile: 20px` 必须编译为 `40rpx`。
- 设计 token 唯一来源是 `stitch_/paws_paths/DESIGN.md` 的 frontmatter，禁止在 wxss 里写十六进制色值或裸 px。
- 审核状态机四态：`pending` / `approved` / `rejected` / `pending_review`；只有 `approved` 对他人可见。
- `access_token` 只允许通过 Redis 单点缓存获取，业务代码不得直接调用微信 token 接口。
- 接口响应统一信封 `{ code, message, data }`，`code: 0` 表示成功。
- 小程序端页面不得直接调用 `wx.request`，必须经 `api/request.ts`。
- 位置信息只能通过 `store/location.ts` 获取，页面不得直接调用 `wx.getLocation`。
- tabBar 页面必须位于主包（平台硬性约束）。
- 提交信息用 Conventional Commits 前缀（`feat:` / `test:` / `chore:` / `fix:`）。

## 对 spec 的一处修正

spec §5.1 把「周边」「个人中心」整包放入分包，但微信要求 tabBar 页面位于主包。本计划采用的正确结构：

- **主包**：`pages/plaza`（广场 tab）、`pages/venue-list`（周边 tab）、`pages/profile`（我的 tab）、`pages/pet-detail`（分享落地页）、`custom-tab-bar`、公共组件与样式
- **分包**：`packages/venue`（场所详情）、`packages/profile`（宠物编辑、我关注的、我的动态、收藏、浏览历史、设置）、`packages/cert`、`packages/chat`、`packages/post`

三个 tab 入口页只做数据拉取与列表渲染，重逻辑下沉到分包页面，主包体积仍受控。

---

## 文件结构

```
package.json                          npm workspaces 根，聚合 test 与 sync:types 脚本
tsconfig.base.json                    共享编译选项
project.config.json                   微信开发者工具项目配置（miniprogramRoot 指向 miniprogram/）
packages/types/
  src/age.ts                          宠物年龄渲染规则
  src/audit.ts                        审核状态机
  src/api.ts                          响应信封、错误码、中文文案表
  src/index.ts                        统一出口
server/
  .env.example                        环境变量清单（真值不入库）
  src/main.ts                         启动入口
  src/app.module.ts                   根模块
  src/common/api-exception.ts         业务错误码与 HTTP 状态解耦
  src/common/response.interceptor.ts  成功响应包装为信封
  src/common/all-exceptions.filter.ts 异常映射为信封 + 中文文案
  src/health/health.controller.ts     GET /health
  src/wechat/token-store.ts           TokenStore 接口 + Redis 实现
  src/wechat/access-token.service.ts  access_token 单点缓存 + 分布式锁
  src/wechat/wechat-api.service.ts    code2Session / 拉取 access_token
  src/wechat/wechat.module.ts         微信相关 provider 装配
  src/users/user.repository.ts        UserRepository 接口 + 内存实现（阶段 1 换 PostGIS）
  src/users/users.service.ts          按 openid upsert 用户
  src/auth/auth.service.ts            登录编排 + 签发 JWT
  src/auth/auth.controller.ts         POST /auth/wx-login
miniprogram/
  app.json                            分包骨架、tabBar、requiredPrivateInfos
  app.ts                              冷启动预热登录态
  app.wxss                            引入 tokens.wxss 与 semantic.wxss
  sitemap.json                        页面收录规则
  config.ts                           API 域名（必须是备案白名单域名）
  styles/tokens.wxss                  由 DESIGN.md 生成，禁止手改
  styles/semantic.wxss                语义类，只引用 token 变量
  shared/types/                       由 packages/types 同步而来，禁止手改
  api/errors.ts                       ApiError（带业务错误码）
  api/wx-promise.ts                   wx.request / wx.login / wx.getLocation 的 Promise 包装
  api/request.ts                      统一请求层（401 静默重登重放）
  api/client.ts                       全局单例 api / session
  store/session.ts                    登录态单点持有
  store/location.ts                   位置信息单点持有 + 城市模式降级
  utils/tab-bar.ts                    页面 onShow 同步 tab 高亮
  assets/icons/paw|place|person.svg   图标源文件，用 currentColor 声明可着色处
  components/wf-icon/index.*          图标组件（查生成的 data URI 表）
  components/wf-icon/icons.ts         由 SVG + DESIGN.md 色板生成，禁止手改
  custom-tab-bar/tabs.ts              tab 清单 + 路由到索引的映射
  custom-tab-bar/index.*              自定义 tabBar（胶囊高亮 + 上方软阴影）
  pages/plaza|venue-list|profile|pet-detail/    主包页面（前三个是 tab）
  packages/venue|profile|cert|chat|post/        五个分包
  tools/build-tokens.ts               DESIGN.md → tokens.wxss
  tools/build-icons.ts                SVG + 色板 → components/wf-icon/icons.ts
  tools/style-guard.ts                查 hex 字面量 / 裸 px / 未定义 token
  tools/sync-types.ts                 packages/types/dist → shared/types
  tools/upload-args.ts                版本号与环境变量解析（纯函数，可测）
  tools/upload.ts                     miniprogram-ci 上传体验版
.github/workflows/ci.yml              测试 + 生成物漂移校验 + 打 tag 上传
```


---

### Task 1: Monorepo 骨架 + 宠物年龄规则

**Files:**
- Create: `package.json`、`tsconfig.base.json`、`.gitignore`
- Create: `packages/types/package.json`、`packages/types/tsconfig.json`、`packages/types/jest.config.js`
- Create: `packages/types/src/age.ts`、`packages/types/src/index.ts`
- Test: `packages/types/test/age.spec.ts`

**Interfaces:**
- Consumes: 无（首个任务）
- Produces: `formatPetAge(birthDate: string, now?: Date): { value: number; unit: 'year' | 'month'; text: string }`

- [ ] **Step 1: 初始化 git 仓库与工作区根配置**

```bash
git init
```

`package.json`：

```json
{
  "name": "paws-paths",
  "private": true,
  "workspaces": ["packages/*", "server", "miniprogram"],
  "scripts": {
    "test": "npm run test --workspaces --if-present",
    "build": "npm run build --workspaces --if-present"
  },
  "devDependencies": {
    "typescript": "5.4.5",
    "jest": "29.7.0",
    "ts-jest": "29.1.2",
    "@types/jest": "29.5.12",
    "@types/node": "20.12.7"
  }
}
```

`tsconfig.base.json`：

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "CommonJS",
    "moduleResolution": "node",
    "strict": true,
    "declaration": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

`.gitignore`：

```
node_modules/
dist/
*.log
server/.env
miniprogram/project.private.config.json
```

- [ ] **Step 2: 建立 types 工作区配置**

`packages/types/package.json`：

```json
{
  "name": "@paws/types",
  "version": "0.1.0",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "jest"
  }
}
```

`packages/types/tsconfig.json`：

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src"]
}
```

`packages/types/jest.config.js`：

```js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/**/*.spec.ts'],
};
```

- [ ] **Step 3: 写失败测试**

`packages/types/test/age.spec.ts`：

```ts
import { formatPetAge } from '../src/age';

const NOW = new Date('2026-08-17T00:00:00Z');

describe('formatPetAge', () => {
  it('满 11 个月显示月龄', () => {
    expect(formatPetAge('2025-09-17', NOW).text).toBe('11个月');
  });

  it('满 12 个月切换为岁', () => {
    expect(formatPetAge('2025-08-17', NOW)).toEqual({ value: 1, unit: 'year', text: '1岁' });
  });

  it('差一天不满 12 个月仍显示月龄', () => {
    expect(formatPetAge('2025-08-18', NOW).text).toBe('11个月');
  });

  it('原型上的 8 个月与 2 岁都能复现', () => {
    expect(formatPetAge('2025-12-17', NOW).text).toBe('8个月');
    expect(formatPetAge('2024-08-17', NOW).text).toBe('2岁');
  });

  it('岁数向下取整，不四舍五入', () => {
    expect(formatPetAge('2024-10-17', NOW).text).toBe('1岁');
  });

  it('出生日期在未来时归零，不出现负数', () => {
    expect(formatPetAge('2027-01-01', NOW)).toEqual({ value: 0, unit: 'month', text: '0个月' });
  });
});
```

- [ ] **Step 4: 运行测试确认失败**

```bash
npm install
npm test -w @paws/types
```

预期：FAIL，报 `Cannot find module '../src/age'`。

- [ ] **Step 5: 实现最小代码**

`packages/types/src/age.ts`：

```ts
export type AgeUnit = 'year' | 'month';

export interface PetAge {
  value: number;
  unit: AgeUnit;
  text: string;
}

/**
 * 宠物年龄按月计算：不足 12 个月显示月龄，满 12 个月显示岁数（向下取整）。
 * 原型上「8个月」「2岁」是同一规则的两种渲染，不可落库为文本。
 */
export function formatPetAge(birthDate: string, now: Date = new Date()): PetAge {
  const birth = new Date(`${birthDate}T00:00:00Z`);
  let months =
    (now.getUTCFullYear() - birth.getUTCFullYear()) * 12 +
    (now.getUTCMonth() - birth.getUTCMonth());
  if (now.getUTCDate() < birth.getUTCDate()) {
    months -= 1;
  }
  if (months < 0) {
    months = 0;
  }
  if (months < 12) {
    return { value: months, unit: 'month', text: `${months}个月` };
  }
  const years = Math.floor(months / 12);
  return { value: years, unit: 'year', text: `${years}岁` };
}
```

`packages/types/src/index.ts`：

```ts
export * from './age';
```

- [ ] **Step 6: 运行测试确认通过**

```bash
npm test -w @paws/types
```

预期：PASS，6 个用例全绿。

- [ ] **Step 7: 提交**

```bash
git add package.json tsconfig.base.json .gitignore packages/types
git commit -m "feat: bootstrap monorepo with shared pet age rule"
```

---

### Task 2: 审核状态机

**Files:**
- Create: `packages/types/src/audit.ts`
- Modify: `packages/types/src/index.ts`
- Test: `packages/types/test/audit.spec.ts`

**Interfaces:**
- Consumes: 无
- Produces: `AuditStatus`、`canTransition(from, to): boolean`、`assertTransition(from, to): void`、`AuditTransitionError`、`isPubliclyVisible(status): boolean`

- [ ] **Step 1: 写失败测试**

`packages/types/test/audit.spec.ts`：

```ts
import {
  assertTransition,
  AuditTransitionError,
  canTransition,
  isPubliclyVisible,
} from '../src/audit';

describe('审核状态机', () => {
  it('机审通过与机审驳回都是合法转移', () => {
    expect(canTransition('pending', 'approved')).toBe(true);
    expect(canTransition('pending', 'rejected')).toBe(true);
  });

  it('已通过的内容被举报后进入复审', () => {
    expect(canTransition('approved', 'pending_review')).toBe(true);
  });

  it('复审可人工通过或人工驳回', () => {
    expect(canTransition('pending_review', 'approved')).toBe(true);
    expect(canTransition('pending_review', 'rejected')).toBe(true);
  });

  it('驳回后允许作者修改重提', () => {
    expect(canTransition('rejected', 'pending')).toBe(true);
  });

  it('拦截跳过审核的非法转移', () => {
    expect(canTransition('rejected', 'approved')).toBe(false);
    expect(canTransition('pending', 'pending_review')).toBe(false);
    expect(canTransition('approved', 'rejected')).toBe(false);
  });

  it('assertTransition 对非法转移抛出可识别错误', () => {
    expect(() => assertTransition('rejected', 'approved')).toThrow(AuditTransitionError);
    expect(() => assertTransition('pending', 'approved')).not.toThrow();
  });

  it('只有 approved 对他人可见', () => {
    expect(isPubliclyVisible('approved')).toBe(true);
    expect(isPubliclyVisible('pending')).toBe(false);
    expect(isPubliclyVisible('pending_review')).toBe(false);
    expect(isPubliclyVisible('rejected')).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npm test -w @paws/types -- audit
```

预期：FAIL，报 `Cannot find module '../src/audit'`。

- [ ] **Step 3: 实现最小代码**

`packages/types/src/audit.ts`：

```ts
export type AuditStatus = 'pending' | 'approved' | 'rejected' | 'pending_review';

/**
 * 状态机对应 spec §4.5。
 * rejected → pending 是作者修改重提通道（spec §6）。
 * pending_review → approved 是举报不成立时恢复可见。
 */
const ALLOWED: Record<AuditStatus, readonly AuditStatus[]> = {
  pending: ['approved', 'rejected'],
  approved: ['pending_review'],
  pending_review: ['approved', 'rejected'],
  rejected: ['pending'],
};

export class AuditTransitionError extends Error {
  constructor(
    readonly from: AuditStatus,
    readonly to: AuditStatus,
  ) {
    super(`illegal audit transition: ${from} -> ${to}`);
    this.name = 'AuditTransitionError';
  }
}

export function canTransition(from: AuditStatus, to: AuditStatus): boolean {
  return ALLOWED[from].includes(to);
}

export function assertTransition(from: AuditStatus, to: AuditStatus): void {
  if (!canTransition(from, to)) {
    throw new AuditTransitionError(from, to);
  }
}

/** 未达 approved 的内容对他人一律不可见，作者本人另行渲染「审核中」角标。 */
export function isPubliclyVisible(status: AuditStatus): boolean {
  return status === 'approved';
}
```

`packages/types/src/index.ts` 追加一行：

```ts
export * from './audit';
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npm test -w @paws/types
```

预期：PASS，年龄与审核共 13 个用例全绿。

- [ ] **Step 5: 提交**

```bash
git add packages/types
git commit -m "feat: add audit status machine with visibility rule"
```

---

### Task 3: 响应信封与错误码表

**Files:**
- Create: `packages/types/src/api.ts`
- Modify: `packages/types/src/index.ts`
- Test: `packages/types/test/api.spec.ts`

**Interfaces:**
- Consumes: 无
- Produces: `ApiResponse<T>`、`ERROR_CODES`、`ERROR_MESSAGES`、`messageForCode(code, fallbackFromServer?): string`

- [ ] **Step 1: 写失败测试**

`packages/types/test/api.spec.ts`：

```ts
import { ERROR_CODES, ERROR_MESSAGES, messageForCode } from '../src/api';

describe('错误码表', () => {
  it('成功码固定为 0', () => {
    expect(ERROR_CODES.OK).toBe(0);
  });

  it('每个非成功错误码都有中文文案', () => {
    const codes = Object.values(ERROR_CODES).filter((c) => c !== ERROR_CODES.OK);
    for (const code of codes) {
      expect(ERROR_MESSAGES[code]).toBeTruthy();
    }
  });

  it('服务端文案优先于本地文案', () => {
    expect(messageForCode(ERROR_CODES.VALIDATION_FAILED, '犬证编号格式不正确')).toBe(
      '犬证编号格式不正确',
    );
  });

  it('服务端没给文案时回落到本地表', () => {
    expect(messageForCode(ERROR_CODES.UNAUTHORIZED)).toBe('登录已过期，请重试');
  });

  it('未知错误码回落到兜底文案', () => {
    expect(messageForCode(99999)).toBe('服务异常，请稍后再试');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npm test -w @paws/types -- api
```

预期：FAIL，报 `Cannot find module '../src/api'`。

- [ ] **Step 3: 实现最小代码**

`packages/types/src/api.ts`：

```ts
export interface ApiResponse<T> {
  code: number;
  message: string;
  data: T | null;
}

export const ERROR_CODES = {
  OK: 0,
  UNAUTHORIZED: 40100,
  FORBIDDEN: 40300,
  NOT_FOUND: 40400,
  VALIDATION_FAILED: 42200,
  AUDIT_REJECTED: 42201,
  LOCATION_REQUIRED: 42202,
  RATE_LIMITED: 42900,
  INTERNAL: 50000,
  UPSTREAM_WECHAT: 50201,
  UPSTREAM_MAP: 50202,
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

const FALLBACK_MESSAGE = '服务异常，请稍后再试';

export const ERROR_MESSAGES: Record<number, string> = {
  [ERROR_CODES.UNAUTHORIZED]: '登录已过期，请重试',
  [ERROR_CODES.FORBIDDEN]: '没有操作权限',
  [ERROR_CODES.NOT_FOUND]: '内容不存在或已删除',
  [ERROR_CODES.VALIDATION_FAILED]: '提交的信息有误，请检查后重试',
  [ERROR_CODES.AUDIT_REJECTED]: '内容未通过审核',
  [ERROR_CODES.LOCATION_REQUIRED]: '该功能需要位置信息',
  [ERROR_CODES.RATE_LIMITED]: '操作太频繁，请稍后再试',
  [ERROR_CODES.INTERNAL]: FALLBACK_MESSAGE,
  [ERROR_CODES.UPSTREAM_WECHAT]: '微信服务暂时不可用',
  [ERROR_CODES.UPSTREAM_MAP]: '地图服务暂时不可用',
};

export function messageForCode(code: number, fallbackFromServer?: string): string {
  return fallbackFromServer || ERROR_MESSAGES[code] || FALLBACK_MESSAGE;
}
```

`packages/types/src/index.ts` 追加一行：

```ts
export * from './api';
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npm test -w @paws/types
```

预期：PASS，18 个用例全绿。

- [ ] **Step 5: 提交**

```bash
git add packages/types
git commit -m "feat: add api envelope and error code table"
```

---

### Task 4: Design token 编译器

**Files:**
- Create: `miniprogram/package.json`、`miniprogram/tsconfig.json`、`miniprogram/jest.config.js`
- Create: `miniprogram/tools/build-tokens.ts`
- Test: `miniprogram/test/build-tokens.spec.ts`

**Interfaces:**
- Consumes: 无
- Produces: `pxToRpx(value: string): string`、`compileTokens(designMarkdown: string): string`、CLI 入口写出 `miniprogram/styles/tokens.wxss`

- [ ] **Step 1: 建立 miniprogram 工作区配置**

`miniprogram/package.json`：

```json
{
  "name": "miniprogram",
  "private": true,
  "scripts": {
    "test": "jest",
    "build:tokens": "ts-node tools/build-tokens.ts",
    "sync:types": "ts-node tools/sync-types.ts"
  },
  "dependencies": {
    "yaml": "2.4.2"
  },
  "devDependencies": {
    "ts-node": "10.9.2",
    "miniprogram-api-typings": "3.12.2",
    "miniprogram-ci": "1.9.11",
    "miniprogram-automator": "0.12.1"
  }
}
```

`miniprogram/tsconfig.json`：

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "types": ["miniprogram-api-typings", "jest", "node"],
    "noEmit": true
  },
  "include": [
    "app.ts",
    "config.ts",
    "api",
    "store",
    "utils",
    "pages",
    "packages",
    "components",
    "custom-tab-bar",
    "tools",
    "test",
    "shared"
  ]
}
```

`include` 覆盖后续任务会建的全部目录，避免每加一个目录就回头改配置。`miniprogram-api-typings`（上面 Step 1 已锁 `3.12.2`）提供 `wx` / `Page` / `Component` 的全局声明。

`miniprogram/jest.config.js`：

```js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/**/*.spec.ts'],
};
```

- [ ] **Step 2: 写失败测试**

`miniprogram/test/build-tokens.spec.ts`：

```ts
import { compileTokens, pxToRpx } from '../tools/build-tokens';

const SAMPLE = `---
name: Paws & Paths
colors:
  primary: '#944a07'
  surface-container-lowest: '#ffffff'
typography:
  headline-lg:
    fontFamily: Quicksand
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 32px
  headline-xl:
    fontFamily: Quicksand
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.02em
rounded:
  DEFAULT: 1rem
  lg: 2rem
spacing:
  md: 16px
  margin-mobile: 20px
---

## Brand & Style
正文内容不参与编译。
`;

describe('pxToRpx', () => {
  it('px 按 1:2 换算', () => {
    expect(pxToRpx('16px')).toBe('32rpx');
    expect(pxToRpx('20px')).toBe('40rpx');
  });

  it('rem 先按 16px 折算再翻倍', () => {
    expect(pxToRpx('1rem')).toBe('32rpx');
    expect(pxToRpx('2rem')).toBe('64rpx');
  });

  it('em 与无单位值原样保留', () => {
    expect(pxToRpx('-0.02em')).toBe('-0.02em');
    expect(pxToRpx('700')).toBe('700');
  });
});
```

同一文件追加：

```ts
describe('compileTokens', () => {
  const css = compileTokens(SAMPLE);

  it('产出 page 选择器包裹的变量块', () => {
    expect(css).toContain('page {');
  });

  it('色值原样输出为 --color-* 变量', () => {
    expect(css).toContain('--color-primary: #944a07;');
    expect(css).toContain('--color-surface-container-lowest: #ffffff;');
  });

  it('间距换算为 rpx', () => {
    expect(css).toContain('--space-md: 32rpx;');
    expect(css).toContain('--space-margin-mobile: 40rpx;');
  });

  it('圆角 rem 换算为 rpx，DEFAULT 归一化为 default', () => {
    expect(css).toContain('--radius-default: 32rpx;');
    expect(css).toContain('--radius-lg: 64rpx;');
  });

  it('字号、行高换算，字重与字距原样保留', () => {
    expect(css).toContain('--font-headline-lg-size: 48rpx;');
    expect(css).toContain('--font-headline-lg-line: 64rpx;');
    expect(css).toContain('--font-headline-lg-weight: 700;');
    expect(css).toContain('--font-headline-xl-spacing: -0.02em;');
  });

  it('没有 letterSpacing 的层级不产出 spacing 变量', () => {
    expect(css).not.toContain('--font-headline-lg-spacing');
  });

  it('带生成物警示注释，避免有人手改', () => {
    expect(css).toContain('自动生成');
  });

  it('正文内容不会泄漏进产物', () => {
    expect(css).not.toContain('Brand & Style');
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

```bash
npm test -w miniprogram
```

预期：FAIL，报 `Cannot find module '../tools/build-tokens'`。

- [ ] **Step 4: 实现最小代码**

`miniprogram/tools/build-tokens.ts`：

```ts
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parse } from 'yaml';

const DESIGN_MD = resolve(__dirname, '../../stitch_/paws_paths/DESIGN.md');
const OUTPUT = resolve(__dirname, '../styles/tokens.wxss');

interface TypographyEntry {
  fontFamily?: string;
  fontSize?: string;
  fontWeight?: string;
  lineHeight?: string;
  letterSpacing?: string;
}

export interface DesignFrontmatter {
  colors?: Record<string, string>;
  typography?: Record<string, TypographyEntry>;
  rounded?: Record<string, string>;
  spacing?: Record<string, string>;
}

/** 统一换算：1px = 2rpx，1rem = 16px = 32rpx；其他单位原样保留。 */
export function pxToRpx(value: string): string {
  const raw = String(value).trim();
  const px = /^(-?[\d.]+)px$/.exec(raw);
  if (px) return `${parseFloat(px[1]) * 2}rpx`;
  const rem = /^(-?[\d.]+)rem$/.exec(raw);
  if (rem) return `${parseFloat(rem[1]) * 16 * 2}rpx`;
  return raw;
}

/** Task 15 的图标管线也要读色板，所以这里导出。 */
export function extractFrontmatter(markdown: string): DesignFrontmatter {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown);
  if (!match) throw new Error('DESIGN.md 缺少 frontmatter，无法编译 token');
  return parse(match[1]) as DesignFrontmatter;
}
```

同一文件追加：

```ts
const HEADER = [
  '/**',
  ' * 本文件由 tools/build-tokens.ts 自动生成，请勿手改。',
  ' * 来源：stitch_/paws_paths/DESIGN.md 的 frontmatter。',
  ' * 改 token 请改 DESIGN.md 后跑 npm run build:tokens -w miniprogram。',
  ' */',
].join('\n');

export function compileTokens(designMarkdown: string): string {
  const fm = extractFrontmatter(designMarkdown);
  const lines: string[] = [];

  for (const [name, value] of Object.entries(fm.colors ?? {})) {
    lines.push(`  --color-${name}: ${value};`);
  }
  for (const [name, value] of Object.entries(fm.spacing ?? {})) {
    lines.push(`  --space-${name}: ${pxToRpx(value)};`);
  }
  for (const [name, value] of Object.entries(fm.rounded ?? {})) {
    const key = name === 'DEFAULT' ? 'default' : name;
    lines.push(`  --radius-${key}: ${pxToRpx(value)};`);
  }
  for (const [level, entry] of Object.entries(fm.typography ?? {})) {
    if (entry.fontFamily) lines.push(`  --font-${level}-family: ${entry.fontFamily};`);
    if (entry.fontSize) lines.push(`  --font-${level}-size: ${pxToRpx(entry.fontSize)};`);
    if (entry.lineHeight) lines.push(`  --font-${level}-line: ${pxToRpx(entry.lineHeight)};`);
    if (entry.fontWeight) lines.push(`  --font-${level}-weight: ${entry.fontWeight};`);
    if (entry.letterSpacing) lines.push(`  --font-${level}-spacing: ${entry.letterSpacing};`);
  }

  return `${HEADER}\n\npage {\n${lines.join('\n')}\n}\n`;
}

/** CLI 入口：读 DESIGN.md，写 styles/tokens.wxss。 */
if (require.main === module) {
  const css = compileTokens(readFileSync(DESIGN_MD, 'utf8'));
  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, css, 'utf8');
  console.log(`tokens.wxss 已生成：${OUTPUT}`);
}
```

- [ ] **Step 5: 运行测试确认通过**

```bash
npm test -w miniprogram
```

预期：PASS，11 个用例全绿。

- [ ] **Step 6: 生成真实产物并抽查换算结果**

```bash
npm run build:tokens -w miniprogram
grep -E "margin-mobile|radius-default|headline-xl-size" miniprogram/styles/tokens.wxss
```

预期输出包含这三行（`spec §5.2` 的单位约定即由此落地）：

```
  --space-margin-mobile: 40rpx;
  --radius-default: 32rpx;
  --font-headline-xl-size: 64rpx;
```

- [ ] **Step 7: 提交**

```bash
git add miniprogram/package.json miniprogram/tsconfig.json miniprogram/jest.config.js \
  miniprogram/tools/build-tokens.ts miniprogram/test/build-tokens.spec.ts \
  miniprogram/styles/tokens.wxss
git commit -m "feat: compile design tokens from DESIGN.md to wxss variables"
```

---

### Task 5: 阴影 token 由 on-surface 色派生

`DESIGN.md` 的散文段要求阴影「用巧克力棕着色、透明度 5-8%」，但 frontmatter 里没有 shadow 键。若在 wxss 里手写 `rgba(34, 26, 21, 0.06)`，等于绕开 token 层。做法是让编译器从 `colors.on-surface` 派生阴影 token。

**Files:**
- Modify: `miniprogram/tools/build-tokens.ts`
- Modify: `miniprogram/test/build-tokens.spec.ts`

**Interfaces:**
- Consumes: `compileTokens`、`pxToRpx`（Task 4）
- Produces: `hexToRgb(hex: string): string`；tokens 新增 `--shadow-ambient`、`--shadow-pressed`

- [ ] **Step 1: 写失败测试**

`miniprogram/test/build-tokens.spec.ts` 顶部 import 追加 `hexToRgb`，文件末尾追加：

```ts
const SAMPLE_DARK_TEXT = SAMPLE.replace(
  "  primary: '#944a07'",
  "  primary: '#944a07'\n  on-surface: '#221a15'",
);

describe('hexToRgb', () => {
  it('六位十六进制转 rgb 三元组', () => {
    expect(hexToRgb('#221a15')).toBe('34, 26, 21');
    expect(hexToRgb('#ffffff')).toBe('255, 255, 255');
  });

  it('三位缩写先展开再转', () => {
    expect(hexToRgb('#fff')).toBe('255, 255, 255');
  });

  it('非法色值直接报错，不静默产出坏 token', () => {
    expect(() => hexToRgb('rgb(1,2,3)')).toThrow(/无法解析色值/);
  });
});

describe('阴影 token', () => {
  it('由 on-surface 派生，透明度落在 5%-8% 区间', () => {
    const css = compileTokens(SAMPLE_DARK_TEXT);
    expect(css).toContain('--shadow-ambient: 0 8rpx 40rpx rgba(34, 26, 21, 0.06);');
    expect(css).toContain('--shadow-pressed: 0 4rpx 16rpx rgba(34, 26, 21, 0.04);');
  });

  it('缺 on-surface 时不产出阴影 token，也不抛错', () => {
    expect(compileTokens(SAMPLE)).not.toContain('--shadow-ambient');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npm test -w miniprogram
```

预期：FAIL，报 `hexToRgb is not a function`。

- [ ] **Step 3: 实现最小代码**

`miniprogram/tools/build-tokens.ts` 在 `pxToRpx` 之后插入：

```ts
/** 十六进制转 `r, g, b` 字符串，供 rgba() 拼装阴影用。 */
export function hexToRgb(hex: string): string {
  const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(String(hex).trim());
  if (!m) throw new Error(`无法解析色值：${hex}`);
  const full = m[1].length === 3 ? m[1].replace(/(.)/g, '$1$1') : m[1];
  const n = parseInt(full, 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}
```

`compileTokens` 内 typography 循环之后、`return` 之前插入：

```ts
  // DESIGN.md「Elevation & Depth」：长、扩散、用正文棕着色，透明度 5-8%。
  const onSurface = fm.colors?.['on-surface'];
  if (onSurface) {
    const rgb = hexToRgb(onSurface);
    lines.push(`  --shadow-ambient: 0 8rpx 40rpx rgba(${rgb}, 0.06);`);
    lines.push(`  --shadow-pressed: 0 4rpx 16rpx rgba(${rgb}, 0.04);`);
  }
```

- [ ] **Step 4: 运行测试并重新生成产物**

```bash
npm test -w miniprogram
npm run build:tokens -w miniprogram
grep shadow miniprogram/styles/tokens.wxss
```

预期：PASS，16 个用例全绿；`tokens.wxss` 里出现两行 `--shadow-*`。

- [ ] **Step 5: 提交**

```bash
git add miniprogram/tools/build-tokens.ts miniprogram/test/build-tokens.spec.ts \
  miniprogram/styles/tokens.wxss
git commit -m "feat: derive shadow tokens from on-surface color"
```

---

### Task 6: 语义样式层与 token 漂移守卫

**Files:**
- Create: `miniprogram/tools/style-guard.ts`
- Create: `miniprogram/styles/semantic.wxss`
- Create: `miniprogram/app.wxss`
- Test: `miniprogram/test/style-guard.spec.ts`

**Interfaces:**
- Consumes: `miniprogram/styles/tokens.wxss`（Task 4、Task 5 生成）
- Produces: `findHexLiterals(css): string[]`、`findBarePx(css): string[]`、`findUndefinedVars(consumerCss, tokensCss): string[]`；语义类 `.card` / `.chip` / `.btn-primary` / `.btn-secondary` / `.btn-ghost` / `.field` / `.avatar` / `.text-*`

- [ ] **Step 1: 写失败测试**

`miniprogram/test/style-guard.spec.ts`：

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { findBarePx, findHexLiterals, findUndefinedVars } from '../tools/style-guard';

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

describe('守卫函数本身', () => {
  it('挑出十六进制色值，注释里的不算', () => {
    expect(findHexLiterals('.a { color: #944a07; }')).toEqual(['#944a07']);
    expect(findHexLiterals('/* #944a07 */ .a { color: var(--color-primary); }')).toEqual([]);
  });

  it('挑出裸 px，rpx 与 var 不误报', () => {
    expect(findBarePx('.a { padding: 16px; }')).toEqual(['16px']);
    expect(findBarePx('.a { padding: 32rpx; margin: var(--space-md); }')).toEqual([]);
  });

  it('报出 tokens 里没定义的变量', () => {
    const tokens = 'page { --color-primary: #944a07; }';
    expect(findUndefinedVars('.a { color: var(--color-ghost); }', tokens)).toEqual([
      '--color-ghost',
    ]);
    expect(findUndefinedVars('.a { color: var(--color-primary); }', tokens)).toEqual([]);
  });
});
```

同一文件追加：

```ts
describe('样式表不得绕开 token 层', () => {
  const tokens = read('styles/tokens.wxss');
  const semantic = read('styles/semantic.wxss');
  const app = read('app.wxss');

  it('semantic.wxss 没有十六进制色值', () => {
    expect(findHexLiterals(semantic)).toEqual([]);
  });

  it('semantic.wxss 没有裸 px', () => {
    expect(findBarePx(semantic)).toEqual([]);
  });

  it('semantic.wxss 引用的每个变量都在 tokens.wxss 有定义', () => {
    expect(findUndefinedVars(semantic, tokens)).toEqual([]);
  });

  it('app.wxss 同样不得引用未定义变量', () => {
    expect(findUndefinedVars(app, tokens)).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npm test -w miniprogram
```

预期：FAIL，报 `Cannot find module '../tools/style-guard'`。

- [ ] **Step 3: 实现守卫函数**

`miniprogram/tools/style-guard.ts`：

```ts
/** 去掉 CSS 注释，避免注释里的示例值触发误报。 */
export function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** 十六进制色值一律视为违规：色值只能来自 tokens.wxss。 */
export function findHexLiterals(css: string): string[] {
  return stripComments(css).match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
}

/** 裸 px 一律视为违规：长度只能用 rpx 或 var()。 */
export function findBarePx(css: string): string[] {
  return stripComments(css).match(/(?<![\w-])-?[\d.]+px\b/g) ?? [];
}

/** 引用了 tokens.wxss 未定义的变量，说明 token 名漂移了。 */
export function findUndefinedVars(consumerCss: string, tokensCss: string): string[] {
  const defined = new Set(
    Array.from(stripComments(tokensCss).matchAll(/(--[\w-]+)\s*:/g), (m) => m[1]),
  );
  const used = Array.from(
    stripComments(consumerCss).matchAll(/var\(\s*(--[\w-]+)/g),
    (m) => m[1],
  );
  return [...new Set(used.filter((name) => !defined.has(name)))];
}
```

- [ ] **Step 4: 写语义样式层（文字与布局）**

`miniprogram/styles/semantic.wxss`：

```css
/* 语义层：只允许 var() 与 rpx，禁止十六进制与裸 px。 */
/* 只有 headline-xl 与 label-md 在 DESIGN.md 里定义了 letterSpacing， */
/* 其余层级不得引用 --font-*-spacing，否则 token 漂移测试会红。 */

.text-headline-xl {
  font-size: var(--font-headline-xl-size);
  line-height: var(--font-headline-xl-line);
  font-weight: var(--font-headline-xl-weight);
  letter-spacing: var(--font-headline-xl-spacing);
}
.text-headline-lg {
  font-size: var(--font-headline-lg-size);
  line-height: var(--font-headline-lg-line);
  font-weight: var(--font-headline-lg-weight);
}
.text-headline-md {
  font-size: var(--font-headline-md-size);
  line-height: var(--font-headline-md-line);
  font-weight: var(--font-headline-md-weight);
}
.text-body-lg {
  font-size: var(--font-body-lg-size);
  line-height: var(--font-body-lg-line);
  font-weight: var(--font-body-lg-weight);
}
.text-body-md {
  font-size: var(--font-body-md-size);
  line-height: var(--font-body-md-line);
  font-weight: var(--font-body-md-weight);
}
.text-body-sm {
  font-size: var(--font-body-sm-size);
  line-height: var(--font-body-sm-line);
  font-weight: var(--font-body-sm-weight);
}
.text-label-md {
  font-size: var(--font-label-md-size);
  line-height: var(--font-label-md-line);
  font-weight: var(--font-label-md-weight);
  letter-spacing: var(--font-label-md-spacing);
}
```

同一文件追加颜色与布局工具类：

```css
.c-primary { color: var(--color-primary); }
.c-on-surface { color: var(--color-on-surface); }
.c-on-surface-variant { color: var(--color-on-surface-variant); }
.c-error { color: var(--color-error); }

.page-gutter {
  padding-left: var(--space-margin-mobile);
  padding-right: var(--space-margin-mobile);
}
.feed-gap { gap: var(--space-gutter-mobile); }
.section-gap { margin-top: var(--space-xl); }
.safe-bottom { padding-bottom: calc(var(--space-md) + env(safe-area-inset-bottom)); }
```

- [ ] **Step 5: 写语义样式层（组件类）**

`miniprogram/styles/semantic.wxss` 继续追加：

```css
/* 卡片：白底浮在米色页面上，长扩散软阴影，按压下沉。 */
.card {
  background-color: var(--color-surface-container-lowest);
  border-radius: var(--radius-lg);
  padding: var(--space-md);
  box-shadow: var(--shadow-ambient);
  transition: transform 0.15s ease-out, box-shadow 0.15s ease-out;
}
.card--pressed {
  transform: scale(0.97);
  box-shadow: var(--shadow-pressed);
}

.avatar { border-radius: var(--radius-full); }

/* 标签：全圆角胶囊 + label-md 字号。 */
.chip {
  display: inline-flex;
  align-items: center;
  padding: var(--space-xs) var(--space-md);
  border-radius: var(--radius-full);
  background-color: var(--color-surface-container);
  color: var(--color-on-surface-variant);
  font-size: var(--font-label-md-size);
  line-height: var(--font-label-md-line);
  font-weight: var(--font-label-md-weight);
  letter-spacing: var(--font-label-md-spacing);
}
.chip--active {
  background-color: var(--color-primary);
  color: var(--color-on-primary);
}
```

同一文件追加按钮与输入框（`2px` 边框写成 `4rpx`，`1px` 写成 `2rpx`）：

```css
.btn {
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-full);
  padding: var(--space-sm) var(--space-lg);
  font-size: var(--font-body-lg-size);
  line-height: var(--font-body-lg-line);
  font-weight: var(--font-body-lg-weight);
  transition: transform 0.15s ease-out, box-shadow 0.15s ease-out;
}
.btn-primary {
  background-color: var(--color-primary);
  color: var(--color-on-primary);
  box-shadow: var(--shadow-ambient);
}
.btn-secondary {
  background-color: var(--color-secondary);
  color: var(--color-on-secondary);
}
.btn-ghost {
  background-color: transparent;
  color: var(--color-on-surface);
  border: 4rpx solid var(--color-on-surface);
}
.btn--pressed {
  transform: scale(0.97);
  box-shadow: var(--shadow-pressed);
}
.btn--disabled { opacity: 0.4; }

.field {
  background-color: var(--color-surface-container-low);
  border: 2rpx solid var(--color-outline);
  border-radius: var(--radius-full);
  padding: var(--space-md);
  color: var(--color-on-surface);
  font-size: var(--font-body-md-size);
  line-height: var(--font-body-md-line);
}
.field--focus {
  border: 4rpx solid var(--color-primary);
}
.field--error {
  border: 4rpx solid var(--color-error);
}
```

- [ ] **Step 6: 写 app.wxss（只做引入与页面底色）**

`miniprogram/app.wxss`：

```css
/* tokens.wxss 是生成物，semantic.wxss 是手写语义层，顺序不可颠倒。 */
@import './styles/tokens.wxss';
@import './styles/semantic.wxss';

page {
  background-color: var(--color-background);
  color: var(--color-on-surface);
  font-size: var(--font-body-md-size);
  line-height: var(--font-body-md-line);
}
```

- [ ] **Step 7: 运行测试确认通过**

```bash
npm test -w miniprogram
```

预期：PASS，23 个用例全绿。若 `findUndefinedVars` 报出变量名，说明语义层引用了 `DESIGN.md` 里不存在的 token，改语义层而不是改守卫。

- [ ] **Step 8: 提交**

```bash
git add miniprogram/tools/style-guard.ts miniprogram/test/style-guard.spec.ts \
  miniprogram/styles/semantic.wxss miniprogram/app.wxss
git commit -m "feat: add semantic style layer with token drift guard"
```

---

### Task 7: 共享类型同步脚本

小程序无法直接 `require` 工作区包（构建工具不做 node_modules 解析），所以把 `packages/types/dist` 的编译产物同步进 `miniprogram/shared/types` 并入库。同步产物是否过期由 CI 用 `git diff --exit-code` 校验（Task 15）。

**Files:**
- Create: `miniprogram/tools/sync-types.ts`
- Modify: `package.json`（根，加一个聚合脚本）
- Test: `miniprogram/test/sync-types.spec.ts`

**Interfaces:**
- Consumes: `packages/types/dist`（Task 1–3 编译产物）
- Produces: `syncTypes(srcDir: string, destDir: string): string[]`，返回按名排序的写入文件名；CLI 入口写 `miniprogram/shared/types`

- [ ] **Step 1: 写失败测试**

`miniprogram/test/sync-types.spec.ts`：

```ts
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syncTypes } from '../tools/sync-types';

function makeDist(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'paws-dist-'));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content, 'utf8');
  }
  return dir;
}

describe('syncTypes', () => {
  let src: string;
  let dest: string;

  beforeEach(() => {
    src = makeDist({
      'index.js': 'exports.a = 1;',
      'index.d.ts': 'export declare const a: number;',
      'index.js.map': '{}',
    });
    dest = mkdtempSync(join(tmpdir(), 'paws-dest-'));
  });

  afterEach(() => {
    rmSync(src, { recursive: true, force: true });
    rmSync(dest, { recursive: true, force: true });
  });
```

同一 `describe` 块内接着写用例，然后收尾：

```ts
  it('只同步 .js 与 .d.ts，跳过 sourcemap', () => {
    expect(syncTypes(src, dest)).toEqual(['index.d.ts', 'index.js']);
    expect(readdirSync(dest)).not.toContain('index.js.map');
  });

  it('每个产物顶部加上禁止手改的注释', () => {
    syncTypes(src, dest);
    expect(readFileSync(join(dest, 'index.js'), 'utf8')).toContain('禁止手改');
  });

  it('dist 里删掉的文件同步后不残留', () => {
    syncTypes(src, dest);
    writeFileSync(join(dest, 'ghost.d.ts'), 'export {};', 'utf8');
    syncTypes(src, dest);
    expect(readdirSync(dest)).not.toContain('ghost.d.ts');
  });

  it('重复执行产物完全一致', () => {
    syncTypes(src, dest);
    const first = readFileSync(join(dest, 'index.js'), 'utf8');
    syncTypes(src, dest);
    expect(readFileSync(join(dest, 'index.js'), 'utf8')).toBe(first);
  });

  it('dist 不存在时报错并给出补救命令', () => {
    expect(() => syncTypes(join(src, 'nope'), dest)).toThrow(/npm run build -w @paws\/types/);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npm test -w miniprogram
```

预期：FAIL，报 `Cannot find module '../tools/sync-types'`。

- [ ] **Step 3: 实现最小代码**

`miniprogram/tools/sync-types.ts`：

```ts
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

const SRC = resolve(__dirname, '../../packages/types/dist');
const DEST = resolve(__dirname, '../shared/types');
const SYNCED_EXT = ['.js', '.d.ts'];

const BANNER =
  '// 由 packages/types 同步而来，禁止手改。\n' +
  '// 改动请改 packages/types，然后跑 npm run sync:types。\n';

export function syncTypes(srcDir: string, destDir: string): string[] {
  if (!existsSync(srcDir)) {
    throw new Error(`未找到 ${srcDir}，先跑 npm run build -w @paws/types`);
  }
  rmSync(destDir, { recursive: true, force: true });
  mkdirSync(destDir, { recursive: true });
  const names = readdirSync(srcDir)
    .filter((f) => SYNCED_EXT.some((ext) => f.endsWith(ext)))
    .sort();
  for (const name of names) {
    writeFileSync(join(destDir, name), BANNER + readFileSync(join(srcDir, name), 'utf8'), 'utf8');
  }
  return names;
}

if (require.main === module) {
  const written = syncTypes(SRC, DEST);
  console.log(`已同步 ${written.length} 个文件：${written.join(', ')}`);
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npm test -w miniprogram
```

预期：PASS，28 个用例全绿。

- [ ] **Step 5: 加根聚合脚本并真实同步一次**

根 `package.json` 的 `scripts` 追加一行：

```json
    "sync:types": "npm run build -w @paws/types && npm run sync:types -w miniprogram"
```

然后执行：

```bash
npm run sync:types
ls miniprogram/shared/types
```

预期：目录里出现 `age.d.ts`、`age.js`、`api.d.ts`、`api.js`、`audit.d.ts`、`audit.js`、`index.d.ts`、`index.js`。

- [ ] **Step 6: 提交**

```bash
git add package.json miniprogram/tools/sync-types.ts miniprogram/test/sync-types.spec.ts \
  miniprogram/shared/types
git commit -m "feat: sync shared types into miniprogram"
```

---

### Task 8: NestJS 骨架、响应信封与健康检查

**Files:**
- Create: `server/package.json`、`server/tsconfig.json`、`server/jest.config.js`、`server/.env.example`
- Create: `server/src/main.ts`、`server/src/app.module.ts`
- Create: `server/src/common/response.interceptor.ts`、`server/src/common/all-exceptions.filter.ts`、`server/src/common/api.exception.ts`
- Create: `server/src/health/health.controller.ts`
- Test: `server/test/envelope.spec.ts`

**Interfaces:**
- Consumes: `ERROR_CODES`、`messageForCode`（Task 3）
- Produces: `ResponseInterceptor`、`AllExceptionsFilter`、`ApiException(code: number, message?: string, httpStatus?: number)`；`GET /health` 返回 `{ code: 0, message: 'ok', data: { status: 'up' } }`

- [ ] **Step 1: 建立 server 工作区配置**

`server/package.json`：

```json
{
  "name": "server",
  "private": true,
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "node dist/main.js",
    "start:dev": "ts-node-dev --respawn src/main.ts",
    "test": "jest"
  },
  "dependencies": {
    "@nestjs/common": "10.3.8",
    "@nestjs/core": "10.3.8",
    "@nestjs/platform-express": "10.3.8",
    "@paws/types": "0.1.0",
    "ioredis": "5.4.1",
    "jsonwebtoken": "9.0.2",
    "reflect-metadata": "0.2.2",
    "rxjs": "7.8.1"
  },
  "devDependencies": {
    "@nestjs/testing": "10.3.8",
    "@types/jsonwebtoken": "9.0.6",
    "@types/supertest": "6.0.2",
    "supertest": "7.0.0",
    "ts-node-dev": "2.0.0"
  }
}
```

`server/tsconfig.json`：

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  },
  "include": ["src"]
}
```

`server/jest.config.js`（把 `@paws/types` 直接映到源码，测试前不必先编译）：

```js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/**/*.spec.ts'],
  moduleNameMapper: {
    '^@paws/types$': '<rootDir>/../packages/types/src/index.ts',
  },
};
```

`server/.env.example`（真实 `.env` 已在 `.gitignore`，密钥不入库）：

```
PORT=3000
WX_APPID=
WX_SECRET=
JWT_SECRET=
JWT_TTL_SECONDS=604800
REDIS_URL=redis://127.0.0.1:6379
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/paws
```

- [ ] **Step 2: 写失败测试**

`server/test/envelope.spec.ts`：

```ts
import { Controller, Get, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ERROR_CODES } from '@paws/types';
import { AppModule } from '../src/app.module';
import { ApiException } from '../src/common/api.exception';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter';
import { ResponseInterceptor } from '../src/common/response.interceptor';

/** 只在测试里挂的抛错路由，生产代码不留调试端点。 */
@Controller('__test')
class ThrowController {
  @Get('api-error')
  apiError(): never {
    throw new ApiException(ERROR_CODES.VALIDATION_FAILED, '犬证编号格式不正确', 422);
  }

  @Get('crash')
  crash(): never {
    throw new Error('数据库连了个空气');
  }
}
```

同一文件追加：

```ts
describe('响应信封', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ThrowController],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('成功响应包成 code 0 信封', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body).toEqual({ code: 0, message: 'ok', data: { status: 'up' } });
  });

  it('未命中路由映射为 40400 + 中文文案，HTTP 状态仍是 404', async () => {
    const res = await request(app.getHttpServer()).get('/nope').expect(404);
    expect(res.body.code).toBe(ERROR_CODES.NOT_FOUND);
    expect(res.body.message).toBe('内容不存在或已删除');
    expect(res.body.data).toBeNull();
  });

  it('ApiException 保留业务码与服务端自定义文案', async () => {
    const res = await request(app.getHttpServer()).get('/__test/api-error').expect(422);
    expect(res.body).toEqual({
      code: ERROR_CODES.VALIDATION_FAILED,
      message: '犬证编号格式不正确',
      data: null,
    });
  });

  it('未预期异常收敛为 50000，响应体不泄漏内部细节', async () => {
    const res = await request(app.getHttpServer()).get('/__test/crash').expect(500);
    expect(res.body.code).toBe(ERROR_CODES.INTERNAL);
    expect(res.body.message).toBe('服务异常，请稍后再试');
    expect(JSON.stringify(res.body)).not.toContain('数据库连了个空气');
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

```bash
npm install
npm test -w server
```

预期：FAIL，报 `Cannot find module '../src/app.module'`。

- [ ] **Step 4: 实现信封与业务异常**

`server/src/common/api.exception.ts`：

```ts
import { HttpException, HttpStatus } from '@nestjs/common';
import { messageForCode } from '@paws/types';

/** 业务码与 HTTP 状态分离：前端只认业务码，HTTP 状态给网关和监控看。 */
export class ApiException extends HttpException {
  constructor(
    readonly code: number,
    message?: string,
    httpStatus: number = HttpStatus.BAD_REQUEST,
  ) {
    super(messageForCode(code, message), httpStatus);
  }
}
```

`server/src/common/response.interceptor.ts`：

```ts
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { map, Observable } from 'rxjs';
import { ApiResponse, ERROR_CODES } from '@paws/types';

@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<ApiResponse<unknown>> {
    return next
      .handle()
      .pipe(map((data) => ({ code: ERROR_CODES.OK, message: 'ok', data: data ?? null })));
  }
}
```

- [ ] **Step 5: 实现异常过滤器**

`server/src/common/all-exceptions.filter.ts`：

```ts
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { ERROR_CODES, messageForCode } from '@paws/types';
import { ApiException } from './api.exception';

const HTTP_TO_CODE: Record<number, number> = {
  [HttpStatus.UNAUTHORIZED]: ERROR_CODES.UNAUTHORIZED,
  [HttpStatus.FORBIDDEN]: ERROR_CODES.FORBIDDEN,
  [HttpStatus.NOT_FOUND]: ERROR_CODES.NOT_FOUND,
  [HttpStatus.UNPROCESSABLE_ENTITY]: ERROR_CODES.VALIDATION_FAILED,
  [HttpStatus.TOO_MANY_REQUESTS]: ERROR_CODES.RATE_LIMITED,
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof ApiException) {
      res.status(exception.getStatus()).json({
        code: exception.code,
        message: exception.message,
        data: null,
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code = HTTP_TO_CODE[status] ?? ERROR_CODES.INTERNAL;
      res.status(status).json({ code, message: messageForCode(code), data: null });
      return;
    }

    // 未预期异常：日志留全量，响应只给兜底文案。
    this.logger.error(exception);
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      code: ERROR_CODES.INTERNAL,
      message: messageForCode(ERROR_CODES.INTERNAL),
      data: null,
    });
  }
}
```

- [ ] **Step 6: 实现健康检查与启动入口**

`server/src/health/health.controller.ts`：

```ts
import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  /** 云托管探活端点，不查数据库，只证明进程能响应。 */
  @Get()
  check(): { status: string } {
    return { status: 'up' };
  }
}
```

`server/src/app.module.ts`：

```ts
import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller';

@Module({ controllers: [HealthController] })
export class AppModule {}
```

`server/src/main.ts`：

```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { ResponseInterceptor } from './common/response.interceptor';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());
  // 微信云托管从 PORT 注入端口，本地缺省 3000。
  await app.listen(Number(process.env.PORT ?? 3000), '0.0.0.0');
}

void bootstrap();
```

- [ ] **Step 7: 运行测试确认通过**

```bash
npm test -w server
```

预期：PASS，4 个用例全绿。

- [ ] **Step 8: 提交**

```bash
git add server
git commit -m "feat: bootstrap nest server with response envelope"
```

---

### Task 9: access_token 单点缓存与分布式锁

spec §3.2 点名的坑：多实例各自刷 `access_token` 会互相顶掉。这里把 Redis 抽成窄接口 `TokenStore`，业务只调 `AccessTokenService.get()`。

**Files:**
- Create: `server/src/wechat/token-store.ts`
- Create: `server/src/wechat/access-token.service.ts`
- Test: `server/test/access-token.spec.ts`

**Interfaces:**
- Consumes: `ApiException`、`ERROR_CODES`（Task 3、Task 8）
- Produces:
  - `TokenStore`：`get(key): Promise<string | null>`、`setWithTtl(key, value, ttlSeconds): Promise<void>`、`acquireLock(key, ttlSeconds): Promise<boolean>`、`releaseLock(key): Promise<void>`
  - `RedisTokenStore implements TokenStore`
  - `AccessTokenFetcher`：`fetchAccessToken(): Promise<{ access_token: string; expires_in: number }>`
  - `AccessTokenService.get(): Promise<string>`
  - `TOKEN_STORE`（DI token 字符串常量 `'TokenStore'`）

- [ ] **Step 1: 写失败测试（假实现部分）**

`server/test/access-token.spec.ts`：

```ts
import { ERROR_CODES } from '@paws/types';
import { AccessTokenService } from '../src/wechat/access-token.service';
import type { TokenStore } from '../src/wechat/token-store';

const TOKEN_KEY = 'wx:access_token';
const LOCK_KEY = 'wx:access_token:lock';

class FakeTokenStore implements TokenStore {
  private values = new Map<string, string>();
  private locks = new Set<string>();
  readonly ttls: Record<string, number> = {};

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async setWithTtl(key: string, value: string, ttlSeconds: number): Promise<void> {
    this.values.set(key, value);
    this.ttls[key] = ttlSeconds;
  }

  async acquireLock(key: string): Promise<boolean> {
    if (this.locks.has(key)) return false;
    this.locks.add(key);
    return true;
  }

  async releaseLock(key: string): Promise<void> {
    this.locks.delete(key);
  }
}

class FakeWechatApi {
  calls = 0;

  async fetchAccessToken(): Promise<{ access_token: string; expires_in: number }> {
    this.calls += 1;
    await new Promise((r) => setTimeout(r, 5));
    return { access_token: `token-${this.calls}`, expires_in: 7200 };
  }
}
```

- [ ] **Step 2: 写失败测试（用例部分）**

同一文件追加：

```ts
describe('AccessTokenService', () => {
  let store: FakeTokenStore;
  let api: FakeWechatApi;
  let svc: AccessTokenService;

  beforeEach(() => {
    store = new FakeTokenStore();
    api = new FakeWechatApi();
    svc = new AccessTokenService(store, api, { retryDelayMs: 5, maxRetries: 20 });
  });

  it('缓存命中时不碰微信接口', async () => {
    await store.setWithTtl(TOKEN_KEY, 'cached', 100);
    expect(await svc.get()).toBe('cached');
    expect(api.calls).toBe(0);
  });

  it('缓存未命中时按 expires_in - 300 写入，留出续期安全边界', async () => {
    expect(await svc.get()).toBe('token-1');
    expect(store.ttls[TOKEN_KEY]).toBe(6900);
  });

  it('五个实例并发只触发一次微信调用，且拿到同一个 token', async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => svc.get()));
    expect(api.calls).toBe(1);
    expect(new Set(results).size).toBe(1);
  });

  it('拿到锁后二次检查缓存，避免等锁期间别人已填好又拉一次', async () => {
    const sneaky = new FakeTokenStore();
    const origin = sneaky.acquireLock.bind(sneaky);
    sneaky.acquireLock = async (key: string, ttl: number) => {
      const ok = await origin(key, ttl);
      if (ok) await sneaky.setWithTtl(TOKEN_KEY, 'filled-by-peer', 100);
      return ok;
    };
    const peerAware = new AccessTokenService(sneaky, api, { retryDelayMs: 1, maxRetries: 3 });
    expect(await peerAware.get()).toBe('filled-by-peer');
    expect(api.calls).toBe(0);
  });

  it('锁被长期占用且缓存始终为空时抛上游错误，不无限等待', async () => {
    await store.acquireLock(LOCK_KEY, 10);
    const impatient = new AccessTokenService(store, api, { retryDelayMs: 1, maxRetries: 3 });
    await expect(impatient.get()).rejects.toMatchObject({
      code: ERROR_CODES.UPSTREAM_WECHAT,
    });
    expect(api.calls).toBe(0);
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

```bash
npm test -w server -- access-token
```

预期：FAIL，报 `Cannot find module '../src/wechat/access-token.service'`。

- [ ] **Step 4: 实现 TokenStore**

`server/src/wechat/token-store.ts`：

```ts
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

/** DI token：业务只依赖接口，测试注入内存实现。 */
export const TOKEN_STORE = 'TokenStore';

export interface TokenStore {
  get(key: string): Promise<string | null>;
  setWithTtl(key: string, value: string, ttlSeconds: number): Promise<void>;
  acquireLock(key: string, ttlSeconds: number): Promise<boolean>;
  releaseLock(key: string): Promise<void>;
}

@Injectable()
export class RedisTokenStore implements TokenStore, OnModuleDestroy {
  private client?: Redis;

  /** lazyConnect：不碰 Redis 的测试不会拉起连接，进程能正常退出。 */
  private get redis(): Redis {
    if (!this.client) {
      this.client = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', {
        lazyConnect: true,
      });
    }
    return this.client;
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.quit();
  }

  async get(key: string): Promise<string | null> {
    return this.redis.get(key);
  }

  async setWithTtl(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.redis.set(key, value, 'EX', Math.max(ttlSeconds, 1));
  }

  /** SET NX EX 是原子的，锁自带 TTL，实例崩了锁也会自己过期。 */
  async acquireLock(key: string, ttlSeconds: number): Promise<boolean> {
    const res = await this.redis.set(key, '1', 'EX', ttlSeconds, 'NX');
    return res === 'OK';
  }

  async releaseLock(key: string): Promise<void> {
    await this.redis.del(key);
  }
}
```

- [ ] **Step 5: 实现 AccessTokenService**

`server/src/wechat/access-token.service.ts`：

```ts
import { HttpStatus, Inject, Injectable, Optional } from '@nestjs/common';
import { ERROR_CODES } from '@paws/types';
import { ApiException } from '../common/api.exception';
import { TOKEN_STORE, type TokenStore } from './token-store';

const TOKEN_KEY = 'wx:access_token';
const LOCK_KEY = 'wx:access_token:lock';

export interface AccessTokenFetcher {
  fetchAccessToken(): Promise<{ access_token: string; expires_in: number }>;
}

export const WECHAT_TOKEN_FETCHER = 'AccessTokenFetcher';
export const ACCESS_TOKEN_OPTIONS = 'AccessTokenOptions';

export interface AccessTokenOptions {
  /** 提前过期的安全边界，避免临界点用到已失效的 token。 */
  safetyMarginSeconds: number;
  lockTtlSeconds: number;
  retryDelayMs: number;
  maxRetries: number;
}

const DEFAULTS: AccessTokenOptions = {
  safetyMarginSeconds: 300,
  lockTtlSeconds: 10,
  retryDelayMs: 200,
  maxRetries: 10,
};
```

同一文件追加：

```ts
@Injectable()
export class AccessTokenService {
  private readonly opts: AccessTokenOptions;

  constructor(
    @Inject(TOKEN_STORE) private readonly store: TokenStore,
    @Inject(WECHAT_TOKEN_FETCHER) private readonly api: AccessTokenFetcher,
    @Optional() @Inject(ACCESS_TOKEN_OPTIONS) opts: Partial<AccessTokenOptions> = {},
  ) {
    this.opts = { ...DEFAULTS, ...opts };
  }

  /** 全局唯一的取 token 入口。业务代码禁止自己调微信 token 接口。 */
  async get(): Promise<string> {
    const cached = await this.store.get(TOKEN_KEY);
    if (cached) return cached;

    for (let attempt = 0; attempt < this.opts.maxRetries; attempt += 1) {
      if (await this.store.acquireLock(LOCK_KEY, this.opts.lockTtlSeconds)) {
        try {
          // 二次检查：等锁期间可能已被别的实例填好。
          const filled = await this.store.get(TOKEN_KEY);
          if (filled) return filled;

          const fresh = await this.api.fetchAccessToken();
          await this.store.setWithTtl(
            TOKEN_KEY,
            fresh.access_token,
            fresh.expires_in - this.opts.safetyMarginSeconds,
          );
          return fresh.access_token;
        } finally {
          await this.store.releaseLock(LOCK_KEY);
        }
      }

      await new Promise((r) => setTimeout(r, this.opts.retryDelayMs));
      const byPeer = await this.store.get(TOKEN_KEY);
      if (byPeer) return byPeer;
    }

    throw new ApiException(ERROR_CODES.UPSTREAM_WECHAT, undefined, HttpStatus.BAD_GATEWAY);
  }
}
```

- [ ] **Step 6: 运行测试确认通过**

```bash
npm test -w server
```

预期：PASS，9 个用例全绿（信封 4 + access_token 5）。

- [ ] **Step 7: 提交**

```bash
git add server/src/wechat server/test/access-token.spec.ts
git commit -m "feat: cache wechat access_token in redis with distributed lock"
```

---

### Task 10: 微信登录接口

**Files:**
- Create: `server/src/wechat/wechat-api.service.ts`、`server/src/wechat/wechat.module.ts`
- Create: `server/src/users/user.repository.ts`、`server/src/users/users.service.ts`、`server/src/users/users.module.ts`
- Create: `server/src/auth/auth.service.ts`、`server/src/auth/auth.controller.ts`、`server/src/auth/auth.module.ts`
- Modify: `server/src/app.module.ts`
- Test: `server/test/auth-login.spec.ts`

**刻意的阶段性取舍：** 阶段 0 不引入 PostgreSQL。`UserRepository` 先给内存实现，阶段 1 接 PostGIS 时只换 provider，接口不变。`session_key` 阶段 0 不落库（解手机号才需要），拿到即丢。

**Interfaces:**
- Consumes: `AccessTokenFetcher`、`TOKEN_STORE`、`WECHAT_TOKEN_FETCHER`（Task 9）、`ApiException`（Task 8）
- Produces:
  - `UserRecord { id: string; openid: string; nickname: string | null; avatarUrl: string | null; createdAt: Date }`
  - `USER_REPOSITORY`、`UserRepository.findByOpenid(openid)`、`UserRepository.create(openid)`、`InMemoryUserRepository`
  - `UsersService.upsertByOpenid(openid): Promise<{ user: UserRecord; isNewUser: boolean }>`
  - `WechatApiService.code2Session(code): Promise<{ openid: string; sessionKey: string }>`、`WechatApiService.fetchAccessToken()`
  - `AuthService.loginWithCode(code): Promise<LoginResult>`，`LoginResult { token: string; userId: string; isNewUser: boolean }`
  - `POST /auth/wx-login`，请求体 `{ code: string }`

- [ ] **Step 1: 写失败测试（假上游部分）**

`server/test/auth-login.spec.ts`：

```ts
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { verify } from 'jsonwebtoken';
import request from 'supertest';
import { ERROR_CODES } from '@paws/types';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter';
import { ApiException } from '../src/common/api.exception';
import { ResponseInterceptor } from '../src/common/response.interceptor';
import { WechatApiService } from '../src/wechat/wechat-api.service';

class FakeWechatApi {
  openid = 'openid-aaa';
  fail = false;

  async code2Session(code: string): Promise<{ openid: string; sessionKey: string }> {
    if (this.fail) {
      throw new ApiException(ERROR_CODES.UPSTREAM_WECHAT, undefined, 502);
    }
    return { openid: this.openid, sessionKey: `sk-${code}` };
  }

  async fetchAccessToken(): Promise<{ access_token: string; expires_in: number }> {
    return { access_token: 'at', expires_in: 7200 };
  }
}
```

- [ ] **Step 2: 写失败测试（用例部分）**

同一文件追加：

```ts
describe('POST /auth/wx-login', () => {
  let app: INestApplication;
  const fake = new FakeWechatApi();

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(WechatApiService)
      .useValue(fake)
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    fake.fail = false;
    fake.openid = 'openid-aaa';
  });

  it('新 openid 建号并签发可验签的 JWT', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/wx-login')
      .send({ code: 'code-1' })
      .expect(201);
    expect(res.body.code).toBe(0);
    expect(res.body.data.isNewUser).toBe(true);
    const payload = verify(res.body.data.token, 'test-secret') as Record<string, unknown>;
    expect(payload.sub).toBe(res.body.data.userId);
    expect(payload.openid).toBe('openid-aaa');
    expect(typeof payload.exp).toBe('number');
  });

  it('同一 openid 二次登录复用同一 userId', async () => {
    const first = await request(app.getHttpServer()).post('/auth/wx-login').send({ code: 'a' });
    const second = await request(app.getHttpServer()).post('/auth/wx-login').send({ code: 'b' });
    expect(second.body.data.userId).toBe(first.body.data.userId);
    expect(second.body.data.isNewUser).toBe(false);
  });

  it('不同 openid 得到不同 userId', async () => {
    const a = await request(app.getHttpServer()).post('/auth/wx-login').send({ code: 'a' });
    fake.openid = 'openid-bbb';
    const b = await request(app.getHttpServer()).post('/auth/wx-login').send({ code: 'b' });
    expect(b.body.data.userId).not.toBe(a.body.data.userId);
  });

  it('缺 code 时返回 42200', async () => {
    const res = await request(app.getHttpServer()).post('/auth/wx-login').send({}).expect(422);
    expect(res.body.code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it('code2Session 失败时收敛为 50201 + 中文文案', async () => {
    fake.fail = true;
    const res = await request(app.getHttpServer())
      .post('/auth/wx-login')
      .send({ code: 'bad' })
      .expect(502);
    expect(res.body.code).toBe(ERROR_CODES.UPSTREAM_WECHAT);
    expect(res.body.message).toBe('微信服务暂时不可用');
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

```bash
npm test -w server -- auth-login
```

预期：FAIL，报 `Cannot find module '../src/wechat/wechat-api.service'`。

- [ ] **Step 4: 实现用户仓储与服务**

`server/src/users/user.repository.ts`：

```ts
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

export const USER_REPOSITORY = 'UserRepository';

export interface UserRecord {
  id: string;
  openid: string;
  nickname: string | null;
  avatarUrl: string | null;
  createdAt: Date;
}

export interface UserRepository {
  findByOpenid(openid: string): Promise<UserRecord | null>;
  create(openid: string): Promise<UserRecord>;
}

/** 阶段 0 占位实现；阶段 1 换成 PostgreSQL 实现，接口不动。 */
@Injectable()
export class InMemoryUserRepository implements UserRepository {
  private readonly byOpenid = new Map<string, UserRecord>();

  async findByOpenid(openid: string): Promise<UserRecord | null> {
    return this.byOpenid.get(openid) ?? null;
  }

  async create(openid: string): Promise<UserRecord> {
    const record: UserRecord = {
      id: randomUUID(),
      openid,
      nickname: null,
      avatarUrl: null,
      createdAt: new Date(),
    };
    this.byOpenid.set(openid, record);
    return record;
  }
}
```

`server/src/users/users.service.ts`：

```ts
import { Inject, Injectable } from '@nestjs/common';
import { USER_REPOSITORY, type UserRecord, type UserRepository } from './user.repository';

@Injectable()
export class UsersService {
  constructor(@Inject(USER_REPOSITORY) private readonly repo: UserRepository) {}

  /** openid 是唯一身份锚点，没有就建号。 */
  async upsertByOpenid(openid: string): Promise<{ user: UserRecord; isNewUser: boolean }> {
    const existing = await this.repo.findByOpenid(openid);
    if (existing) return { user: existing, isNewUser: false };
    return { user: await this.repo.create(openid), isNewUser: true };
  }
}
```

`server/src/users/users.module.ts`：

```ts
import { Module } from '@nestjs/common';
import { InMemoryUserRepository, USER_REPOSITORY } from './user.repository';
import { UsersService } from './users.service';

@Module({
  providers: [UsersService, { provide: USER_REPOSITORY, useClass: InMemoryUserRepository }],
  exports: [UsersService],
})
export class UsersModule {}
```

- [ ] **Step 5: 实现微信 API 服务**

`server/src/wechat/wechat-api.service.ts`：

```ts
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ERROR_CODES } from '@paws/types';
import { ApiException } from '../common/api.exception';
import type { AccessTokenFetcher } from './access-token.service';

const BASE = 'https://api.weixin.qq.com';

@Injectable()
export class WechatApiService implements AccessTokenFetcher {
  private readonly logger = new Logger(WechatApiService.name);

  /** 只允许 AccessTokenService 调用；业务代码一律用 AccessTokenService.get()。 */
  async fetchAccessToken(): Promise<{ access_token: string; expires_in: number }> {
    const body = await this.getJson(
      `${BASE}/cgi-bin/token?grant_type=client_credential` +
        `&appid=${this.env('WX_APPID')}&secret=${this.env('WX_SECRET')}`,
    );
    if (typeof body.access_token !== 'string') throw this.upstream(body);
    return { access_token: body.access_token, expires_in: Number(body.expires_in ?? 7200) };
  }

  async code2Session(code: string): Promise<{ openid: string; sessionKey: string }> {
    const body = await this.getJson(
      `${BASE}/sns/jscode2session?appid=${this.env('WX_APPID')}` +
        `&secret=${this.env('WX_SECRET')}&js_code=${encodeURIComponent(code)}` +
        `&grant_type=authorization_code`,
    );
    if (typeof body.openid !== 'string') throw this.upstream(body);
    return { openid: body.openid, sessionKey: String(body.session_key ?? '') };
  }

  private env(name: string): string {
    const value = process.env[name];
    if (!value) throw new Error(`缺少环境变量 ${name}`);
    return value;
  }

  private async getJson(url: string): Promise<Record<string, unknown>> {
    const res = await fetch(url);
    if (!res.ok) throw this.upstream({ http: res.status });
    return (await res.json()) as Record<string, unknown>;
  }

  /** errcode / errmsg 只进日志，不进响应体。 */
  private upstream(detail: unknown): ApiException {
    this.logger.error(`微信上游返回异常：${JSON.stringify(detail)}`);
    return new ApiException(ERROR_CODES.UPSTREAM_WECHAT, undefined, HttpStatus.BAD_GATEWAY);
  }
}
```

`server/src/wechat/wechat.module.ts`：

```ts
import { Module } from '@nestjs/common';
import { AccessTokenService, WECHAT_TOKEN_FETCHER } from './access-token.service';
import { RedisTokenStore, TOKEN_STORE } from './token-store';
import { WechatApiService } from './wechat-api.service';

@Module({
  providers: [
    WechatApiService,
    { provide: TOKEN_STORE, useClass: RedisTokenStore },
    { provide: WECHAT_TOKEN_FETCHER, useExisting: WechatApiService },
    AccessTokenService,
  ],
  exports: [WechatApiService, AccessTokenService],
})
export class WechatModule {}
```

- [ ] **Step 6: 实现登录编排与路由**

`server/src/auth/auth.service.ts`：

```ts
import { HttpStatus, Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@paws/types';
import { sign } from 'jsonwebtoken';
import { ApiException } from '../common/api.exception';
import { UsersService } from '../users/users.service';
import { WechatApiService } from '../wechat/wechat-api.service';

export interface LoginResult {
  token: string;
  userId: string;
  isNewUser: boolean;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly wechat: WechatApiService,
    private readonly users: UsersService,
  ) {}

  async loginWithCode(code: string): Promise<LoginResult> {
    if (!code) {
      throw new ApiException(
        ERROR_CODES.VALIDATION_FAILED,
        '缺少登录凭证 code',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    // session_key 阶段 0 用不到（解手机号才需要），拿到即丢，不落库。
    const { openid } = await this.wechat.code2Session(code);
    const { user, isNewUser } = await this.users.upsertByOpenid(openid);
    return { token: this.signToken(user.id, openid), userId: user.id, isNewUser };
  }

  private signToken(userId: string, openid: string): string {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error('缺少环境变量 JWT_SECRET');
    return sign({ openid }, secret, {
      subject: userId,
      expiresIn: Number(process.env.JWT_TTL_SECONDS ?? 604800),
    });
  }
}
```

`server/src/auth/auth.controller.ts`：

```ts
import { Body, Controller, Post } from '@nestjs/common';
import { AuthService, type LoginResult } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('wx-login')
  login(@Body() body: { code?: string }): Promise<LoginResult> {
    return this.auth.loginWithCode(body?.code ?? '');
  }
}
```

`server/src/auth/auth.module.ts`：

```ts
import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { WechatModule } from '../wechat/wechat.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  imports: [WechatModule, UsersModule],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
```

`server/src/app.module.ts` 改为：

```ts
import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { HealthController } from './health/health.controller';

@Module({ imports: [AuthModule], controllers: [HealthController] })
export class AppModule {}
```

- [ ] **Step 7: 运行测试确认通过**

```bash
npm test -w server
```

预期：PASS，14 个用例全绿。

- [ ] **Step 8: 提交**

```bash
git add server/src server/test
git commit -m "feat: add wechat login endpoint issuing jwt"
```

---

### Task 11: wx API 适配层与登录态单点持有

页面不许直接碰 `wx.*`。把用到的几个 wx 接口收在 `WxAdapter` 里，既满足这条约束，也让 `SessionStore` 能在 Node 里跑单测（jest 环境没有 `wx` 全局）。

**Files:**
- Create: `miniprogram/api/wx-promise.ts`
- Create: `miniprogram/api/errors.ts`
- Create: `miniprogram/store/session.ts`
- Create: `miniprogram/test/fake-wx.ts`（测试替身，Task 12 复用）
- Test: `miniprogram/test/session.spec.ts`

**Interfaces:**
- Consumes: `ERROR_CODES`、`messageForCode`、`ApiResponse`（`miniprogram/shared/types`，Task 7 同步）
- Produces:
  - `WxAdapter`：`login(): Promise<{ code: string }>`、`request<T>(opts): Promise<{ statusCode: number; data: T }>`、`getStorage(key): string | null`、`setStorage(key, value): void`、`removeStorage(key): void`
  - `wxAdapter: WxAdapter`（真实实现）
  - `ApiError extends Error { code: number }`
  - `SessionStore`：`get token(): string | null`、`clear(): void`、`refresh(): Promise<string>`
  - `TOKEN_STORAGE_KEY = 'paws:token'`

- [ ] **Step 1: 写适配层与错误类型**

`miniprogram/api/errors.ts`：

```ts
/** 统一的前端错误：code 是业务错误码，message 已是可直接展示的中文。 */
export class ApiError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
```

`miniprogram/api/wx-promise.ts`：

```ts
export interface WxRequestOptions {
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  data?: unknown;
  header?: Record<string, string>;
}

export interface WxRequestResult<T> {
  statusCode: number;
  data: T;
}

/** 收口所有用到的 wx 接口，页面与 store 只依赖这个接口。 */
export interface WxAdapter {
  login(): Promise<{ code: string }>;
  request<T>(opts: WxRequestOptions): Promise<WxRequestResult<T>>;
  getStorage(key: string): string | null;
  setStorage(key: string, value: string): void;
  removeStorage(key: string): void;
}

export const wxAdapter: WxAdapter = {
  login: () =>
    new Promise((resolve, reject) => {
      wx.login({ success: (r) => resolve({ code: r.code }), fail: reject });
    }),

  request: <T>(opts: WxRequestOptions) =>
    new Promise<WxRequestResult<T>>((resolve, reject) => {
      wx.request({
        url: opts.url,
        method: opts.method,
        data: opts.data as WechatMiniprogram.RequestOption['data'],
        header: opts.header,
        success: (r) => resolve({ statusCode: r.statusCode, data: r.data as T }),
        fail: reject,
      });
    }),

  getStorage: (key) => (wx.getStorageSync(key) as string) || null,
  setStorage: (key, value) => wx.setStorageSync(key, value),
  removeStorage: (key) => wx.removeStorageSync(key),
};
```

- [ ] **Step 2: 写测试替身**

`miniprogram/test/fake-wx.ts`：

```ts
import type { WxAdapter, WxRequestOptions, WxRequestResult } from '../api/wx-promise';

export type Responder = (opts: WxRequestOptions) => WxRequestResult<unknown>;

export class FakeWx implements WxAdapter {
  loginCalls = 0;
  readonly sent: WxRequestOptions[] = [];
  private readonly storage = new Map<string, string>();
  private responders: Responder[] = [];

  /** 按调用顺序排队响应；队列耗尽后重复使用最后一个。 */
  queue(...responders: Responder[]): void {
    this.responders = responders;
  }

  async login(): Promise<{ code: string }> {
    this.loginCalls += 1;
    await new Promise((r) => setTimeout(r, 3));
    return { code: `wx-code-${this.loginCalls}` };
  }

  async request<T>(opts: WxRequestOptions): Promise<WxRequestResult<T>> {
    this.sent.push(opts);
    const responder =
      this.responders[this.sent.length - 1] ?? this.responders[this.responders.length - 1];
    if (!responder) throw new Error('FakeWx 没有排队响应');
    return responder(opts) as WxRequestResult<T>;
  }

  getStorage(key: string): string | null {
    return this.storage.get(key) ?? null;
  }

  setStorage(key: string, value: string): void {
    this.storage.set(key, value);
  }

  removeStorage(key: string): void {
    this.storage.delete(key);
  }
}

export const ok = <T>(data: T, statusCode = 200): WxRequestResult<unknown> => ({
  statusCode,
  data: { code: 0, message: 'ok', data },
});

export const fail = (
  code: number,
  message: string,
  statusCode: number,
): WxRequestResult<unknown> => ({ statusCode, data: { code, message, data: null } });
```

- [ ] **Step 3: 写失败测试**

`miniprogram/test/session.spec.ts`：

```ts
import { ApiError } from '../api/errors';
import { SessionStore, TOKEN_STORAGE_KEY } from '../store/session';
import { FakeWx, fail, ok } from './fake-wx';

const BASE = 'https://api.example.com';

describe('SessionStore', () => {
  let wx: FakeWx;
  let session: SessionStore;

  beforeEach(() => {
    wx = new FakeWx();
    session = new SessionStore(wx, BASE);
  });

  it('token 从 storage 直接读，不触发 wx.login', () => {
    wx.setStorage(TOKEN_STORAGE_KEY, 'stored-token');
    expect(session.token).toBe('stored-token');
    expect(wx.loginCalls).toBe(0);
  });

  it('refresh 成功后把 token 写进 storage', async () => {
    wx.queue(() => ok({ token: 'fresh-token', userId: 'u1', isNewUser: true }, 201));
    expect(await session.refresh()).toBe('fresh-token');
    expect(wx.getStorage(TOKEN_STORAGE_KEY)).toBe('fresh-token');
    expect(wx.sent[0].url).toBe(`${BASE}/auth/wx-login`);
    expect(wx.sent[0].data).toEqual({ code: 'wx-code-1' });
  });

  it('五个并发 refresh 只调一次 wx.login', async () => {
    wx.queue(() => ok({ token: 'once', userId: 'u1', isNewUser: false }, 201));
    const tokens = await Promise.all(Array.from({ length: 5 }, () => session.refresh()));
    expect(wx.loginCalls).toBe(1);
    expect(new Set(tokens)).toEqual(new Set(['once']));
  });

  it('登录接口返回非 0 时抛 ApiError 且不写 storage', async () => {
    wx.queue(() => fail(50201, '微信服务暂时不可用', 502));
    await expect(session.refresh()).rejects.toBeInstanceOf(ApiError);
    expect(wx.getStorage(TOKEN_STORAGE_KEY)).toBeNull();
  });

  it('失败后允许再次 refresh，飞行中的 promise 已释放', async () => {
    wx.queue(
      () => fail(50201, '微信服务暂时不可用', 502),
      () => ok({ token: 'second-try', userId: 'u1', isNewUser: false }, 201),
    );
    await expect(session.refresh()).rejects.toBeInstanceOf(ApiError);
    expect(await session.refresh()).toBe('second-try');
    expect(wx.loginCalls).toBe(2);
  });

  it('clear 之后 token 为空', () => {
    wx.setStorage(TOKEN_STORAGE_KEY, 'x');
    session.clear();
    expect(session.token).toBeNull();
  });
});
```

- [ ] **Step 4: 运行测试确认失败**

```bash
npm test -w miniprogram -- session
```

预期：FAIL，报 `Cannot find module '../store/session'`。

- [ ] **Step 5: 实现最小代码**

`miniprogram/store/session.ts`：

```ts
import { ERROR_CODES, messageForCode } from '../shared/types';
import { ApiError } from '../api/errors';
import type { WxAdapter } from '../api/wx-promise';

export const TOKEN_STORAGE_KEY = 'paws:token';

interface Envelope<T> {
  code: number;
  message: string;
  data: T | null;
}

interface LoginData {
  token: string;
  userId: string;
  isNewUser: boolean;
}

/** 登录态单点持有：飞行中的登录请求被复用，避免并发拉起多次 wx.login。 */
export class SessionStore {
  private inflight: Promise<string> | null = null;

  constructor(
    private readonly wx: WxAdapter,
    private readonly baseUrl: string,
  ) {}

  get token(): string | null {
    return this.wx.getStorage(TOKEN_STORAGE_KEY);
  }

  clear(): void {
    this.wx.removeStorage(TOKEN_STORAGE_KEY);
  }

  refresh(): Promise<string> {
    if (!this.inflight) {
      const task = this.doRefresh();
      this.inflight = task;
      // 成败都释放，失败后允许重试。
      const release = (): void => {
        if (this.inflight === task) this.inflight = null;
      };
      task.then(release, release);
    }
    return this.inflight;
  }

  private async doRefresh(): Promise<string> {
    const { code } = await this.wx.login();
    const res = await this.wx.request<Envelope<LoginData>>({
      url: `${this.baseUrl}/auth/wx-login`,
      method: 'POST',
      data: { code },
    });
    const body = res.data;
    if (body.code !== ERROR_CODES.OK || !body.data) {
      throw new ApiError(body.code, messageForCode(body.code, body.message));
    }
    this.wx.setStorage(TOKEN_STORAGE_KEY, body.data.token);
    return body.data.token;
  }
}
```

- [ ] **Step 6: 运行测试确认通过**

```bash
npm test -w miniprogram
```

预期：PASS，34 个用例全绿。

- [ ] **Step 7: 提交**

```bash
git add miniprogram/api miniprogram/store/session.ts miniprogram/test/fake-wx.ts \
  miniprogram/test/session.spec.ts
git commit -m "feat: hold miniprogram session in a single store"
```

---

### Task 12: 统一请求层与 401 静默重登

**Files:**
- Create: `miniprogram/config.ts`
- Create: `miniprogram/api/request.ts`
- Create: `miniprogram/api/client.ts`
- Test: `miniprogram/test/request.spec.ts`

**Interfaces:**
- Consumes: `WxAdapter`、`SessionStore`、`ApiError`（Task 11）、`ERROR_CODES`、`messageForCode`
- Produces:
  - `API_BASE_URL: string`
  - `CallOptions { method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; data?: unknown }`
  - `ApiClient.call<T>(path: string, opts?: CallOptions): Promise<T>`，返回信封里的 `data`
  - `api: ApiClient`、`session: SessionStore`（页面唯一入口）

- [ ] **Step 1: 写失败测试（基础链路）**

`miniprogram/test/request.spec.ts`：

```ts
import { ERROR_CODES } from '../shared/types';
import { ApiClient } from '../api/request';
import { SessionStore, TOKEN_STORAGE_KEY } from '../store/session';
import { FakeWx, fail, ok } from './fake-wx';

const BASE = 'https://api.example.com';

describe('ApiClient', () => {
  let wx: FakeWx;
  let client: ApiClient;

  beforeEach(() => {
    wx = new FakeWx();
    client = new ApiClient(wx, new SessionStore(wx, BASE), BASE);
  });

  it('没有 token 时先登录再发业务请求', async () => {
    wx.queue(
      () => ok({ token: 't1', userId: 'u1', isNewUser: true }, 201),
      () => ok({ items: [] }),
    );
    await client.call('/pets');
    expect(wx.loginCalls).toBe(1);
    expect(wx.sent.map((s) => s.url)).toEqual([`${BASE}/auth/wx-login`, `${BASE}/pets`]);
  });

  it('业务请求带 Authorization 头，已有 token 时不再登录', async () => {
    wx.setStorage(TOKEN_STORAGE_KEY, 'existing');
    wx.queue(() => ok({ items: [] }));
    await client.call('/pets');
    expect(wx.loginCalls).toBe(0);
    expect(wx.sent[0].header?.Authorization).toBe('Bearer existing');
  });

  it('POST 请求把 method 与 data 原样带上', async () => {
    wx.setStorage(TOKEN_STORAGE_KEY, 't');
    wx.queue(() => ok({ id: 'p1' }));
    await client.call('/posts', { method: 'POST', data: { content: '今天遛狗' } });
    expect(wx.sent[0].method).toBe('POST');
    expect(wx.sent[0].data).toEqual({ content: '今天遛狗' });
  });
});
```

- [ ] **Step 2: 追加重登与错误码用例**

在同一个 `describe` 里补 4 个用例。`FakeWx` 按 `sent.length` 依次消费 `queue()` 里的 responder，所以下面第 4 个用例的三次响应正好对应「原请求 401 → 登录成功 → 重放又 401」：

```ts
  it('401 时静默重登并重放原请求，调用方无感', async () => {
    wx.setStorage(TOKEN_STORAGE_KEY, 'stale');
    wx.queue(
      () => fail(ERROR_CODES.UNAUTHORIZED, '登录已过期，请重试', 401),
      () => ok({ token: 'renewed', userId: 'u1', isNewUser: false }, 201),
      () => ok({ name: '大黄' }),
    );
    expect(await client.call<{ name: string }>('/pets/1')).toEqual({ name: '大黄' });
    expect(wx.loginCalls).toBe(1);
    expect(wx.sent[2].header?.Authorization).toBe('Bearer renewed');
  });

  it('重放后仍 401 则抛 ApiError，且只重试一次', async () => {
    wx.setStorage(TOKEN_STORAGE_KEY, 'stale');
    wx.queue(
      () => fail(ERROR_CODES.UNAUTHORIZED, '登录已过期，请重试', 401),
      () => ok({ token: 'renewed', userId: 'u1', isNewUser: false }, 201),
      () => fail(ERROR_CODES.UNAUTHORIZED, '登录已过期，请重试', 401),
    );
    await expect(client.call('/pets/1')).rejects.toMatchObject({
      code: ERROR_CODES.UNAUTHORIZED,
    });
    expect(wx.loginCalls).toBe(1);
    expect(wx.sent).toHaveLength(3);
  });

  it('业务错误码抛 ApiError，服务端文案优先', async () => {
    wx.setStorage(TOKEN_STORAGE_KEY, 't');
    wx.queue(() => fail(ERROR_CODES.VALIDATION_FAILED, '犬证编号格式不正确', 422));
    await expect(client.call('/licenses')).rejects.toThrow('犬证编号格式不正确');
  });

  it('服务端没给文案时回落到本地错误码表', async () => {
    wx.setStorage(TOKEN_STORAGE_KEY, 't');
    wx.queue(() => fail(ERROR_CODES.RATE_LIMITED, '', 429));
    await expect(client.call('/posts', { method: 'POST' })).rejects.toThrow(
      '操作太频繁，请稍后再试',
    );
  });
```

- [ ] **Step 3: 运行测试确认失败**

```bash
npm test -w miniprogram -- request
```

预期：FAIL，`Cannot find module '../api/request'`。

- [ ] **Step 4: 写配置文件**

`miniprogram/config.ts`：

```ts
/**
 * 域名必须是已 ICP 备案、并登记进小程序后台 request 白名单的合法域名（spec §3.2）。
 * 开发期在开发者工具里勾「不校验合法域名」，不要在代码里换成 IP。
 */
export const API_BASE_URL = 'https://api.paws-paths.example.com';
```

- [ ] **Step 5: 实现最小代码**

`miniprogram/api/request.ts`：

```ts
import { ERROR_CODES, messageForCode } from '../shared/types';
import type { SessionStore } from '../store/session';
import { ApiError } from './errors';
import type { WxAdapter, WxRequestOptions, WxRequestResult } from './wx-promise';

export interface CallOptions {
  method?: WxRequestOptions['method'];
  data?: unknown;
}

interface Envelope<T> {
  code: number;
  message: string;
  data: T | null;
}

/** 页面只允许通过这里发请求：统一注入登录态、401 重放、错误码转中文文案。 */
export class ApiClient {
  constructor(
    private readonly wx: WxAdapter,
    private readonly session: SessionStore,
    private readonly baseUrl: string,
  ) {}

  async call<T>(path: string, opts: CallOptions = {}): Promise<T> {
    let token = this.session.token ?? (await this.session.refresh());
    let res = await this.send<T>(path, opts, token);

    if (this.isUnauthorized(res)) {
      // 只重试一次：token 持续无效时不能打成死循环。
      this.session.clear();
      token = await this.session.refresh();
      res = await this.send<T>(path, opts, token);
    }

    const body = res.data;
    if (body.code !== ERROR_CODES.OK) {
      throw new ApiError(body.code, messageForCode(body.code, body.message));
    }
    return body.data as T;
  }

  private send<T>(
    path: string,
    opts: CallOptions,
    token: string,
  ): Promise<WxRequestResult<Envelope<T>>> {
    return this.wx.request<Envelope<T>>({
      url: `${this.baseUrl}${path}`,
      method: opts.method ?? 'GET',
      data: opts.data,
      header: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    });
  }

  private isUnauthorized(res: WxRequestResult<Envelope<unknown>>): boolean {
    return res.statusCode === 401 || res.data?.code === ERROR_CODES.UNAUTHORIZED;
  }
}
```

- [ ] **Step 6: 装配页面唯一入口**

`miniprogram/api/client.ts`：

```ts
import { API_BASE_URL } from '../config';
import { SessionStore } from '../store/session';
import { ApiClient } from './request';
import { wxAdapter } from './wx-promise';

/** 全局单例。页面一律 `import { api } from '../../api/client'`，禁止直接调 wx.request。 */
export const session = new SessionStore(wxAdapter, API_BASE_URL);
export const api = new ApiClient(wxAdapter, session, API_BASE_URL);
```

- [ ] **Step 7: 运行测试确认通过**

```bash
npm test -w miniprogram
```

预期：PASS，41 个用例全绿。

- [ ] **Step 8: 提交**

```bash
git add miniprogram/config.ts miniprogram/api/request.ts miniprogram/api/client.ts \
  miniprogram/test/request.spec.ts
git commit -m "feat: add unified request layer with silent relogin"
```

---

### Task 13: 位置单点持有与拒绝授权降级

**Files:**
- Modify: `miniprogram/api/wx-promise.ts`（`WxAdapter` 增加 `getLocation`）
- Modify: `miniprogram/test/fake-wx.ts`（补 `getLocation` 桩）
- Create: `miniprogram/store/location.ts`
- Test: `miniprogram/test/location.spec.ts`

**Interfaces:**
- Consumes: `WxAdapter`
- Produces:
  - `Coords { latitude: number; longitude: number }`
  - `LocationState { mode: 'precise'; coords: Coords } | { mode: 'city' }`
  - `LocationStore.ensure(): Promise<LocationState>`、`LocationStore.state: LocationState | null`、`LocationStore.reset(): void`

spec §6 要求定位被拒绝时**不阻断**，降级为按城市浏览、隐藏距离字段；spec §5.4 要求位置由单点持有，避免各页面重复弹授权框。这两条都在这个 store 里落实。

- [ ] **Step 1: 给适配层加 getLocation**

`miniprogram/api/wx-promise.ts` 的 `WxAdapter` 接口末尾加一行：

```ts
  getLocation(): Promise<{ latitude: number; longitude: number }>;
```

同文件的 `wxAdapter` 对象里加实现：

```ts
  getLocation: () =>
    new Promise((resolve, reject) => {
      // gcj02 与腾讯地图坐标系一致；必须先在 app.json 声明 requiredPrivateInfos，否则直接 fail。
      wx.getLocation({
        type: 'gcj02',
        success: (res) => resolve({ latitude: res.latitude, longitude: res.longitude }),
        fail: reject,
      });
    }),
```

- [ ] **Step 2: 给 FakeWx 加定位桩**

`miniprogram/test/fake-wx.ts` 的 `FakeWx` 类里加：

```ts
  getLocationCalls = 0;

  /** 设成 Error 就是模拟用户拒绝授权。 */
  locationOutcome: { latitude: number; longitude: number } | Error = {
    latitude: 31.23,
    longitude: 121.47,
  };

  async getLocation(): Promise<{ latitude: number; longitude: number }> {
    this.getLocationCalls += 1;
    if (this.locationOutcome instanceof Error) throw this.locationOutcome;
    return this.locationOutcome;
  }
```

- [ ] **Step 3: 写失败测试**

`miniprogram/test/location.spec.ts`：

```ts
import { LocationStore } from '../store/location';
import { FakeWx } from './fake-wx';

describe('LocationStore', () => {
  let wx: FakeWx;
  let store: LocationStore;

  beforeEach(() => {
    wx = new FakeWx();
    store = new LocationStore(wx);
  });

  it('授权成功时进入精确模式并缓存坐标', async () => {
    expect(await store.ensure()).toEqual({
      mode: 'precise',
      coords: { latitude: 31.23, longitude: 121.47 },
    });
    expect(store.state).toEqual({ mode: 'precise', coords: { latitude: 31.23, longitude: 121.47 } });
  });

  it('并发 3 次 ensure 只弹一次授权', async () => {
    await Promise.all([store.ensure(), store.ensure(), store.ensure()]);
    expect(wx.getLocationCalls).toBe(1);
  });

  it('已有结果后再 ensure 不再调用 wx.getLocation', async () => {
    await store.ensure();
    await store.ensure();
    expect(wx.getLocationCalls).toBe(1);
  });

  it('拒绝授权时降级为城市模式且不抛错', async () => {
    wx.locationOutcome = new Error('auth deny');
    expect(await store.ensure()).toEqual({ mode: 'city' });
  });

  it('拒绝过一次后不再反复弹框', async () => {
    wx.locationOutcome = new Error('auth deny');
    await store.ensure();
    await store.ensure();
    expect(wx.getLocationCalls).toBe(1);
  });

  it('reset 后允许重新申请授权', async () => {
    wx.locationOutcome = new Error('auth deny');
    await store.ensure();
    wx.locationOutcome = { latitude: 22.54, longitude: 114.06 };
    store.reset();
    expect(await store.ensure()).toEqual({
      mode: 'precise',
      coords: { latitude: 22.54, longitude: 114.06 },
    });
    expect(wx.getLocationCalls).toBe(2);
  });
});
```

- [ ] **Step 4: 运行测试确认失败**

```bash
npm test -w miniprogram -- location
```

预期：FAIL，`Cannot find module '../store/location'`。

- [ ] **Step 5: 实现最小代码**

`miniprogram/store/location.ts`：

```ts
import type { WxAdapter } from '../api/wx-promise';

export interface Coords {
  latitude: number;
  longitude: number;
}

export type LocationState = { mode: 'precise'; coords: Coords } | { mode: 'city' };

/** 位置单点持有：并发调用共享同一次授权，拒绝后记住降级结果，不反复弹框。 */
export class LocationStore {
  private current: LocationState | null = null;
  private inflight: Promise<LocationState> | null = null;

  constructor(private readonly wx: WxAdapter) {}

  get state(): LocationState | null {
    return this.current;
  }

  /** 用户在系统设置里重新打开定位后调用，清掉降级结果重新申请。 */
  reset(): void {
    this.current = null;
  }

  ensure(): Promise<LocationState> {
    if (this.current) return Promise.resolve(this.current);
    if (!this.inflight) {
      const task = this.resolveState();
      this.inflight = task;
      const release = (): void => {
        if (this.inflight === task) this.inflight = null;
      };
      task.then(release, release);
    }
    return this.inflight;
  }

  private async resolveState(): Promise<LocationState> {
    try {
      const coords = await this.wx.getLocation();
      this.current = { mode: 'precise', coords };
    } catch {
      // 拒绝授权不是错误：spec §6 要求降级为按城市浏览，距离字段隐藏。
      this.current = { mode: 'city' };
    }
    return this.current;
  }
}

/** 全局单例，页面一律用这个，不要各自 new。 */
export const locationStore = new LocationStore(wxAdapter);
```

顶部的 import 相应写成 `import { wxAdapter, type WxAdapter } from '../api/wx-promise';`。`wxAdapter` 是对象字面量，方法体只在被调用时才引用 `wx` 全局对象，所以在 Node 里 import 这个模块不会炸——`location.spec.ts` 直接注入 `FakeWx`，永远不会调到真实实现。


- [ ] **Step 6: 运行测试确认通过**

```bash
npm test -w miniprogram
```

预期：PASS，47 个用例全绿。

- [ ] **Step 7: 提交**

```bash
git add miniprogram/api/wx-promise.ts miniprogram/store/location.ts \
  miniprogram/test/fake-wx.ts miniprogram/test/location.spec.ts
git commit -m "feat: hold location in a single store with city fallback"
```

---

### Task 14: 分包骨架与 app.json

**Files:**
- Create: `miniprogram/app.json`
- Create: `miniprogram/app.ts`
- Create: `miniprogram/sitemap.json`
- Create: `project.config.json`（仓库根）
- Create: 17 个空壳页面（见 Step 2 的清单）
- Test: `miniprogram/test/app-json.spec.ts`

**Interfaces:**
- Consumes: `session`（Task 12 的 `api/client.ts`）
- Produces: 主包页面 `pages/plaza/index`、`pages/venue-list/index`、`pages/profile/index`、`pages/pet-detail/index`；分包根 `packages/venue`、`packages/profile`、`packages/cert`、`packages/chat`、`packages/post`

这个任务落实 spec §5.1 的分包表，并带上本计划开头「对 spec 的一处修正」：**tabBar 的三个页面必须在主包**，所以 spec 把「周边列表」放进 `venue` 分包、「个人中心」放进 `profile` 分包的写法要调整为——列表页与个人中心留主包，二级页进分包。

- [ ] **Step 1: 写失败测试**

`miniprogram/test/app-json.spec.ts`：

```ts
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

interface AppJson {
  pages: string[];
  subPackages: { root: string; pages: string[] }[];
  preloadRule: Record<string, { network: string; packages: string[] }>;
  tabBar: { custom: boolean; list: { pagePath: string; text: string }[] };
  requiredPrivateInfos: string[];
  permission: Record<string, { desc: string }>;
  renderer: string;
}

const ROOT = resolve(__dirname, '..');
const app = JSON.parse(readFileSync(join(ROOT, 'app.json'), 'utf8')) as AppJson;
const subPagePaths = app.subPackages.flatMap((p) => p.pages.map((page) => `${p.root}/${page}`));
const allPages = [...app.pages, ...subPagePaths];

describe('app.json', () => {
  it('tabBar 的页面全部在主包内', () => {
    for (const item of app.tabBar.list) {
      expect(app.pages).toContain(item.pagePath);
      for (const pkg of app.subPackages) {
        expect(item.pagePath.startsWith(`${pkg.root}/`)).toBe(false);
      }
    }
  });

  it('每个声明的页面都有 4 个配套文件', () => {
    for (const page of allPages) {
      for (const ext of ['.ts', '.wxml', '.wxss', '.json']) {
        expect(existsSync(join(ROOT, page + ext))).toBe(true);
      }
    }
  });

  it('页面路径不重复', () => {
    expect(new Set(allPages).size).toBe(allPages.length);
  });

  it('preloadRule 的触发页与目标分包都已声明', () => {
    const roots = app.subPackages.map((p) => p.root);
    for (const [trigger, rule] of Object.entries(app.preloadRule)) {
      expect(allPages).toContain(trigger);
      for (const pkg of rule.packages) expect(roots).toContain(pkg);
    }
  });

  it('周边与个人中心分包被预下载', () => {
    const preloaded = Object.values(app.preloadRule).flatMap((r) => r.packages);
    expect(preloaded).toContain('packages/venue');
    expect(preloaded).toContain('packages/profile');
  });

  it('定位能力已报备并写了用途说明', () => {
    expect(app.requiredPrivateInfos).toContain('getLocation');
    expect(app.permission['scope.userLocation'].desc.length).toBeGreaterThan(8);
  });

  it('使用 skyline 渲染器且开启自定义 tabBar', () => {
    expect(app.renderer).toBe('skyline');
    expect(app.tabBar.custom).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npm test -w miniprogram -- app-json
```

预期：FAIL，读不到 `app.json`（`ENOENT`）。

- [ ] **Step 3: 生成 17 个空壳页面**

在仓库根执行（内容都是占位，后续阶段各自填充）：

```bash
PAGES="
pages/plaza/index
pages/venue-list/index
pages/profile/index
pages/pet-detail/index
packages/venue/pages/detail/index
packages/profile/pages/pet-edit/index
packages/profile/pages/following/index
packages/profile/pages/my-posts/index
packages/profile/pages/favorites/index
packages/profile/pages/history/index
packages/profile/pages/settings/index
packages/cert/pages/license-upload/index
packages/cert/pages/license-detail/index
packages/cert/pages/vaccine/index
packages/chat/pages/conversations/index
packages/chat/pages/chat/index
packages/post/pages/compose/index
"

for page in $PAGES; do
  mkdir -p "miniprogram/$(dirname "$page")"
  printf 'Page({\n  data: {},\n});\n' > "miniprogram/$page.ts"
  printf '<view class="page-gutter">占位页，后续阶段填充。</view>\n' > "miniprogram/$page.wxml"
  : > "miniprogram/$page.wxss"
  printf '{\n  "usingComponents": {}\n}\n' > "miniprogram/$page.json"
done
```

跑完确认数量：

```bash
ls miniprogram/pages/*/index.ts | wc -l   # 预期 4
find miniprogram/packages -name 'index.ts' | wc -l   # 预期 13
```

- [ ] **Step 4: 写 app.json**

`miniprogram/app.json`：

```json
{
  "pages": [
    "pages/plaza/index",
    "pages/venue-list/index",
    "pages/profile/index",
    "pages/pet-detail/index"
  ],
  "subPackages": [
    { "root": "packages/venue", "pages": ["pages/detail/index"] },
    {
      "root": "packages/profile",
      "pages": [
        "pages/pet-edit/index",
        "pages/following/index",
        "pages/my-posts/index",
        "pages/favorites/index",
        "pages/history/index",
        "pages/settings/index"
      ]
    },
    {
      "root": "packages/cert",
      "pages": ["pages/license-upload/index", "pages/license-detail/index", "pages/vaccine/index"]
    },
    { "root": "packages/chat", "pages": ["pages/conversations/index", "pages/chat/index"] },
    { "root": "packages/post", "pages": ["pages/compose/index"] }
  ],
  "preloadRule": {
    "pages/plaza/index": {
      "network": "all",
      "packages": ["packages/venue", "packages/profile"]
    }
  },
  "tabBar": {
    "custom": true,
    "list": [
      { "pagePath": "pages/plaza/index", "text": "广场" },
      { "pagePath": "pages/venue-list/index", "text": "周边" },
      { "pagePath": "pages/profile/index", "text": "我的" }
    ]
  },
  "window": {
    "navigationStyle": "custom",
    "backgroundColor": "#fff8f5",
    "backgroundTextStyle": "dark"
  },
  "renderer": "skyline",
  "rendererOptions": {
    "skyline": { "defaultDisplayBlock": true, "disableABTest": true, "sdkVersionBegin": "3.0.0" }
  },
  "componentFramework": "glass-easel",
  "lazyCodeLoading": "requiredComponents",
  "requiredPrivateInfos": ["getLocation"],
  "permission": {
    "scope.userLocation": { "desc": "用于展示附近的宠物与宠物友好场所的距离" }
  },
  "sitemapLocation": "sitemap.json"
}
```

两点说明：

- `window.backgroundColor` 只能吃字面色值，不支持 CSS 变量，所以这里必须写 hex。全局约束里的「禁止 hex 字面量」针对 wxss，`style-guard.ts` 也只扫 wxss，两者不冲突。这个值必须与 `DESIGN.md` 的 `background` 一致。
- `tabBar.custom: true` 依赖 `custom-tab-bar/index` 组件，它在 Task 15 建。这一步做完在开发者工具里会有一条找不到自定义 tabBar 的告警，Task 15 完成即消失。

- [ ] **Step 5: 写 app.ts、sitemap.json、project.config.json**

`miniprogram/app.ts`：

```ts
import { session } from './api/client';

App({
  onLaunch() {
    // 冷启动就换登录态，首页请求不用再等一次 wx.login 往返。
    // 失败不阻断启动：请求层遇 401 会自己重登重放。
    void session.refresh().catch(() => undefined);
  },
});
```

`miniprogram/sitemap.json`：

```json
{
  "desc": "小程序页面收录规则，字段说明见微信官方 sitemap 文档",
  "rules": [{ "action": "allow", "page": "*" }]
}
```

`project.config.json`（仓库根，不在 `miniprogram/` 里）：

```json
{
  "projectname": "paws-paths",
  "appid": "touristappid",
  "miniprogramRoot": "miniprogram/",
  "compileType": "miniprogram",
  "libVersion": "3.5.5",
  "setting": {
    "urlCheck": false,
    "es6": false,
    "enhance": false,
    "minified": true,
    "useCompilerPlugins": ["typescript"],
    "skylineRenderEnable": true
  },
  "packOptions": {
    "ignore": [
      { "type": "folder", "value": "test" },
      { "type": "folder", "value": "tools" }
    ]
  }
}
```

三点必须理解，否则会踩坑：

- `appid` 先填 `touristappid`（测试号），拿到正式 AppID 后替换。**不要**把正式 AppID 连同私钥一起进仓库。
- `urlCheck: false` 就是「不校验合法域名」，只在开发期有效，spec §3.2 记的是这条豁免。上线前域名必须已备案并登记白名单。
- `packOptions.ignore` 把 `test/` 与 `tools/` 排除出包体。它们是 Node 侧代码，进包会白占主包 2MB 预算。

- [ ] **Step 6: 运行测试确认通过**

```bash
npm test -w miniprogram
```

预期：PASS，54 个用例全绿。

- [ ] **Step 7: 提交**

```bash
git add miniprogram/app.json miniprogram/app.ts miniprogram/sitemap.json \
  miniprogram/pages miniprogram/packages project.config.json \
  miniprogram/test/app-json.spec.ts
git commit -m "feat: add subpackage skeleton and app config"
```

---

### Task 15: 图标管线（SVG → base64 data URI）

**Files:**
- Create: `miniprogram/assets/icons/paw.svg`
- Create: `miniprogram/assets/icons/place.svg`
- Create: `miniprogram/assets/icons/person.svg`
- Create: `miniprogram/tools/build-icons.ts`
- Create: `miniprogram/components/wf-icon/index.ts|wxml|wxss|json`
- Generated: `miniprogram/components/wf-icon/icons.ts`（提交进仓库）
- Modify: `miniprogram/package.json`（加 `build:icons`）
- Test: `miniprogram/test/icons.spec.ts`

**Interfaces:**
- Consumes: `extractFrontmatter`（Task 4 的 `tools/build-tokens.ts` 导出）
- Produces:
  - `COLOR_PLACEHOLDER: string`
  - `normalizeSvg(svg: string): string`
  - `paint(svg: string, color: string): string`
  - `toDataUri(svg: string): string`
  - `buildIconMap(svgs: Record<string, string>, colors: Record<string, string>, roles: string[]): Record<string, string>`
  - `renderModule(map: Record<string, string>): string`
  - `ICONS: Record<IconKey, string>`、`IconKey`（生成物）
  - `<wf-icon name role size />` 组件

spec §5.2 末行要求图标转 SVG 组件、不走字体。小程序的 `<image>` 对本地 `.svg` 与非 base64 的 data URI 支持不稳，所以**编译期**就把每个「图标 × 颜色角色」组合烧成 base64 data URI，运行时只查表，不做任何编解码。颜色角色的色值从 `DESIGN.md` 读，`DESIGN.md` 仍是唯一源。

- [ ] **Step 1: 放三个图标资产**

`miniprogram/assets/icons/paw.svg`：

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">
  <circle cx="6.5" cy="9" r="2.2" fill="currentColor"/>
  <circle cx="10.5" cy="6.2" r="2.2" fill="currentColor"/>
  <circle cx="15" cy="6.6" r="2.2" fill="currentColor"/>
  <circle cx="18.6" cy="10" r="2.2" fill="currentColor"/>
  <path d="M12.4 11.6c3.1 0 5.6 2.2 5.6 4.9 0 1.9-1.6 3.3-3.6 3.3-1 0-1.5-.3-2-.3s-1 .3-2 .3c-2 0-3.6-1.4-3.6-3.3 0-2.7 2.5-4.9 5.6-4.9Z" fill="currentColor"/>
</svg>
```

`miniprogram/assets/icons/place.svg`：

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">
  <path d="M12 21c4-4.4 6-7.6 6-10.2C18 6.9 15.3 4 12 4s-6 2.9-6 6.8C6 13.4 8 16.6 12 21Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="12" cy="10.5" r="2.4" stroke="currentColor" stroke-width="2"/>
</svg>
```

`miniprogram/assets/icons/person.svg`：

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">
  <circle cx="12" cy="8" r="3.4" stroke="currentColor" stroke-width="2"/>
  <path d="M5.5 19.5c.9-3.3 3.4-5.1 6.5-5.1s5.6 1.8 6.5 5.1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
</svg>
```

三个图标都用 `currentColor` 声明可着色的 `fill` / `stroke`，根节点的 `fill="none"` 必须保留（它防止未声明 fill 的路径被填成黑块）。圆角端点是 `DESIGN.md`「Icons: rounded caps and corners」的硬要求。

- [ ] **Step 2: 写失败测试（纯函数部分）**

`miniprogram/test/icons.spec.ts`：

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { extractFrontmatter } from '../tools/build-tokens';
import {
  COLOR_PLACEHOLDER,
  buildIconMap,
  normalizeSvg,
  paint,
  renderModule,
  toDataUri,
} from '../tools/build-icons';

const RAW = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">
  <!-- 注释应被删掉 -->
  <circle cx="12" cy="8" r="3" fill="currentColor"/>
  <path d="M5 19h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
</svg>`;

describe('normalizeSvg', () => {
  it('删掉注释并压成一行', () => {
    const out = normalizeSvg(RAW);
    expect(out).not.toContain('<!--');
    expect(out).not.toContain('\n');
  });

  it('把可着色的 fill / stroke 换成占位符', () => {
    const out = normalizeSvg(RAW);
    expect(out).toContain(`fill="${COLOR_PLACEHOLDER}"`);
    expect(out).toContain(`stroke="${COLOR_PLACEHOLDER}"`);
    expect(out).not.toContain('currentColor');
  });

  it('保留 fill="none"', () => {
    expect(normalizeSvg(RAW)).toContain('fill="none"');
  });

  it('不动 stroke-width 与 stroke-linecap', () => {
    const out = normalizeSvg(RAW);
    expect(out).toContain('stroke-width="2"');
    expect(out).toContain('stroke-linecap="round"');
  });
});

describe('paint 与 toDataUri', () => {
  it('paint 把所有占位符换成同一个色值', () => {
    const out = paint(normalizeSvg(RAW), '#944a07');
    expect(out).not.toContain(COLOR_PLACEHOLDER);
    expect(out.match(/#944a07/g)).toHaveLength(2);
  });

  it('toDataUri 产出可解码回原串的 base64 data URI', () => {
    const svg = '<svg/>';
    const uri = toDataUri(svg);
    expect(uri.startsWith('data:image/svg+xml;base64,')).toBe(true);
    expect(Buffer.from(uri.split(',')[1], 'base64').toString('utf8')).toBe(svg);
  });
});
```

- [ ] **Step 3: 追加建表与真实资产用例**

接在同一个测试文件末尾：

```ts
describe('buildIconMap', () => {
  const colors = { primary: '#944a07', 'on-surface': '#221a15' };

  it('为每个「图标 × 角色」组合生成一条 data URI', () => {
    const map = buildIconMap({ paw: RAW }, colors, ['primary', 'on-surface']);
    expect(Object.keys(map).sort()).toEqual(['paw:on-surface', 'paw:primary']);
    for (const uri of Object.values(map)) {
      expect(uri.startsWith('data:image/svg+xml;base64,')).toBe(true);
    }
  });

  it('角色在 DESIGN.md 里没有对应色值时直接抛错', () => {
    expect(() => buildIconMap({ paw: RAW }, colors, ['made-up'])).toThrow('made-up');
  });
});

describe('renderModule', () => {
  it('带禁止手改横幅，并导出 ICONS 与 IconKey', () => {
    const out = renderModule({ 'paw:primary': 'data:image/svg+xml;base64,AAA' });
    expect(out).toContain('请勿手改');
    expect(out).toContain('export const ICONS');
    expect(out).toContain('export type IconKey');
    expect(out).toContain("'paw:primary'");
  });
});

describe('真实资产', () => {
  const DESIGN_MD = resolve(__dirname, '../../stitch_/paws_paths/DESIGN.md');
  const ICON_DIR = resolve(__dirname, '../assets/icons');
  const colors = extractFrontmatter(readFileSync(DESIGN_MD, 'utf8')).colors as Record<
    string,
    string
  >;
  const svgs = Object.fromEntries(
    ['paw', 'place', 'person'].map((n) => [n, readFileSync(resolve(ICON_DIR, `${n}.svg`), 'utf8')]),
  );

  it('三个图标 × 四个角色 = 12 条，且色值来自 DESIGN.md', () => {
    const map = buildIconMap(svgs, colors, [
      'on-surface',
      'on-surface-variant',
      'primary',
      'on-primary',
    ]);
    expect(Object.keys(map)).toHaveLength(12);
    const decoded = Buffer.from(map['paw:primary'].split(',')[1], 'base64').toString('utf8');
    expect(decoded).toContain(colors.primary);
    expect(decoded).not.toContain('currentColor');
  });
});
```

- [ ] **Step 4: 运行测试确认失败**

```bash
npm test -w miniprogram -- icons
```

预期：FAIL，`Cannot find module '../tools/build-icons'`。

- [ ] **Step 5: 实现 build-icons.ts**

`miniprogram/tools/build-icons.ts`：

```ts
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { extractFrontmatter } from './build-tokens';

const DESIGN_MD = resolve(__dirname, '../../stitch_/paws_paths/DESIGN.md');
const ICON_DIR = resolve(__dirname, '../assets/icons');
const OUTPUT = resolve(__dirname, '../components/wf-icon/icons.ts');

/** 可着色的角色。加角色就在这里加，别在页面里写死颜色。 */
export const ROLES = ['on-surface', 'on-surface-variant', 'primary', 'on-primary'];

/** 编译期占位符：先把 currentColor 抽成它，再按角色逐一注入真实色值。 */
export const COLOR_PLACEHOLDER = '__COLOR__';

const HEADER = [
  '/**',
  ' * 本文件由 tools/build-icons.ts 自动生成，请勿手改。',
  ' * 来源：assets/icons/*.svg + stitch_/paws_paths/DESIGN.md 的色板。',
  ' * 增删图标或改色后跑 npm run build:icons -w miniprogram。',
  ' */',
].join('\n');

/** 压平空白、删注释，并把 currentColor 抽成占位符；fill="none" 必须原样保留。 */
export function normalizeSvg(svg: string): string {
  return svg
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s*\n\s*/g, ' ')
    .replace(/(fill|stroke)="(?!none")[^"]*"/g, `$1="${COLOR_PLACEHOLDER}"`)
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function paint(svg: string, color: string): string {
  return svg.split(COLOR_PLACEHOLDER).join(color);
}

export function toDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}

export function buildIconMap(
  svgs: Record<string, string>,
  colors: Record<string, string>,
  roles: string[],
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const [name, raw] of Object.entries(svgs)) {
    const normalized = normalizeSvg(raw);
    for (const role of roles) {
      const color = colors[role];
      if (!color) throw new Error(`DESIGN.md 色板里没有角色 ${role}`);
      map[`${name}:${role}`] = toDataUri(paint(normalized, color));
    }
  }
  return map;
}

export function renderModule(map: Record<string, string>): string {
  const entries = Object.keys(map)
    .sort()
    .map((key) => `  '${key}': '${map[key]}',`)
    .join('\n');
  return `${HEADER}\n\nexport const ICONS = {\n${entries}\n} as const;\n\nexport type IconKey = keyof typeof ICONS;\n`;
}

/** CLI 入口：扫 assets/icons，按 ROLES 逐一着色，写 components/wf-icon/icons.ts。 */
if (require.main === module) {
  const colors = extractFrontmatter(readFileSync(DESIGN_MD, 'utf8')).colors as Record<
    string,
    string
  >;
  const svgs = Object.fromEntries(
    readdirSync(ICON_DIR)
      .filter((f) => f.endsWith('.svg'))
      .sort()
      .map((f) => [f.replace(/\.svg$/, ''), readFileSync(join(ICON_DIR, f), 'utf8')]),
  );
  const module_ = renderModule(buildIconMap(svgs, colors, ROLES));
  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, module_, 'utf8');
  console.log(`icons.ts 已生成：${Object.keys(svgs).length} 个图标 × ${ROLES.length} 个角色`);
}
```

`(?!none")` 而不是 `(?!none)`：否则 `fill="nonesuch"` 这种值会被漏掉。这里的负向断言只放过精确的 `fill="none"`。

- [ ] **Step 6: 加 npm 脚本并生成 icons.ts**

`miniprogram/package.json` 的 `scripts` 里补两条（`build:tokens` 已在 Task 4 加过）：

```json
    "build:icons": "ts-node tools/build-icons.ts",
    "build:assets": "npm run build:tokens && npm run build:icons"
```

然后生成并检查：

```bash
npm run build:icons -w miniprogram
grep -c "data:image/svg+xml;base64," miniprogram/components/wf-icon/icons.ts
```

预期：脚本打印 `3 个图标 × 4 个角色`，`grep -c` 输出 `12`。

- [ ] **Step 7: 写 wf-icon 组件**

`miniprogram/components/wf-icon/index.json`：

```json
{
  "component": true
}
```

`miniprogram/components/wf-icon/index.wxml`：

```xml
<image class="wf-icon" src="{{src}}" mode="aspectFit" style="width: {{size}}; height: {{size}};" />
```

`miniprogram/components/wf-icon/index.wxss`：

```css
.wf-icon {
  display: block;
  flex-shrink: 0;
}
```

`miniprogram/components/wf-icon/index.ts`：

```ts
import { ICONS, type IconKey } from './icons';

Component({
  properties: {
    name: { type: String, value: '' },
    role: { type: String, value: 'on-surface' },
    size: { type: String, value: '48rpx' },
  },
  data: { src: '' },
  observers: {
    'name, role': function (name: string, role: string) {
      const key = `${name}:${role}` as IconKey;
      const src = ICONS[key];
      if (!src) {
        // 静默显示空白最难查，宁可在控制台吼一声。
        console.error(`wf-icon 找不到 ${key}，检查 assets/icons 与 build-icons 的 ROLES`);
      }
      this.setData({ src: src ?? '' });
    },
  },
});
```

组件本身依赖小程序运行时，Jest 里跑不了，它的渲染由阶段 1 的 `miniprogram-automator` 链路覆盖。这个任务的单测只保证「生成的 data URI 一定正确」——组件那点查表逻辑出错会当场肉眼可见。

- [ ] **Step 8: 运行测试确认通过**

```bash
npm test -w miniprogram
```

预期：PASS，64 个用例全绿。

- [ ] **Step 9: 提交**

```bash
git add miniprogram/assets/icons miniprogram/tools/build-icons.ts \
  miniprogram/components/wf-icon miniprogram/package.json miniprogram/test/icons.spec.ts
git commit -m "feat: compile svg icons into base64 data uri map"
```

---

### Task 16: 自定义 tabBar

**Files:**
- Modify: `miniprogram/tools/build-tokens.ts`（补 `--shadow-raised`）
- Modify: `miniprogram/test/build-tokens.spec.ts`（补一条断言）
- Create: `miniprogram/custom-tab-bar/tabs.ts`
- Create: `miniprogram/custom-tab-bar/index.ts|wxml|wxss|json`
- Create: `miniprogram/utils/tab-bar.ts`
- Modify: `miniprogram/pages/plaza/index.ts`、`pages/venue-list/index.ts`、`pages/profile/index.ts`
- Test: `miniprogram/test/tab-bar.spec.ts`

**Interfaces:**
- Consumes: `ICONS`（Task 15）、`findHexLiterals` / `findBarePx` / `findUndefinedVars`（Task 6 的 `tools/style-guard.ts`）、`app.json`
- Produces:
  - `TabItem { pagePath: string; text: string; icon: string }`、`TABS: TabItem[]`
  - `activeIndexFor(route: string): number`
  - `syncTabBar(page: WechatMiniprogram.Page.TrivialInstance): void`
  - `custom-tab-bar` 组件实例方法 `syncActive()`

原型的 tabBar 是「白底圆角胶囊 + 上方软阴影 + 当前项高亮」，原生 tabBar 做不出来，spec §5.2 因此要求 `custom-tab-bar`。阴影朝上，需要一个 y 为负的阴影 token，先把它加到编译器里，不在 wxss 里手写 `rgba()`。

- [ ] **Step 1: 补 --shadow-raised 的失败断言**

`miniprogram/test/build-tokens.spec.ts` 里，紧跟已有的阴影用例加一条：

```ts
  it('派生出朝上的阴影，供自定义 tabBar 用', () => {
    const css = compileTokens(SAMPLE_DARK_TEXT);
    expect(css).toContain('--shadow-raised: 0 -8rpx 40rpx rgba(34, 26, 21, 0.06);');
  });
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npm test -w miniprogram -- build-tokens
```

预期：FAIL，`--shadow-raised` 不在输出里。

- [ ] **Step 3: 让编译器产出 --shadow-raised**

`miniprogram/tools/build-tokens.ts` 里阴影那一段（Task 5 加的）补一行：

```ts
        lines.push(`  --shadow-raised: 0 -8rpx 40rpx rgba(${rgb}, 0.06);`);
```

放在 `--shadow-ambient` 与 `--shadow-pressed` 之间即可，顺序不影响正确性但保持三条挨在一起。然后重新生成：

```bash
npm run build:tokens -w miniprogram
grep -- '--shadow-raised' miniprogram/styles/tokens.wxss
```

- [ ] **Step 4: 写 tabBar 的失败测试**

`miniprogram/test/tab-bar.spec.ts`：

```ts
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ICONS } from '../components/wf-icon/icons';
import { TABS, activeIndexFor } from '../custom-tab-bar/tabs';
import { findBarePx, findHexLiterals, findUndefinedVars } from '../tools/style-guard';

const ROOT = resolve(__dirname, '..');
const app = JSON.parse(readFileSync(join(ROOT, 'app.json'), 'utf8')) as {
  tabBar: { list: { pagePath: string; text: string }[] };
};
const barCss = readFileSync(join(ROOT, 'custom-tab-bar/index.wxss'), 'utf8');
const tokensCss = readFileSync(join(ROOT, 'styles/tokens.wxss'), 'utf8');

describe('TABS', () => {
  it('与 app.json 的 tabBar.list 顺序和文案完全一致', () => {
    expect(TABS.map((t) => ({ pagePath: t.pagePath, text: t.text }))).toEqual(app.tabBar.list);
  });

  it('每个 tab 的图标都有激活与未激活两个角色', () => {
    for (const tab of TABS) {
      expect(ICONS).toHaveProperty(`${tab.icon}:primary`);
      expect(ICONS).toHaveProperty(`${tab.icon}:on-surface-variant`);
    }
  });
});

describe('activeIndexFor', () => {
  it('带前导斜杠与不带都能命中', () => {
    expect(activeIndexFor('pages/venue-list/index')).toBe(1);
    expect(activeIndexFor('/pages/venue-list/index')).toBe(1);
  });

  it('非 tab 页面返回 -1', () => {
    expect(activeIndexFor('pages/pet-detail/index')).toBe(-1);
    expect(activeIndexFor('')).toBe(-1);
  });
});

describe('custom-tab-bar 样式', () => {
  it('没有 hex 字面量', () => {
    expect(findHexLiterals(barCss)).toEqual([]);
  });

  it('没有裸 px', () => {
    expect(findBarePx(barCss)).toEqual([]);
  });

  it('引用的 token 全部有定义', () => {
    expect(findUndefinedVars(barCss, tokensCss)).toEqual([]);
  });
});
```

- [ ] **Step 5: 运行测试确认失败**

```bash
npm test -w miniprogram -- tab-bar
```

预期：FAIL，`Cannot find module '../custom-tab-bar/tabs'`。

- [ ] **Step 6: 写 tabs.ts**

`miniprogram/custom-tab-bar/tabs.ts`：

```ts
export interface TabItem {
  pagePath: string;
  text: string;
  icon: string;
}

/** 顺序、pagePath、text 必须与 app.json 的 tabBar.list 一致，测试会逐项比对。 */
export const TABS: TabItem[] = [
  { pagePath: 'pages/plaza/index', text: '广场', icon: 'paw' },
  { pagePath: 'pages/venue-list/index', text: '周边', icon: 'place' },
  { pagePath: 'pages/profile/index', text: '我的', icon: 'person' },
];

/** getCurrentPages 给的 route 不带前导斜杠，switchTab 的 url 要带，这里统一成不带。 */
export function activeIndexFor(route: string): number {
  const normalized = route.replace(/^\//, '');
  if (!normalized) return -1;
  return TABS.findIndex((t) => t.pagePath === normalized);
}
```

- [ ] **Step 7: 写组件的 wxss / wxml / json**

`miniprogram/custom-tab-bar/index.wxss`：

```css
.tab-bar {
  position: fixed;
  left: var(--space-md);
  right: var(--space-md);
  /* 底部再抬起一个安全区，Home 指示条不压住胶囊。 */
  bottom: calc(var(--space-sm) + env(safe-area-inset-bottom));
  display: flex;
  align-items: center;
  justify-content: space-around;
  padding: var(--space-sm);
  border-radius: var(--radius-full);
  background-color: var(--color-surface-container-lowest);
  box-shadow: var(--shadow-raised);
}

.tab {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-xs);
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-full);
  transition: background-color 0.2s ease-out;
}

/* 胶囊高亮：当前项套一层浅橙底。 */
.tab--active {
  background-color: var(--color-primary-fixed);
}

.tab__text {
  font-size: var(--font-label-md-size);
  line-height: var(--font-label-md-line);
  font-weight: var(--font-label-md-weight);
  letter-spacing: var(--font-label-md-spacing);
  color: var(--color-on-surface-variant);
}

.tab--active .tab__text {
  color: var(--color-primary);
}
```

`miniprogram/custom-tab-bar/index.wxml`：

```xml
<view class="tab-bar">
  <view
    class="tab {{active === index ? 'tab--active' : ''}}"
    wx:for="{{tabs}}"
    wx:key="pagePath"
    data-index="{{index}}"
    bindtap="onTap"
  >
    <wf-icon
      name="{{item.icon}}"
      role="{{active === index ? 'primary' : 'on-surface-variant'}}"
      size="44rpx"
    />
    <text class="tab__text">{{item.text}}</text>
  </view>
</view>
```

`miniprogram/custom-tab-bar/index.json`：

```json
{
  "component": true,
  "styleIsolation": "apply-shared",
  "usingComponents": {
    "wf-icon": "../components/wf-icon/index"
  }
}
```

`apply-shared` 让 `app.wxss` 里的 token 与语义类照常作用到组件内部，同时组件自己的样式不会漏出去污染页面。

- [ ] **Step 8: 写组件逻辑与页面接线**

`miniprogram/custom-tab-bar/index.ts`：

```ts
import { TABS, activeIndexFor } from './tabs';

Component({
  data: { tabs: TABS, active: 0 },
  attached() {
    this.syncActive();
  },
  methods: {
    /** 自定义 tabBar 实例不随 switchTab 重建，必须由页面 onShow 主动同步。 */
    syncActive(): void {
      const pages = getCurrentPages();
      const route = pages[pages.length - 1]?.route ?? '';
      const index = activeIndexFor(route);
      if (index >= 0 && index !== this.data.active) this.setData({ active: index });
    },

    onTap(e: WechatMiniprogram.TouchEvent): void {
      const index = Number(e.currentTarget.dataset.index);
      const target = TABS[index];
      if (!target || index === this.data.active) return;
      // 先改高亮再跳，避免等页面切换完才变色的迟滞感。
      this.setData({ active: index });
      wx.switchTab({ url: `/${target.pagePath}` });
    },
  },
});
```

`miniprogram/utils/tab-bar.ts`：

```ts
interface TabBarInstance {
  syncActive(): void;
}

/** 在每个 tab 页面的 onShow 里调用，保证高亮跟当前页一致。 */
export function syncTabBar(page: WechatMiniprogram.Page.TrivialInstance): void {
  const bar = page.getTabBar?.() as unknown as TabBarInstance | undefined;
  bar?.syncActive();
}
```

三个 tab 页面的 `index.ts` 改成（`pages/plaza/index.ts`、`pages/venue-list/index.ts`、`pages/profile/index.ts` 内容相同）：

```ts
import { syncTabBar } from '../../utils/tab-bar';

Page({
  data: {},
  onShow() {
    syncTabBar(this);
  },
});
```

`pages/pet-detail/index.ts` 与分包里的 13 个页面**不要**改，它们不是 tab 页，`getTabBar` 返回 undefined。

- [ ] **Step 9: 运行测试确认通过**

```bash
npm test -w miniprogram
```

预期：PASS，72 个用例全绿。

- [ ] **Step 10: 真机自检**

用开发者工具打开项目，切三次 tab，确认：胶囊高亮跟手、白底圆角贴合、阴影在胶囊上方、iPhone 模拟器下不被 Home 指示条压住。这一条是人工检查，不进 CI。

- [ ] **Step 11: 提交**

```bash
git add miniprogram/tools/build-tokens.ts miniprogram/styles/tokens.wxss \
  miniprogram/custom-tab-bar miniprogram/utils/tab-bar.ts miniprogram/pages \
  miniprogram/test/build-tokens.spec.ts miniprogram/test/tab-bar.spec.ts
git commit -m "feat: add custom tab bar with capsule highlight"
```

---

### Task 17: 体验版上传与 CI 流水线

**Files:**
- Create: `miniprogram/tools/upload-args.ts`
- Create: `miniprogram/tools/upload.ts`
- Modify: `miniprogram/package.json`（加 `upload` 脚本）
- Modify: `.gitignore`（私钥与 `.env`）
- Create: `.github/workflows/ci.yml`
- Test: `miniprogram/test/upload.spec.ts`

**Interfaces:**
- Consumes: 环境变量 `WX_APPID`、`WX_PRIVATE_KEY_PATH`、`GITHUB_REF_NAME`、`GITHUB_SHA`、可选 `UPLOAD_VERSION` / `UPLOAD_DESC` / `WX_CI_ROBOT`
- Produces:
  - `requireEnv(env: NodeJS.ProcessEnv, names: string[]): void`
  - `resolveVersion(env: NodeJS.ProcessEnv): string`
  - `resolveDesc(env: NodeJS.ProcessEnv, version: string): string`

spec §3.2 最后一行：体验版必须人工上传，用 `miniprogram-ci` 接进 CI。纯逻辑（版本号来源、环境变量校验）拆到 `upload-args.ts` 单测，`upload.ts` 只剩一层薄壳——这样测试不必 import `miniprogram-ci` 本体。

- [ ] **Step 1: 写失败测试**

`miniprogram/test/upload.spec.ts`：

```ts
import { requireEnv, resolveDesc, resolveVersion } from '../tools/upload-args';

describe('resolveVersion', () => {
  it('从 tag v1.2.3 取出 1.2.3', () => {
    expect(resolveVersion({ GITHUB_REF_NAME: 'v1.2.3' })).toBe('1.2.3');
  });

  it('UPLOAD_VERSION 优先于 tag', () => {
    expect(resolveVersion({ GITHUB_REF_NAME: 'v1.2.3', UPLOAD_VERSION: '9.9.9' })).toBe('9.9.9');
  });

  it('tag 不符合 vX.Y.Z 时抛错并说明格式', () => {
    expect(() => resolveVersion({ GITHUB_REF_NAME: 'release-1' })).toThrow('vX.Y.Z');
  });

  it('两者都没有时抛错', () => {
    expect(() => resolveVersion({})).toThrow('UPLOAD_VERSION');
  });
});

describe('requireEnv', () => {
  it('一次列出所有缺失变量', () => {
    expect(() => requireEnv({ WX_APPID: 'wx1' }, ['WX_APPID', 'WX_PRIVATE_KEY_PATH', 'FOO'])).toThrow(
      'WX_PRIVATE_KEY_PATH, FOO',
    );
  });

  it('齐全时不抛错', () => {
    expect(() => requireEnv({ A: '1', B: '2' }, ['A', 'B'])).not.toThrow();
  });
});

describe('resolveDesc', () => {
  it('默认带版本号与短 sha', () => {
    expect(resolveDesc({ GITHUB_SHA: 'abcdef1234567890' }, '1.2.3')).toBe('体验版 1.2.3 · abcdef1');
  });

  it('UPLOAD_DESC 覆盖默认文案', () => {
    expect(resolveDesc({ UPLOAD_DESC: '手动补包' }, '1.2.3')).toBe('手动补包');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npm test -w miniprogram -- upload
```

预期：FAIL，`Cannot find module '../tools/upload-args'`。

- [ ] **Step 3: 实现 upload-args.ts**

`miniprogram/tools/upload-args.ts`：

```ts
const TAG_PATTERN = /^v(\d+\.\d+\.\d+)$/;

/** 缺哪些一次说清，别让人跑一次补一个。 */
export function requireEnv(env: NodeJS.ProcessEnv, names: string[]): void {
  const missing = names.filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new Error(`缺少环境变量：${missing.join(', ')}`);
  }
}

/** 版本号只允许来自 git tag 或显式覆盖，禁止读 package.json——那个会忘记改。 */
export function resolveVersion(env: NodeJS.ProcessEnv): string {
  if (env.UPLOAD_VERSION) return env.UPLOAD_VERSION;
  const ref = env.GITHUB_REF_NAME;
  if (!ref) {
    throw new Error('没有 tag，也没给 UPLOAD_VERSION，无法确定体验版版本号');
  }
  const matched = TAG_PATTERN.exec(ref);
  if (!matched) {
    throw new Error(`tag ${ref} 不符合 vX.Y.Z 格式`);
  }
  return matched[1];
}

export function resolveDesc(env: NodeJS.ProcessEnv, version: string): string {
  if (env.UPLOAD_DESC) return env.UPLOAD_DESC;
  const sha = (env.GITHUB_SHA ?? 'local').slice(0, 7);
  return `体验版 ${version} · ${sha}`;
}
```

- [ ] **Step 4: 实现 upload.ts**

`miniprogram/tools/upload.ts`：

```ts
import { resolve } from 'node:path';
import ci from 'miniprogram-ci';
import { requireEnv, resolveDesc, resolveVersion } from './upload-args';

/** project.config.json 在仓库根，不在 miniprogram/ 里。 */
const PROJECT_PATH = resolve(__dirname, '../..');

async function main(): Promise<void> {
  const env = process.env;
  requireEnv(env, ['WX_APPID', 'WX_PRIVATE_KEY_PATH']);
  const version = resolveVersion(env);

  const project = new ci.Project({
    appid: env.WX_APPID as string,
    type: 'miniProgram',
    projectPath: PROJECT_PATH,
    privateKeyPath: resolve(env.WX_PRIVATE_KEY_PATH as string),
    ignores: ['node_modules/**/*'],
  });

  const result = await ci.upload({
    project,
    version,
    desc: resolveDesc(env, version),
    // es6 关掉：源码已由 tsc/开发者工具编译，重复转换只会拖慢构建。
    setting: { es6: false, minify: true },
    robot: Number(env.WX_CI_ROBOT ?? 1),
  });

  console.log(`已上传体验版 ${version}`);
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main().catch((err: Error) => {
    console.error(err.message);
    process.exit(1);
  });
}
```

`miniprogram/package.json` 的 `scripts` 补一条（`miniprogram-ci` 已在 Task 4 的 `devDependencies` 里锁好 `1.9.11`，不用再加）：

```json
    "upload": "ts-node tools/upload.ts"
```

- [ ] **Step 5: 收紧 .gitignore**

`.gitignore` 追加（私钥与密钥文件永远不进仓库）：

```gitignore
# 微信上传私钥，只从 CI Secret 注入
private.key
private.*.key

# 环境变量真值
.env
.env.*
!.env.example
```

- [ ] **Step 6: 写 CI 流水线**

`.github/workflows/ci.yml`：

```yaml
name: ci

on:
  push:
    branches: [main]
    tags: ['v*']
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: npm
      - run: npm ci
      - run: npm run build -w @paws/types

      # 生成物必须与源保持一致：漂了就当场失败，别等真机上发现颜色不对。
      - name: 检查生成物是否过期
        run: |
          npm run build:assets -w miniprogram
          npm run sync:types
          git diff --exit-code \
            miniprogram/styles/tokens.wxss \
            miniprogram/components/wf-icon/icons.ts \
            miniprogram/shared

      - run: npm test -w @paws/types
      - run: npm test -w server
      - run: npm test -w miniprogram

  upload:
    needs: test
    if: startsWith(github.ref, 'refs/tags/v')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: npm
      - run: npm ci
      - run: npm run sync:types

      - name: 写入上传私钥
        run: printf '%s' "${{ secrets.WX_PRIVATE_KEY }}" > private.key

      - name: 上传体验版
        run: npm run upload -w miniprogram
        env:
          WX_APPID: ${{ secrets.WX_APPID }}
          WX_PRIVATE_KEY_PATH: private.key
          GITHUB_REF_NAME: ${{ github.ref_name }}
          GITHUB_SHA: ${{ github.sha }}

      - name: 清理私钥
        if: always()
        run: rm -f private.key
```

两点必须交代给运维：

- `WX_PRIVATE_KEY` 与 `WX_APPID` 存 GitHub Secrets。私钥在小程序后台「开发管理 → 开发设置 → 小程序代码上传密钥」生成，同时要把 GitHub Actions 的出口 IP 加进白名单，否则 `ci.upload` 报 IP 不在白名单。
- 预览二维码由 `ci.preview` 产出，需要落地成构建产物才有意义；阶段 0 只做上传，二维码在开发者工具里扫版本管理页即可。真要 CI 出码，等阶段 1 有可演示页面时再加。

- [ ] **Step 7: 运行全部测试确认通过**

```bash
npm run build -w @paws/types
npm test -w @paws/types
npm test -w server
npm test -w miniprogram
```

预期：三个 workspace 全绿，miniprogram 80 个用例。

- [ ] **Step 8: 提交**

```bash
git add miniprogram/tools/upload-args.ts miniprogram/tools/upload.ts \
  miniprogram/package.json miniprogram/test/upload.spec.ts .gitignore \
  .github/workflows/ci.yml
git commit -m "ci: add test pipeline and trial upload"
```

---

## 阶段 0 完成判定

全部 17 个任务做完后，逐条自检：

1. `npm ci && npm test -w @paws/types && npm test -w server && npm test -w miniprogram` 全绿。
2. 开发者工具能打开项目，三个 tab 可切换，胶囊高亮正确，安全区不被压。
3. 改 `stitch_/paws_paths/DESIGN.md` 里任一色值 → 跑 `npm run build:assets -w miniprogram` → `tokens.wxss` 与 `icons.ts` 同步变化，CI 的漂移检查在忘记提交生成物时会失败。
4. 起 Redis 后 `npm run start:dev -w server`，`GET /health` 返回 `{ "code": 0, "message": "ok", "data": { "status": "up" } }`。
5. 打一个 `v0.1.0` tag，CI 的 `upload` job 能把体验版推上去。

达成后即可开工阶段 1（浏览闭环），届时新建 `docs/superpowers/plans/<日期>-phase1-browse.md`。
































































