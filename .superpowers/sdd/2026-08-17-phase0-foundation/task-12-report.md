# Task 12 Report: 统一请求层与 401 静默重登

## 范围

按 `task-12-brief.md` 实现以下文件，未改动页面或后续位置模块：

- `miniprogram/config.ts`
- `miniprogram/api/request.ts`
- `miniprogram/api/client.ts`
- `miniprogram/test/request.spec.ts`

请求统一由 `ApiClient` 经 `WxAdapter` 发送；页面的公开唯一入口为 `api/client.ts` 导出的 `api` 与 `session`。业务响应按共享 API envelope 处理，失败统一抛出 `ApiError`，服务端文案优先，缺失时回落至 `messageForCode`。

## RED

先新增 `miniprogram/test/request.spec.ts` 的 7 个用例，覆盖：

1. 无 token 时登录后再发送业务请求。
2. 已有 token 时注入 `Authorization`，且不重复登录。
3. POST 请求原样传递 method 与 data。
4. 首次 401 时静默重新登录并重放原请求。
5. 重放后继续 401 时仅重试一次，并抛出 `ApiError`。
6. 业务错误优先展示服务端文案。
7. 无服务端文案时按本地错误码表回退。

执行：

```bash
npm test -w miniprogram -- request
```

结果：失败，符合预期。错误为 `TS2307: Cannot find module '../api/request'`。

## GREEN

实现 `ApiClient.call<T>`：

- 读取已有 token；缺失时通过 `SessionStore.refresh()` 登录。
- 请求自动添加 `Authorization: Bearer <token>` 与 JSON content type。
- HTTP 401 或业务码 `ERROR_CODES.UNAUTHORIZED` 时清理 token、静默刷新并只重放原请求一次。
- 第二次响应（包括继续 401）不再重登；非成功 envelope 统一抛出带脱敏中文消息的 `ApiError`。
- `config.ts` 仅含简报指定的示例 HTTPS 域名，未写入 AppID、密钥或环境变量真值。

## 验证

```bash
npm test -w miniprogram -- request
npm test -w miniprogram
npx tsc --noEmit -p miniprogram/tsconfig.json
git diff --check
```

结果：

- 请求层测试：1 个套件、7 个用例通过。
- 完整小程序测试：5 个套件、42 个用例通过。
- TypeScript 校验通过。
- `git diff --check` 通过。
- 对 `miniprogram` 搜索 `wx.request`：原生调用只位于 `api/wx-promise.ts` 适配器；请求层和会话层依赖 `WxAdapter`，无页面直接调用。

## 提交

待在本任务 worktree 提交：

```text
feat: add unified request layer with silent relogin
```

## 疑虑

- 简报第 7 步的预期总数为 41 个用例；当前基线已有 35 个用例，新增 7 个后实际为 42 个，全部通过。
- `npm ci` 仅输出锁定依赖的上游弃用警告；未运行 `npm audit fix`，未新增依赖。
