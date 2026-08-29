# types
  cd /d/tmp/test/packages/types && npx jest

  # 全仓构建
  cd /d/tmp/test && npm run build
  ```

  两个坑：

  1. **`REDIS_INTEGRATION=1` 是跑测开关不是配置值**，所以不在 `.env` 里。漏了它会有 3 套静默跳过，
     看着像全绿其实少跑 18 例。
  2. **`.env` 用 `set -a && . ./.env && set +a` 加载**，加载进环境但不打印任何值。别用会回显的写法。

  `server/test/global-setup.ts` 全局跑迁移，且**连跑两遍**——这就是「迁移幂等」的证据，
  不要在用例里再跑一次 `runMigrations`（`schema.sql` 的 DDL 要 ACCESS EXCLUSIVE 锁，
  并行邻居套件正在同几张表上开事务，两边等成环，真 deadlock 过）。

  ---

  ## 三、Task 4 的关键点

  举报端点有七组断言，计划里写全了。最容易做错的一条：

  **先按「这个人能不能看见这条动态」判 404，再判状态机。** 顺序反了，举报一条 `pending` 动态会因为
  `assertTransition` 抛出而变成 422，把「这条 id 存在但状态不是 approved」泄露给探测者
  （Global Constraint 26）。举报 `pending` / `rejected` / 不存在的 id / 别人看不见的动态，
  四种情况响应必须**一字不差**。

  合法但已被举报过的（`pending_review`）走**幂等分支返回 200**，不是 404——那条内容对举报人已经
  不可见了，但他刚刚举报的动作是成功的。

  状态迁移 + 写流水 + 入队三件事在**一条 CTE 语句**里完成（数据修改型 CTE 的子语句保证各执行一次、
  执行到底，不必开事务；分三次往返的话中间崩掉会留下「状态改了但没工单」的半截状态）。
  内存实现按顺序做三步。

  `AuditLogRepository.append(entry, client?)` 和 `listByTarget(type, id, client?)` 都接可选的
  `PoolClient`，就是为了让调用方把它塞进自己的事务。

  ---

  ## 四、几条贯穿全局的架构约束（不可违反）

  1. **审核状态机唯一实现点是 `packages/types/src/audit.ts`**。状态迁移一律经 `assertTransition`，
     禁止手写状态字面量比较（`server/test/audit-literal-guard.spec.ts` 守着）。
     四个状态：`pending` / `approved` / `pending_review` / `rejected`。
  2. **未 `approved` 的内容对他人不可见**。可见性判定走 `isVisibleTo(status, isAuthor)`。
  3. **可见性过滤必须写在 SQL 的 `WHERE` 里**，绝不 post-filter 一页——筛在 `LIMIT` 之后会把分页算坏。
  4. **迁移只增不改**（`favorites` 多态化是唯一的有意例外，已记在 phase2-notes）。
  5. **审核动作全量写 `audit_log`，无例外**，且改状态与写流水必须原子。
  6. **`moderation_tasks` 是队列，`audit_log` 是不可变流水，不可互相替代**（spec §4.4 原话）。
     工单可被更新，流水只追加、永不 UPDATE/DELETE。
  7. **内容安全 fail-closed**（宁可拒发也不放过未审内容），与限流的 fail-open 相反。
  8. **角色从库里读，不读令牌里的声明**。JWT 是阶段 0 签的，里面没有角色；塞进去会让
     「撤销运营权限」要等到令牌过期才生效。
  9. **共享类型是生成的，不是符号链接**：改完 `packages/types` 要跑 `npm run sync:types`，
     手改 `miniprogram/shared/types/` 会被 sync-types 守卫抓住。
  10. **双仓储绑定模式**：默认 InMemory 实现，存在 `DATABASE_URL` 时换 Postgres 实现
      （`useFactory` + `inject: [PG_POOL]`）。两个实现要有同一组双跑契约测试。

  ---

  ## 五、工作方式（硬要求）

  - 计划放 `docs/superpowers/plans/YYYY-MM-DD-<phase>.md`，**按任务逐个执行，每步勾选复选框**。
    **RED 先写测试并确认它真的红，GREEN 才写实现。**
  - 每阶段末写 `docs/superpowers/phase<N>-notes.md`，必须含：自动化回归结果表、真库真 Redis 的
    实际 HTTP 走查记录、暴露的限制、**与计划的所有有意偏差**、留给下一阶段的清单。
  - 提交按任务粒度，中文提交信息，前缀 `feat/fix/test/docs/chore`。
  - **只在明确要求时提交。不许 `git add -A`**（曾因此扫进 30 个嵌套仓库和一个 5MB 压缩包）。
    **不许 `--amend` 已推送的提交。**
  - 改完代码要跑构建和相关测试再报结果。**测试红了就说红了并贴输出，别声称通过。**
  - **测试断言不许写死全表行数**（这个坑踩过两次，`48fab02` 与 `9475fdf`）。远程库是共享的，
    并行邻居套件在建自己的数据。只数种子前缀行（如 `WHERE id ~ '^p-[0-9]+$'`）。
  - 要「插入成功」才能验的断言，用 `postgres.integration.spec.ts` 里的 `inRollback` 助手
    在事务里跑再回滚——库是共享的远程实例，留下的行会让走查数不清。

  ---

  ## 六、凭据纪律（硬约束）

  数据库/Redis 是远程实例，口令只在 `server/.env` 里。
  **任何真值都不许写进仓库文件、不许 echo 到终端输出、不许写进文档或提交信息。**

  - `FAKE_WECHAT_LOGIN=1` 和 `FAKE_CONTENT_SECURITY=1` 都是绕过开关，部署环境必须关掉。
  - **绝不执行 `npm audit fix`。**
  - `stitch_.zip` 故意不跟踪，别提交它，也别加进 `.gitignore`。
  - `.claude/worktrees/` 下有 30 个 `worktree-agent-*` 分支，是**阶段 0 遗留的宿主托管工作树**，
    不归 Git 工作流管。别清理、别提议整理分支。

  ---

  ## 七、未闭合的账（都已记录，别当成新发现重复报告）

  1. **`phone_enc` / `pgcrypto` 从未实现** —— 没有列、没有扩展、没有加密代码，三份 notes 都没记，
     却是「不可违反的架构约束」第 7 条，且阶段 4 的完成标志是「敏感信息合规完成」。
  2. **`pet_photos` 没有 `audit_status` 列，宠物照片上传不过机审** —— spec §4.1/§4.5 声称有。
     `PetsService.addPhoto` 里没有 `laneOfUrl`/`CONTENT_SECURITY_API`。安全边界目前由取图路由
     兜着（私有档对他人 404）。这也是举报只能覆盖 `post`/`post_image` 的原因。
  3. **`followPet`/`unfollowPet` 在 `miniprogram/api/follows.ts` 齐备，服务端路由也在，
     但没有任何页面调用** —— 详情页没有关注按钮，phase2-notes 的偏差 #39 与实际不符。
     已作为**计划外的 Task 11** 插进计划（原 11 举报入口 → 12，原 12 收口 → 13），
     因为没有它谁也关注不了，feed 永远是空列表，Task 7 的三身份断言没有真实数据可断。
  4. **Skyline 滚动修复未经真机验证** —— 本环境起不了微信开发者工具。滚动手感、`refresher` 动画、
     compose 页键盘弹起时的推挤都只有代码走查 + markup 断言。已记进 Task 13 的 notes 清单。
  5. **阶段 0 的 tabBar 真机验证项还没闭合** —— 所以 Task 10 的 feed 页面刻意不动 tabBar，
     入口放在个人中心的入口列表里。
  6. **私信本体挂起** —— spec §10 第 1 条的「社交-线上交友」类目资质状态未知，
     `conversations`/`messages` 做出来也过不了审。`packages/chat` 的两个页面壳保持不动。

  ---

  ## 八、可复用的现成样板

  - **走查脚本**：`server/test/manual/phase2-walkthrough.mjs`（31 步，每步打印真实响应，关键处内联断言）。
    Task 13 要写的 `phase3-walkthrough.mjs` 照它改。它已经解决了「每轮用带时间戳的 code 换一对新用户」
    ——复用同一个用户跑第二遍时，「新用户昵称是占位值」那类断言必然假红。
    走查脚本**不被 jest 收集**（`testMatch` 只匹配 `**/test/**/*.spec.ts`），且**有意在库里留数据**。
  - **双跑契约测试**：`server/test/follow-repository.spec.ts`、`test/audit-log-repository.spec.ts`。
  - **门控写法**：`const describeDb = process.env.DATABASE_URL ? describe : describe.skip`。
  - **小程序滚动容器**：所有实页根节点是 `<scroll-view class="page-scroll" scroll-y="{{true}}">`
    （Skyline 不提供全局滚动）。刷新与触底挂容器属性：`refresher-triggered="{{refreshing}}"` 受控位
    + `bindrefresherrefresh` + `bindscrolltolower`。**新加页面必须照这个来**，
    `miniprogram/test/page-scroll.spec.ts` 遍历 `app.json` 全部页面守着。
  - **小程序样式守卫**：不许色值字面量、不许裸 px，只用 `styles/tokens.wxss` 里生成的 token。

  ---

  ## 九、Git 远端（未推送成功，别代劳）

  `origin` 已配为 `https://github.com/qikang1004/paws-paths.git`，但 `git push` 返回 403：
  本机 `credential.helper=wincred` 缓存的是 `pipaajoy` 账号，而仓库属于 `qikang1004`。
  5 个提交仍只在本地。

  **用户会自己在会话里用 `!` 前缀推送。不要代替他跑 `git push`、不要改凭据配置、不要改 remote。**

  ---

  **开始前先读 `docs/superpowers/plans/2026-08-26-phase3-moderation-feed.md`**，确认 Task 1–3 的勾选
  状态与实测备注，补齐「无库全量」的基线数字，然后从 Task 4 开始