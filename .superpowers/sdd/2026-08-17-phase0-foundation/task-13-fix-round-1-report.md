# Task 13 修复轮 1 报告：reset 期间定位请求竞态

## 问题

审查发现 `LocationStore.reset()` 仅清除 `current`，没有失效进行中的定位请求。于是 reset 后紧接 `ensure()` 会复用旧请求 A；即使启动了新请求，旧请求完成后也可能覆盖新状态。

## 基线同步

从当前 Task 13 worktree 执行：

```bash
git merge --no-edit phase0-impl
```

已同步 `phase0-impl` 当前基线；其已包含原 Task 13 功能提交，无冲突。

## RED

先在 `miniprogram/test/location.spec.ts` 添加可控 deferred 定位测试：

1. 请求 A 开始但不完成。
2. 调用 `reset()`。
3. 紧接调用 `ensure()`，要求启动请求 B。
4. B 先完成并写入精确坐标。
5. A 后完成，不能覆盖 B 的 `store.state`。

运行：

```bash
npm test -w miniprogram -- location
```

测试按预期失败：第二次定位调用数期望为 2，实际为 1，证明 reset 后复用了旧 inflight 请求。

## GREEN

采用最小代际失效方案：

- `LocationStore` 增加 `generation`。
- 每次 `reset()` 递增 generation，并清除 `current` 与 `inflight`。
- 每次定位请求捕获启动时 generation。
- 请求完成后只在 generation 仍匹配时写入 `current`。
- 旧请求仍返回自己的结果，且通过已有 `.then(release, release)` 安全释放引用，不产生未处理 rejection。
- 未 reset 的普通并发 `ensure()` 仍共享同一个 inflight 请求。

目标测试：6/6 通过。

## 完整验证

- `npm test -w miniprogram`：6 个测试套件、48 个用例全部通过。
- `npx tsc -p miniprogram/tsconfig.json --noEmit`：通过。
- `git diff --check`：通过。

## 提交

- 修复提交：`fix: invalidate stale location requests on reset`（最终提交哈希见交付回传）。

## 遗留疑虑

- 修复仅涉及 `LocationStore` 及其竞态测试，没有修改页面或引入后续业务。
- 旧请求在 reset 后仍会完成并返回给原调用方；需求只要求其不得写回当前 store 状态，这一行为保持兼容且避免悬挂 promise。
- 简报中的完整测试预期为 47 个；当前基线实际为 48 个，全部通过。
