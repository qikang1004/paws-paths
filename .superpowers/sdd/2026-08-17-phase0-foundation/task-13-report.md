# Task 13 报告：位置单点持有与城市模式降级

## 结果

实现 `LocationStore`，统一通过 `WxAdapter.getLocation()` 获取位置；定位成功进入精确模式并缓存坐标，定位失败/拒绝安全降级为城市模式并缓存结果，不阻断业务，也不会在并发或后续 `ensure()` 中重复弹授权框；`reset()` 后允许重新申请。

页面未新增任何直接的 `wx.getLocation` 调用。适配层是小程序侧唯一直接调用入口。

## RED

1. 按简报先创建 `miniprogram/test/location.spec.ts`，未实现生产代码。
2. 首次运行 `npm test -w miniprogram -- location` 因 worktree 尚无 `node_modules`，命令先报 `jest` 不存在。
3. 使用锁定的 `package-lock.json` 从 npm 官方源执行 `npm ci --registry=https://registry.npmjs.org` 后重跑，Jest 编译阶段按预期失败：缺少 `../store/location`、`FakeWx.getLocationCalls` 和 `FakeWx.locationOutcome`，共 0 个测试执行。

## GREEN

新增并验证以下最小行为：

- `WxAdapter.getLocation()` 使用 `gcj02`，并只返回纬度/经度。
- `FakeWx` 提供定位调用计数和成功/错误结果桩。
- `LocationStore.ensure()` 共享并发中的同一个 Promise。
- 精确结果和城市降级结果均缓存；失败不抛出。
- `reset()` 清除缓存，允许再次申请。
- 导出全局 `locationStore` 单例供页面统一使用。

目标测试：`npm test -w miniprogram -- location`，6/6 通过。

## 完整验证

- `npm test -w miniprogram`：6 个测试套件、48 个用例全部通过。
- `npx tsc -p miniprogram/tsconfig.json --noEmit`：通过。
- `git diff --check`：通过。
- `wx.getLocation` 扫描结果：直接全局调用仅位于 `miniprogram/api/wx-promise.ts` 适配器；store 通过注入的 `WxAdapter` 调用，测试中的其余命中均为断言/桩字段。

## 提交

- 基线：已执行 `git merge --no-edit phase0-impl`，快进纳入 `eac26c2`。
- 实现提交：`7954a48`，提交信息为 `feat: hold location in a single store with city fallback`。

## 遗留疑虑

- 简报写明完整测试预期为 47 个用例；当前基线加上本任务后实际为 48 个用例（本任务新增 6 个），未发现失败或缺失测试，推测简报中的总数未随基线更新。
- 适配器注释要求小程序 `app.json` 声明 `requiredPrivateInfos`；本任务文件范围明确不包含 `app.json`，因此未越界修改。接入真实页面前需由对应任务确认该声明及定位权限产品配置。
- `npm ci` 输出依赖树存在既有审计告警；按约束未执行 `npm audit fix`，也未引入计划外依赖。
