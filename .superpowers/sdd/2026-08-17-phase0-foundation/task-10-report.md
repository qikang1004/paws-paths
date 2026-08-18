# Phase 0 Task 10 报告：微信登录接口

## 实现范围

- 新增 `POST /auth/wx-login`，接收 `{ code: string }`，由既有全局响应拦截器包装为 `{ code, message, data }`。
- 新增 `WechatApiService`：
  - `code2Session(code)` 调用微信 `jscode2session`，返回 `openid` 与临时 `sessionKey`；阶段 0 不持久化 `sessionKey`。
  - `fetchAccessToken()` 实现 Task 9 的 `AccessTokenFetcher`；业务登录逻辑未直接调用 access-token API。
  - 上游 HTTP 错误及微信异常响应记录在服务端日志中，客户端统一收到 `50201` 和中文文案，不泄露微信 `errcode` 或 `errmsg`。
- 新增 `UserRepository` 接口和 `InMemoryUserRepository`，按 openid 查询或建号；用户记录包含 UUID、openid、空昵称/头像及创建时间。
- 新增 `UsersService.upsertByOpenid(openid)`，同一 openid 复用用户 ID。
- 新增 `AuthService` 和 `AuthController`：校验 code、调用 `code2Session`、upsert 用户，并以 `JWT_SECRET` 签发带 `sub`、`openid` 和过期时间的 JWT。
- 新增微信、用户、认证模块，并在 `AppModule` 中导入认证模块。

## RED / GREEN

### RED

新增 `server/test/auth-login.spec.ts` 后执行：

```text
npm test -w server -- auth-login
FAIL test/auth-login.spec.ts
TS2307: Cannot find module '../src/wechat/wechat-api.service'
```

失败原因符合预期：登录所依赖的 `WechatApiService` 尚不存在。

### GREEN

实施最小模块、服务与路由后执行：

```text
npm test -w server -- auth-login
PASS test/auth-login.spec.ts
Test Suites: 1 passed, 1 total
Tests: 5 passed, 5 total
```

覆盖新 openid 建号和 JWT 验签、同 openid 幂等登录、不同 openid 独立用户、缺少 code 的 `42200`，以及上游异常收敛为 `50201` / `微信服务暂时不可用`。

## 实际测试与构建摘要

- `npm ci --registry=https://registry.npmjs.org`：成功安装 `package-lock.json` 锁定依赖；未执行 `npm audit fix`。npm 提示锁定依赖树中已有弃用项和 76 个漏洞。
- `npm test -w server`：通过，3 个套件、16 个用例。`envelope.spec.ts` 的预期异常路径输出一条 Nest ERROR 日志，但测试通过。
- `npm run build -w @paws/types && npm run build -w server`：通过。server 独立构建前需先生成工作区 `@paws/types/dist` 声明文件；这与该包的 `types: dist/index.d.ts` 配置一致。
- `git diff --check`：通过，无输出。

## 提交

```text
27a862c feat: add wechat login endpoint issuing jwt
```

## 疑虑 / 后续项

- 阶段 0 用户仓储为进程内内存实现；服务重启会丢失映射。阶段 1 需以 PostgreSQL/PostGIS provider 替换，保持 `UserRepository` 接口不变。
- `session_key` 按任务约束获取后立即丢弃；后续支持手机号解密时需设计安全存储和轮换方案。
- `WechatApiService` 使用运行环境的全局 `fetch`；当前 Node 运行环境与 TypeScript 配置均支持。微信正式 AppID、密钥及 JWT 密钥未写入仓库。
