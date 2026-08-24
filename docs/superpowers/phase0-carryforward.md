# 阶段 0 遗留项交接（Phase 0 Carry-Forward）

阶段 0 全分支最终审查判定「可合并、无 Critical」。以下是审查明确裁定**不在阶段 0 范围**、
需带入后续阶段的工程项，以及接受为已知限制的部分。上线前的运维与合规必办项不在此文件，
见仓库根 `RELEASE_CHECKLIST.md`。

## 阶段 1 开工前应闭合

- [x] **`style-guard.ts` 的 `findUndefinedVars` 选择器盲**（`miniprogram/tools/style-guard.ts:17-26`）。
  它把自定义属性名收成一个扁平集合，不建模 CSS 作用域，所以「token 声明在 `page {}` 下、
  组件却渲染在 page 子树之外」这类缺陷检测不出来。`custom-tab-bar` 目前靠 `test/tab-bar.spec.ts`
  的七条断言手工兜住，但未来任何 page 外组件（如自定义导航栏）会假绿并静默无样式。
  写第一个 page 外组件之前应改为选择器感知的检查。
  根因在阶段 0 计划自身对 `styleIsolation: apply-shared` 的论证
  （`docs/superpowers/plans/2026-08-17-phase0-foundation.md:4100`）——隔离模式只影响选择器匹配，
  不创造 DOM 继承。实现已按正确语义修正为 `page, .token-scope`，但计划原文的错误结论仍在。
  **已闭合**：`style-guard.ts` 新增 `parseTokenScopes` + `findTokensInaccessibleOutsidePage`，
  `OUTSIDE_PAGE_SLOTS = ['custom-tab-bar', 'custom-navigation-bar']` 进入 readdir 遍历网内；
  以后新增任何 page 外组件目录会自动被扫描。`test/style-guard.spec.ts` 补 12 条断言
  （含反向证明与真实 custom-tab-bar 样式回归）。

- [x] **`WechatApiService.fetchAccessToken` 可绕过 Redis 单点缓存**。该方法是 public 且经
  `server/src/wechat/wechat.module.ts:13` export，业务代码可直接注入它、跳过缓存与分布式锁，
  违反「`access_token` 只允许通过 Redis 单点缓存获取」这条 Global Constraint。收口需调整 DI 边界。
  **已闭合**：`WechatModule` 不再 export `WechatApiService` 本体，改为只 export
  `AccessTokenService`（Redis 单点缓存唯一出口）与收窄的 `WECHAT_SESSION_API` 令牌
  （只含 `code2Session`）。`AuthService` 改注入令牌。`test/wechat-module.spec.ts` 用
  `get(WechatApiService, { strict: true })` 断言业务代码注入不到本体（`strict: true`
  才是消费方模块的注入语义；默认 `strict: false` 会翻整个容器，测不出边界）。

- [x] **`RedisTokenStore` 的真实 Lua 脚本从未被测**。现有测试只用 `FakeTokenStore` 镜像语义，
  compare-and-delete 的实际 Redis 行为无覆盖。需要一个跑真 Redis 的集成测试。
  **已闭合**：`test/redis-token-store.integration.spec.ts` 跑真 Redis，覆盖 wrong-owner
  不释放、正确 owner 释放、TTL 过期、setWithTtl/get。`REDIS_INTEGRATION=1` 显式门控，
  无 Redis 环境优雅跳过。本机验证需起 Redis：`docker run -d -p 6379:6379 redis:7-alpine`。

- [x] **登录端点无限流**。`POST /auth/login` 直接暴露，缺速率限制。
  **已闭合**：新增 `common/rate-limit/`（`RateLimiterService` + `RedisRateLimitStore`，
  与 TokenStore 同款懒连接），`LoginRateLimitGuard` 按客户端 IP 固定窗口计数，挂在
  `POST /auth/wx-login`。默认 60s/30 次，可用 `LOGIN_RATE_WINDOW_SECONDS` /
  `LOGIN_RATE_MAX_ATTEMPTS` 覆盖。超限 429 + `RATE_LIMITED`，走统一包络。

## 接受为已知限制

- **上传日志脱敏依赖内部路径** `miniprogram-ci/dist/utils/log`，依赖已锁 1.9.11。
  取不到该路径时降级为只补 console（不中断上传），但 log 通道会重新暴露。升级依赖时须复查。
- **两条进程内无法闭合的泄漏路径**：`worker_manager.js` 未给 worker 设 stderr，worker stderr
  直连父进程；`dist/utils/report.js` 把错误 message 前 512 字符 POST 到 `servicewechat.com`。
  均属库行为，本地脱敏无效。
- **info 通道对无标签内容是尽力而为**：`core/utils/jsonParse.js` 的 `jsonRespParse` 在 JSON
  解析失败时经 `log.info` 转储原始响应体；若该响应体畸形且无 errcode/errmsg 标签，正则无从识别。
  真正的接口错误码走 error 通道，由 `hasErrField` 的 fail-closed 判定拦住。
- **`wx-guard` 是 lint 级强度**：只认字面直呼 `wx.request` / `wx.getLocation`，绕不过
  `wx['request']`、解构、别名、`globalThis.wx.request`。兜住这些需类型层面的引用分析。
- **`--radius-full: 19998rpx`** 不是 bug：源值 `9999px` 经 `1px = 2rpx` 单次换算而来，
  pill 形状语义正确。已核实，不再重开。

- [x] **Redis 不可用时登录端点返回 500**（阶段 1 演示时暴露）。`LoginRateLimitGuard` →
  `RedisRateLimitStore.increment` 没有 try/catch：Redis 缺失（ECONNREFUSED）或存在但需密码
  （NOAUTH）都会抛出，经统一异常层变成 `50000 服务异常`。
  **已闭合**：用户决策 fail-open（降级放行 + ERROR 日志告警）。实现的重点不只是 try/catch ——
  ioredis 默认重试 20 次，实测宕机时 `incr` 要 10.7s 才抛错，降级放行会变成挂死 10 秒；
  连接参数已抽到 `common/redis-client.ts` 收紧到亚秒级，三处 Redis 客户端共用。
  `RedisPoiCache` 的「不阻断主链路」和 `RedisTokenStore` 的 access_token 单点缓存同源受益。
  端到端已验双向：宕机时登录 `code: 0` + 日志留痕，健康时第 31 次请求 `429/42900`。
  完整决策记录、对照数据与 `enableOfflineQueue: false` 为何不可用，见
  `phase1-notes.md`「六、Redis 故障降级决策」。

## 待实机验证

- [ ] 在微信开发者工具确认 `page, .token-scope` 真的把自定义属性交付到框架级 tabBar 节点
  （胶囊圆角、上向阴影、左右内缩）。阶段 0 只做了结构性验证。
- [ ] 确认 `project.config.json` 的 `setting.useCompilerPlugins: ["typescript"]` 与
  `miniprogram/tsconfig.json` 的 `noEmit: true` 是否冲突。若开发者工具尊重 `noEmit` 而不产出 JS，
  需另加一份面向工具的 tsconfig 开启 emit，类型检查路径保留 `noEmit`。
