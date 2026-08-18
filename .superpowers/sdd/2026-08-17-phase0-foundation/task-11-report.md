# Phase 0 Task 11 Report: 微信 Promise Adapter 与 SessionStore

## 范围

实现了 `WxAdapter` 对微信原生 API 的 Promise 化封装、统一的 `ApiError`，以及注入适配器的 `SessionStore`。会话 token 由 `SessionStore` 通过同步存储单点持有；并发 `refresh()` 复用同一个飞行中 Promise。未实现 Task 12 的统一请求层、重试或 HTTP 状态码策略。

## RED

先创建了：

- `miniprogram/test/fake-wx.ts`
- `miniprogram/test/session.spec.ts`

在生产模块尚未创建时运行：

```bash
npm test -w miniprogram -- session
```

结果：失败，符合预期。TypeScript 报告找不到 `../api/errors` 和 `../store/session`。

## GREEN

随后以最小实现创建：

- `miniprogram/api/errors.ts`
- `miniprogram/api/wx-promise.ts`
- `miniprogram/store/session.ts`

定向会话测试通过，覆盖：

1. 从 storage 读取 token 时不触发 `wx.login`。
2. 成功刷新后将 token 写入 storage，且请求发送微信登录 code。
3. 五个并发刷新只触发一次 `wx.login`。
4. 非零业务码转换为 `ApiError` 且不写入 token。
5. 失败释放飞行中 Promise，后续刷新可以重试。
6. `clear()` 删除 token。

## 验证

依赖安装：

```bash
npm ci --registry=https://registry.npmjs.org
```

完整检查：

```bash
npm test -w miniprogram
npx tsc -p miniprogram/tsconfig.json --noEmit
git diff --check
```

结果：

- Jest：4 个测试套件、35 个测试均通过。
- TypeScript：通过，无诊断输出。
- `git diff --check`：通过，无空白错误。

简报中的 34 个用例预期与当前合并基线不一致：基线有 29 个用例，本任务新增 6 个，合计为 35 个。

## 提交

提交信息：`feat: hold miniprogram session in a single store`

## 疑虑

- `npm ci` 报告了锁定的既有依赖弃用与审计告警；按任务约束，没有执行 `npm audit fix`、没有升级或新增依赖。
- `WxAdapter` 仅收口本任务用到的原生 API。页面尚未存在，也未在页面中引入 `wx.*`；后续调用方应仅依赖该适配器或后续 Task 12 请求层。
