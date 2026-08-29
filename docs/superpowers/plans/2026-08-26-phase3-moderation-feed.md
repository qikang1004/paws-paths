# 阶段 3（可做部分）· 举报与人工复核 + 关注流 实施计划

> **For agentic workers:** 按任务逐个执行，每步勾选复选框。RED 先写测试并确认它红，GREEN 才写实现。

**Goal:** 交付 spec §8 阶段 3 中**不依赖社交类目资质**的两块能力：

1. **内容举报与人工复核闭环** —— 补齐审核状态机剩下的三条边（`approved → pending_review`、`pending_review → approved`、`pending_review → rejected`），落地 `audit_log`（不可变流水）与 `moderation_tasks`（待处理队列）两张表，以及一个最小可用的运营角色模型。
2. **关注流 `GET /me/feed`** —— `follows` 表已在，补读路径，并给它配三种身份的可见性断言。

**私信本体（`conversations` / `messages` / WebSocket / 会话列表 / 聊天页）本轮不做**：spec §10 第 1 条的「社交-线上交友」类目资质状态未知，做出来也过不了审。`packages/chat` 的两个页面壳继续保持不动。

## 为什么这两块绑在一起

举报能指向的目标只有 `posts` 与 `post_images`（这两张表有 `audit_status`）。而小程序端**目前没有任何页面展示别人的动态**——「我的动态」只列自己的，宠物详情页不展示动态列表。举报入口因此在客户端无处可落，而 UGC 小程序过审通常要求有内容举报入口。

关注流正是「看到别人动态」的那个场景。所以本轮的客户端落点是：feed 页面提供列表，举报按钮挂在 feed 的动态卡上。两项任务共用一个页面，分开做则举报端点做完也没人能调。

**`pet_photos` 不在举报范围内**：它没有 `audit_status` 列（spec §4.1/§4.5 声称有，实际没有，是既往未记的偏差），加列会撞「迁移只增不改」，而且宠物照片上传路径压根不过机审，没有机审结论可撤。宠物相册的安全边界目前由取图路由兜着（私有档对他人 404）。这条记进 notes，不在本轮修。

**Architecture:**

- **schema 三处变更**，全部是「只增」形态：`users` 追加 `role` 列（`ADD COLUMN IF NOT EXISTS` + `DEFAULT 'user'`，既有行自动补默认值，不改任何既有列的类型或约束）；新建 `audit_log`；新建 `moderation_tasks`。
- **运营身份**走 `users.role`（`user` / `moderator` / `admin`），`ModeratorGuard` 复用既有 JWT（`AuthGuard` 已把 `sub` 挂到 `req.userId`），额外查一次角色。`audit_log.actor_id` 因此能直接外键到 `users.id`，归属清楚。阶段 4 做 Web 后台时按需扩展登录方式，role 模型不用重做。
- **举报**（`POST /reports`，普通登录用户）：`approved → pending_review`，内容立即对他人不可见，同时入队 `moderation_tasks`（`source: user_report`）并写 `audit_log`。
- **复核**（`GET /moderation/tasks` + `POST /moderation/tasks/:id/resolve`，`ModeratorGuard`）：`pending_review → approved`（举报不成立，恢复可见）或 `→ rejected`（举报成立，永久撤下），同样全量写 `audit_log`。
- **状态迁移一律经 `assertTransition`**，禁止手写状态字面量比较（`audit-literal-guard.spec.ts` 守着）。
- **关注流**：`PostRepository.listFeed` 走 `JOIN follows`，可见性过滤下沉到 SQL 的 WHERE（与 `list` 同一套写法，理由见偏差 #23：筛在 LIMIT 之后会把分页算坏）。
- **客户端**：feed 页面进 `packages/profile` 分包（不动主包的 2MB 预算，不改 tabBar——阶段 0 遗留的 tabBar 真机验证项还没闭合），举报走一个新的 `api/reports.ts`。

**Tech Stack:** 沿用阶段 0/1/2 全部技术栈，**不新增任何依赖**。无 WebSocket（那属挂起的私信本体）。

---

## Global Constraints

前 23 条继承阶段 1/2 计划的 Global Constraints（逐字有效，不再重复。特别是第 15/16/22 条：状态机唯一实现、未 approved 对他人不可见、迁移只增不改）。本阶段新增：

24. **审核动作全量写 `audit_log`，无例外**。举报、复核通过、复核驳回三条路径每一次都要写，记录 `actor_id`、`action`、`target_type`、`target_id`、`status_before`、`status_after`。这是 spec §4.4 的合规硬约束（交接文档「不可违反的架构约束」第 6 条）。写流水与改状态必须在**同一个事务或同一条语句**里——状态改了而流水没写，等于审核动作凭空发生。
25. **`moderation_tasks` 是队列，`audit_log` 是不可变流水，不可互相替代**（spec §4.4 原话）。工单可以被更新（`result`、`handled_by` 落值），流水只追加，永不 UPDATE/DELETE。
26. **举报不可见的内容一律 404，不泄露存在性**。举报一条 `pending`/`rejected`/不存在的动态，响应必须与「举报别人看不到的动态」完全一致（同偏差 #19 的理由：403 与 404 分得开，这个差别本身就把「这个 id 有东西」告诉了探测者）。状态机不允许 `pending → pending_review`，但**不能**让这个非法迁移以 422 的形式暴露出去。
27. **举报幂等**：同一目标被重复举报（同一人或不同人）不产生第二条工单、不重复写流水、不报错。内容已经撤下、工单已在队列里，这就是期望状态。判定靠 `moderation_tasks` 上 `(target_type, target_id)` 的部分唯一索引（只约束未处理的工单）。
28. **越权复核一律 403**，且 `ModeratorGuard` 必须有「普通用户拿到的 403 与未登录拿到的 401 分开」的测试。角色从**库里**读，不读令牌里的声明——JWT 是阶段 0 签的，里面没有角色，而把角色塞进令牌会让「撤销运营权限」要等到令牌过期才生效。
29. **feed 的可见性与 `list` 同源**：过滤写在 SQL 的 WHERE 里，且必须有三种身份（作者本人 / 其他登录用户 / 未登录）的断言。`post-visibility.security.spec.ts` 末尾那条静态守卫会因为本阶段加出 feed 路由而变红——**不是删掉它**，而是改成「存在 feed 路由时，必须存在对应的可见性断言」的形态（守卫的反向断言要一并保留，见偏差 #30 的写法）。
30. **feed 只出关注的宠物的动态，不含自己的**：`follows` 表里没有「关注自己」的行（阶段 2 的 `FOLLOW_SELF:42203` 挡住了），所以 feed 天然不含自己的动态。这是**有意的**——「我的动态」已经有专门的页面。测试要钉住这一条，否则将来有人「顺手」把自己的动态并进 feed，作者可见的 `pending` 内容就会混进一个本该只有 `approved` 的列表里。
31. **举报只覆盖有 `audit_status` 的目标**：本阶段是 `post` 与 `post_image`。`target_type` 的白名单在服务端定义，不接受客户端传入未知类型（传了就是 422）。`pet_photos` 不在内，理由见上文。

---

## 任务分组

| 组 | 任务 | 阻塞项 |
|---|---|---|
| 3A · 服务端举报与复核 | Task 1–6 | 无 |
| 3B · 关注流 | Task 7–8 | 无 |
| 3C · 客户端 | Task 9–12 | 3A/3B 的端点 |
| 收口 | Task 13 | 全部 |

Task 1 是三张 schema 变更 + 种子，其余任务都依赖它。Task 7/8 与 3A 无依赖关系，可以先做。

---

## 3A · 服务端举报与复核

### Task 1: schema —— `users.role` 加列 + `audit_log` + `moderation_tasks`

- [x] **RED**：`test/migrations.spec.ts` 追加 SQL 文本断言（新库形状 + `role` 那句用的是 `ADD COLUMN IF NOT EXISTS`）；`test/postgres.integration.spec.ts` 追加门控断言：三处都已落地、`audit_log` 与 `moderation_tasks` 的 CHECK 生效、部分唯一索引存在且**只**约束 `result IS NULL` 的行（插两条同目标已处理工单不冲突、插第二条未处理工单冲突）。
- [x] **GREEN**：`schema.sql` 末尾「既有表的迁移」段追加 `users.role` 加列（**一句话**，逐字见附录 B）。**不包 `DO $$` 块**：这里没有「新库没这列」的问题（不引用任何可能不存在的列，不会像 favorites 那次在语义分析阶段就报错），而 CHECK 写成列级约束后整句自带幂等——已在远程库用临时表实测过重跑两次约束数不变。
- [x] **GREEN**：新建 `audit_log` 与 `moderation_tasks`（建表语句逐字见附录 A），放在建表区而非迁移区。
- [x] 两张新表的 `target_id` 与 `audit_log.actor_id` **都不挂外键**，SQL 注释里写清两个不同的理由：`target_id` 是多态的（`post`/`post_image` 两张表，同 `favorites`/`view_history` 的既有理由）；`actor_id` 不挂是因为**流水必须比它记录的主体活得久**——挂 `ON DELETE SET NULL` 会在删用户时改写一条本该不可变的流水，挂 `RESTRICT` 又会让「有审核历史的用户永远删不掉」。代价是拼错的 `actor_id` 不会被库拦住，接受。
- [x] `moderation_tasks.result` 为 `NULL` 表示待处理；`handled_by` / `handled_at` 同步落值。`source` 的 CHECK 含 `wx_auto`（spec §4.4 的三个值全留），但本阶段机审**不入队**——机审当场就有结论，入队等于建一条立刻要关掉的工单。
- [x] `seed.sql` 追加：一个 `moderator` 角色用户（`u-mod`，`ON CONFLICT DO NOTHING`），供复核端点的测试与走查用。**不追加** `audit_log` / `moderation_tasks` 的种子行——它们是流水与队列，种子里塞假数据会让「本轮真的写进去了几条」数不清（同偏差 #31 的取向）。
- [x] **验收**：带库回归全绿；`runMigrations` 二次执行仍幂等（`global-setup.ts` 连跑两遍就是证据）；`role` 加列在**有数据的旧库**上跑通（既有 8 个种子用户自动落 `user`）。

> **Task 1 实测**：真库真 Redis **44 套 / 495 例全绿**（89.9s，基线 44/485，+10 = 迁移单测 +3、集成门控 +7）；无库无 Redis **38 套绿 / 6 套 skip，386 绿 / 109 skip**（基线 383/102，增量同样对上）。
> **一处计划外的测试基础设施改动**：本组有几条断言要**插入成功**才能验（部分唯一索引得先有一条未处理工单占位），而库是共享的远程实例，留下的行会让走查数不清。既有探针都是「插入必失败」，失败本身不留数据，所以它们不需要这个。加了一个 `inRollback` 助手在事务里跑探针再回滚。
> **`u-mod` 刻意不叫 `u-9`**：集成用例按 `^u-[0-9]+$` 数种子用户（8 位主人），编号进去会把那条计数断言撞红。

### Task 2: `packages/types` 扩展 + `sync:types`

- [x] **RED**：`packages/types/test/` 追加断言：`UserRole` 三个值、`ModerationTargetType`（`post`/`post_image`）、`ReportReason` 白名单、`AuditAction` 五个值、`ModerationTaskDto` / `ReportRequest` 形状、新错误码。
- [x] **GREEN**：新建 `packages/types/src/moderation.ts` 并从 `index.ts` 导出。`AuditAction` 定义为 `report` / `review_approve` / `review_reject` / `auto_approve` / `auto_reject`。
- [x] 新增错误码，**先核对已占用的**（`42200`–`42203`、`42900`、`50000`、`50201`–`50203` 都已用）：`ALREADY_REPORTED` 不新增（幂等成功，不是错误）；只加 `MODERATION_TARGET_INVALID: 42204`（未知 `target_type`）与 `MODERATION_TASK_HANDLED: 42205`（工单已被别人处理，并发复核的败者拿这个）。403 复用既有 `FORBIDDEN`。
- [x] 状态机**不动**：`approved → pending_review → approved/rejected` 三条边阶段 0 就已定义且有单测（`packages/types/test/audit.spec.ts`）。本任务只加类型，不改 `audit.ts` 的迁移表。
- [x] **GREEN**：跑 `npm run sync:types`，确认 `miniprogram/shared/types/` 同步（sync-types 守卫会判手改，必须走脚本）。
- [x] **验收**：`@paws/types` 测试全绿；三处 `tsc --noEmit` 干净。

> **Task 2 实测**：`@paws/types` **6 套 / 79 例全绿**（基线 5/56，+23）；`sync:types` 同步 22 个文件，sync-types 守卫 7 例绿；三处 `tsc --noEmit` 干净。
> **比计划多加的两样**（都是为了不让客户端各自硬编码一份）：`REPORT_REASON_LABELS` 展示文案映射、`ResolveTaskRequest` 请求体类型（计划里 Task 6 才隐含需要，提前放进同一个文件更合适）。另把 `AUDIT_ACTIONS` / `MODERATION_SOURCES` 也导出成常量数组，与 `USER_ROLES` 一致，好让服务端校验直接吃它。

### Task 3: 审计流水仓储 —— `AuditLogRepository`

- [x] **RED**：`test/audit-log-repository.spec.ts` 双跑契约测试（同 `favorite-repository.spec.ts` 的门控写法：无库跑内存实现，有库两个都跑）。断言：`append` 写入后能按目标查回、按时间倒序、`actorId` 为 null 的机审流水也能写（机审没有操作人）。
- [x] **GREEN**：`server/src/moderation/audit-log.repository.ts` —— `AUDIT_LOG_REPOSITORY` 令牌 + `InMemoryAuditLogRepository` + `PostgresAuditLogRepository`，接口只有 `append` 与 `listByTarget`。**没有 update / delete**：Global Constraint 25 要求流水不可变，不给它们留方法就是最强的保证。
- [x] `append` 接受一个可选的外部 client（`PoolClient`），让调用方能把它塞进自己的事务——Global Constraint 24 要求「改状态」与「写流水」原子。签名形如 `append(entry, client?)`，不传就用 pool。
- [x] **验收**：双跑契约测试全绿。

> **Task 3 实测**：无库 7 例绿 / 11 例门控 skip，真库 18 例全绿；全量带库回归 **45 套 / 513 例全绿**（+1 套 +18 例）。
> **比计划多做的三样**：① 契约里加了一条「接口上没有 update/delete」的反射断言，把 Global Constraint 25 从「代码里没写」升级成「有测试钉住」；② `listByTarget` 也接 `client?`，否则事务内写完的流水在事务内查不到（那条回滚断言就是靠它证明「真的在同一个事务里」）；③ Postgres 侧排序是 `created_at DESC, id DESC` —— 单条 CTE 里写两条流水时 `now()` 是常量，只按时间排会出不确定顺序。
> **顺带接上 DI 绑定**：`ModerationModule` 加 `AUDIT_LOG_REPOSITORY` 双绑定并导出（计划里没写在 Task 3，但仓储的家就是这个模块，放这里比拖到 Task 4 干净）。

### Task 4: 举报端点 `POST /reports`

- [x] **RED**：`test/reports.controller.spec.ts`（门控 + 无库两种模式各跑）断言七件事：① 举报别人 `approved` 的动态 → 200，状态迁到 `pending_review`；② 迁移后**举报人自己也看不到**它了（`pending_review` 对非作者不可见，作者仍可见）；③ 写了一条 `audit_log`（`action: report`、`status_before: approved`、`status_after: pending_review`、`actor_id` 是举报人）；④ 入了一条 `moderation_tasks`（`source: user_report`、`result IS NULL`）；⑤ **重复举报幂等**——同一人再举报一次、另一个人也举报一次，都返回 200，工单数仍为 1、流水不新增；⑥ 举报 `pending` / `rejected` / 不存在的 id / 别人看不到的动态，四种情况响应**完全一致**（404，且 body 一字不差）；⑦ 未登录 401、`target_type` 传 `pet_photo` 或乱值 → 422。
- [x] **RED**：`test/post-visibility.security.spec.ts` 追加一组：举报导致的 `approved → pending_review` 之后，三种身份的可见性（作者可见、他人 404、未登录 404）。这一组必须是**真库**门控——内存实现是另一份代码（同偏差 #32 的理由）。
- [x] **GREEN**：`server/src/moderation/reports.controller.ts` + `moderation.service.ts`。可见性判定复用 `isVisibleTo`，迁移合法性经 `assertTransition`。
- [x] **关键**：先按「这个人能不能看见这条动态」判 404（复用 `PostsService.detail` 同一套判定），**再**判状态机。否则举报一条 `pending` 动态会因为 `assertTransition` 抛出而变成 422，把「这条 id 存在但状态不是 approved」泄露出去（Global Constraint 26）。合法但已被举报过的（`pending_review`）走幂等分支返回 200，不是 404——那条内容对举报人已经不可见了，但他刚刚举报的动作是成功的。
- [x] **GREEN**：状态迁移 + 写流水 + 入队三件事在**一条 CTE 语句**里完成（Postgres 侧），理由同偏差 #24：数据修改型 CTE 的子语句保证各执行一次、执行到底，不必开事务；而分成三次往返的话，中间崩掉会留下「状态改了但没工单」的半截状态。内存实现按顺序做三步。
- [x] **验收**：两种模式全绿；`audit-literal-guard.spec.ts` 仍绿（新代码不许手写状态字面量比较）。

> **Task 4 实测**：无库无 Redis **40 套绿 / 6 套 skip，406 绿 / 121 skip / 527 例**（基线 39 绿 6 skip、393 绿 120 skip 513 例；+1 套 +14 例）。举报套件 13 例全绿，`audit-literal-guard.spec.ts` 5 例仍绿，`tsc --noEmit` 干净。
> **本环境跑不到真库**：`server/.env` 在这份工作树里不存在（只有 `.env.example`），`DATABASE_URL` / `REDIS_URL` 未设，所以门控套件一律 skip —— 上面第二条 RED（可见性第 6 组）与举报套件的真库分支**都没有真跑过**，只验证了「无库模式全绿 + 编译通过 + 门控确实 skip」。这条限制要记进 Task 13 的笔记里，提审前必须在有 `.env` 的机器上补一次真库回归。
> **计划外但必须做的一件事 —— 抽出 `PostRepositoryModule`**：`ModerationModule` 在无库模式下要拿动态仓储当举报目标源，而 `PostsModule` 已经 import 了 `ModerationModule`，反向再 import 就成环。照 `PetRepositoryModule` 的既有做法把 `POST_REPOSITORY` 的工厂搬进 `server/src/posts/post-repository.module.ts`，两个模块都 import 它。**不能各建一个工厂**：那等于两份内存数据，举报改了这边的状态而 `GET /posts` 读的是那边的 —— 实测就是这么分叉的（第一次跑挂了 7 例，症状正是「状态迁了但查不到工单/动态」）。
> **`PostRepository` 加了两个方法**：`findImageById(imageId)`（回图片与它所属的动态 —— 图片行上没有作者，而举报一张图要判可见性）与 `setImageAuditStatus(imageId, status)`。计划里没写，但 `target_type` 白名单含 `post_image`，不加这两个方法那一半目标类型在无库模式下根本无从下手。
> **幂等判定挪到可见性判定之前**（与计划第 4 条的字面顺序不同，结论一致）：内容一旦被举报就迁到 `pending_review`、对举报人自己也不可见了，先判可见性会让重复举报拿到 404 —— 等于告诉举报人「刚才那次没成功」，而实际上成功了。泄露面限死在「这条 id 正在复核中」一位信息上，且队列里有工单必然意味着真有人举报过它（机审不入队），所以拿不到「任意 id 是否存在」。代码里注明了这是 Global Constraint 26 上一处**有意的例外**。
> **一处返工**：Postgres 侧那条 CTE 原先写成 `TARGET_UPDATE[type].replace('$2','$6')`，用字符串替换给绑定参数重编号。参数顺序一动就静默错位，而错位的后果是「状态迁到了错的值」。改成定值表只存表名（`TARGET_TABLE`），`UPDATE` 整句连参数号一起写在 CTE 里。

### Task 5: 运营角色 —— `users.role` 读取 + `ModeratorGuard`

- [x] **RED**：`test/moderator-guard.spec.ts` 断言：未登录 → 401；普通用户 → 403；`moderator` → 放行；`admin` → 放行；令牌里**声明**了 `role: admin` 但库里是 `user` → 403（角色只从库里读，Global Constraint 28）。
- [x] **GREEN**：`UserRepository` 加 `findRole(userId)`（窄接口，同偏差 #27 的取向：不改既有 `findProfile` 的返回形状，三个调用方不用跟着改）；两个实现都要有，内存实现从一个可注入的种子里读，好让测试能造一个 moderator。
- [x] **GREEN**：`server/src/auth/moderator.guard.ts`。它**不重新验签**——`@UseGuards(AuthGuard, ModeratorGuard)` 按顺序执行，`AuthGuard` 已经把 `req.userId` 挂好了。Nest 的 guard 数组是顺序执行的，前一个抛出后一个不跑。
- [x] **验收**：两种模式全绿。Task 5 收尾。

> **Task 5 实测**：无库无 Redis **41 套绿 / 6 套 skip，414 绿 / 121 skip / 535 例**（Task 4 收尾是 40/6、406/121/527；+1 套 +8 例，正好是守卫套件的 8 例）。`tsc --noEmit` 干净。真库分支同样跑不到（`server/.env` 不存在，见 Task 4 的限制说明）—— 无库模式下角色走注入的种子，真库模式下走 `SELECT role FROM users`，**后者未经真跑验证**。
> **比计划多断言的三条**：令牌乱值 → 401（守卫顺序的另一半）；令牌声明 `role: moderator` 也不算（只钉 `admin` 会让「只过滤 admin 字样」的错实现漏过）；库里查不到这个人 → 403 而不是 500（`sub` 验过签但没有对应行，那是权限不足，与普通用户同一个响应）。
> **`findRole` 在 Postgres 侧多做一次白名单筛**：查到的 `role` 不在 `USER_ROLES` 里就回 `null`。生产上运营角色是人工 `UPDATE` 授的（见 `RELEASE_CHECKLIST.md`），列级 CHECK 兜得住，但真被绕过了也不该让一个未知字符串在守卫里被当成有效角色。
> **计划外的两处配线**：① `UsersModule` 导出 `USER_REPOSITORY` 令牌（不是实现类），因为守卫住在 `AuthModule` 而角色在用户域；② `AuthModule` 把 `UsersModule` 一起 re-export。**第二条是踩出来的**：守卫是**宿主模块**的 injectable —— `@UseGuards(...)` 写在谁的 controller 上，Nest 就在谁的注入上下文里造实例。`AuthGuard` 没有依赖所以这件事一直没人察觉，而 `ModeratorGuard` 要仓储，不 re-export 的话每个挂运营端点的模块都得自己再 import 一遍 `UsersModule`，漏一个就是启动时才炸。
> **测试套件刻意不 import `AuthModule`**（改成 `imports: [UsersModule] + providers: [AuthGuard, ModeratorGuard]`）：`AuthModule` 带着 `RateLimitModule` → Redis 客户端，本套件与限流无关，而那条依赖在无 Redis 环境下会让套件卡在重连上跑不完（第一次这么写直接超时 31s 挂掉）。同 `auth-guard.spec.ts` 的做法。
> **一个与实现无关的坑**：断言「令牌乱值」时原本用了中文字面量 `Bearer 不是令牌`，superagent 直接抛 `Invalid character in header content` —— 非 ASCII 放不进 HTTP 头。换成 `not-a-token`。

### Task 6: 复核端点 `GET /moderation/tasks` + `POST /moderation/tasks/:id/resolve`

- [x] **RED**：`test/moderation.controller.spec.ts` 断言：① 工单列表只出 `result IS NULL` 的，按创建时间正序（先举报的先处理），分页规则同其他列表（默认 10、上限 20）；② 列表项带被举报内容的**完整原文**——运营要看内容才能判，`isVisibleTo` 在这条路径上不适用（运营不是作者，但必须看得见 `pending_review` 的内容），这是**有意的例外**，代码里注明；③ 复核通过 → 状态回 `approved`、内容对所有人重新可见、工单 `result: approved`、`handled_by` 落值、写一条 `audit_log`（`action: review_approve`）；④ 复核驳回 → `rejected`、对他人不可见、作者能看到驳回原因、流水 `action: review_reject`；⑤ 普通用户调这两个端点 → 403，未登录 → 401；⑥ **并发复核**：同一工单被处理两次，第二次拿 `MODERATION_TASK_HANDLED`（42205），且第二次**不写**第二条流水、不改状态。
- [x] **GREEN**：`server/src/moderation/moderation.controller.ts`，两个端点都挂 `@UseGuards(AuthGuard, ModeratorGuard)`。
- [x] **关键**：⑥ 的并发安全靠**带条件的 UPDATE 拿票**（`UPDATE moderation_tasks SET result = $1, ... WHERE id = $2 AND result IS NULL RETURNING *`）——受影响行数为 0 就是「别人先处理了」，不做「先 SELECT 判断再 UPDATE」（那之间有窗口）。状态迁移与写流水挂在拿到票之后，同一条 CTE 里。
- [x] **验收**：两种模式全绿。

> **Task 6 实测**：无库无 Redis **42 套绿 / 6 套 skip，431 绿 / 121 skip / 552 例**（Task 5 收尾是 41/6、414/121/535；+1 套 +17 例）。复核套件 17 例全绿，`audit-literal-guard.spec.ts` 5 例仍绿，`tsc --noEmit` 干净。真库分支仍跑不到（`server/.env` 不存在，见 Task 4 的限制）——**那条拿票 CTE 与工单列表那条多态 JOIN 都没在真库上跑过**。
> **比计划多断言的五条**：作者本人也不能复核自己被举报的内容（他不是运营 —— 只测「普通用户 403」会漏掉「作者算不算特殊」这个问题）；列表**不下发** `reportedBy` / `result` / `handledBy`（运营按内容判，下发举报人只会招来针对举报人的报复）；已处理的工单再复核一次仍是 42205（并发那条只覆盖同时点，点一个早已关掉的工单是另一条路径）；不存在的工单 id → 404；`result` 传乱值 → 422 且不动状态、不关工单。
> **「不存在」与「已被处理」刻意分成 404 与 422**，与举报那条路径的取向相反：那里分开会泄露内容存在性，而这里调用方是运营，工单 id 本来就是列表给的，把「你点的这条别人刚处理完」告诉他才是对的。
> **驳回必须写原因**（计划没写）：`rejected` 而 `rejectReason` 为空 → 422。作者能在「我的动态」里看到这个原因，空着等于告诉他「被撤了但不告诉你为什么」。放行时反过来把传进来的原因**丢掉** —— 留着只会在作者那边显示一条陈旧的驳回理由。
> **一处返工，也是 Task 6 唯一真正棘手的地方**：复核结论的两个值（`approved` / `rejected`）与两个审核状态**同名**，所以 `result === 'rejected'` 这种再自然不过的写法会被 `audit-literal-guard.spec.ts` 拦下（那条守卫扫的是文本，连注释里的比较写法也算 —— 第一次跑就是被注释里的示例撞红的）。改成一张 `REVIEW_OUTCOME` 表：结论 → `{ status, action, needsReason }`，合法性判定变成 `raw in REVIEW_OUTCOME`。这样反而更好 —— 加一种结论时漏改一处的可能性归零。
> **`Object.hasOwn` 不能用**：项目 tsconfig 的 target 还在 ES2021，`tsc` 直接报 TS2550。改用 `in`（`REVIEW_OUTCOME` 是本文件的字面量对象，原型链上没有可撞的键）。
> **工单列表那条 SQL 用两组 LEFT JOIN 摊平多态目标**，而不是按 `target_type` 分两条语句：分页要跨类型排序，两条语句就得在应用层合并再切片，那等于把 LIMIT 做废（同「过滤必须在 SQL 里做完」的理由）。图片类工单的 `imageUrls` 只给被举报那一张 —— 举报指向的是这张图，不是整条动态。
> **`ResolveInput` 带上 `target`**：上层为了 `assertTransition` 本来就得先取到目标的当前状态（状态机唯一实现点在服务层），传下来省一次往返，也让「流水里的 statusBefore」与「状态机判过的那个值」一定是同一个。
> **`reject_reason` 只有 `posts` 有那一列**，所以复核的 UPDATE 片段整句写在定值表里（`TARGET_RESOLVE_UPDATE`），不是只给表名再拼 —— 谁带那一列一眼看得见。参数表里驳回原因排**最后**，图片那一支不传它，前九个参数的编号因此不受影响（PG 对「传了但语句里没引用」的参数会直接报 bind 参数个数不符，占位敷衍不过去）。
> **无库模式的 `authorNickname` 回退成作者 id**：内存用户仓储按 openid 存，种子动态的 `authorId`（`u-1` 等）在那里没有对应记录。把用户仓储注进审核域换一个昵称不值那个耦合 —— 无库是演示降级，运营界面在真库上跑。断言因此写成「是个非空字符串，真库模式下才比对具体昵称」。

---

## 3B · 关注流

### Task 7: `GET /me/feed` 读路径

- [x] **RED**：`test/feed.controller.spec.ts` 断言：① 只出**关注的宠物**的动态，按发布时间倒序跨宠物混排；② **不含自己的动态**（Global Constraint 30）——即使自己的宠物被自己关注不了，也要专门钉一条：造一个「我关注了 A 的宠物，我自己也有宠物且发过动态」的场景，断言返回里没有自己那条；③ 一只都没关注 → 空列表 + `hasMore: false`（不是 404）；④ 分页规则同其他列表；⑤ 未登录 401（feed 是「我的」数据，挂 `AuthGuard`，与 `/me/*` 其余端点一致）。
- [x] **RED**：可见性三种身份的断言写在 `post-visibility.security.spec.ts`（真库门控）：关注的宠物有一条 `pending` 动态时，**关注者看不到它**（他不是作者）；作者自己调 feed 时那条也不该出现（他没关注自己的宠物）；未登录拿 401。这一组是 Global Constraint 29 要求的。
- [x] **GREEN**：`PostRepository` 加 `listFeed({ viewerId, page, pageSize })`，两个实现都要有。Postgres 侧 `JOIN follows f ON f.target_pet_id = po.pet_id AND f.follower_id = $1`，可见性写进 WHERE（`po.audit_status = ANY($2)`——**这里不需要** `OR po.author_id = $3`：feed 里全是别人的动态，加上那个条件反而会把自己的 `pending` 内容漏进来）。
- [x] **GREEN**：端点挂在 `MeController` 上（路径 `/me/feed`，与 `/me/following`、`/me/pets` 同属「当前用户的数据」，理由同偏差 #4）。
- [x] **验收**：两种模式全绿。

> **Task 7 实测**：无库无 Redis **43 套绿 / 6 套 skip，445 绿 / 125 skip / 570 例**（Task 6 收尾是 42/6、431/121/552；+1 套 +18 例 = feed 套件 13 例 + 可见性第 7 组 4 例（真库门控，本环境 skip）+ 守卫改造净 +1）。`tsc --noEmit` 干净。真库分支仍跑不到（`server/.env` 不存在）——**那条 `JOIN follows` 的 SQL 没在真库上跑过**。
> **计划外但必须做的一件事 —— 再抽出 `FollowRepositoryModule`**：无库模式下动态仓储得问一句「这个人关注了哪些宠物」（内存里没有 JOIN），而 `FollowsModule` 还带着依赖宠物仓储的 `FollowsService`。让动态域 import 整个关注域等于把宠物卡的投影逻辑拖进依赖里。同 Task 4 抽 `PostRepositoryModule` 的理由，**也同那次的教训**：两处各建一个工厂等于两份内存关注关系，端点关注写进这一份、feed 读那一份，无库模式下 feed 会恒为空。
> **`InMemoryPostRepository` 的关注源是可选构造参数**：没注入时 feed 恒为空列表而不是抛依赖缺失 —— 无库演示里关注关系本来就可能没建过。
> **比计划多断言的三条**：① 「就算硬把自己的宠物写进关注表，自己的动态也不该出现」——`POST /pets/:id/follow` 会拦下关注自己（`FOLLOW_SELF`），但仓储层拦不住，feed 的正确性**不该依赖另一层的校验**，所以 SQL 里那个 `po.author_id <> $1` 是独立成立的；② 作者关注了自己的宠物时，他自己的 `pending` 动态也不进 feed（这一条钉的正是「WHERE 里不许有 `OR author_id = viewer`」）；③ 每一项都带 `petName` / `petId` / `auditStatus`（客户端要显示是谁发的）。
> **断言一律按「本轮发的那几条 id」判包含/不包含与相对先后，不数整页条数**：无库模式借了种子宠物（p-1/p-2/p-5），页面上还有种子动态；真库是共享实例，别的套件也在往里发。

### Task 8: 改造 feed 静态守卫

- [x] **RED**：Task 7 一落地，`post-visibility.security.spec.ts` 末尾那条静态守卫就会红（它断言「没有任何控制器声明 feed 路由」）。这是**设计好的红**，不是回归。
- [x] **GREEN**：把守卫从「不许有 feed 路由」改成「**有 feed 路由时，必须有对应的可见性断言**」：扫本文件自身的源码，断言存在标记了 feed 可见性的 describe/it（按标题正则匹配）。保留原来那条「守卫不是永真的」反向断言的等价物——新守卫也要能证明自己抓得住（比如对一段不含 feed 断言的假文本判 false）。
- [x] 守卫仍放在门控 describe **之外**（无库模式下照常跑，同偏差 #30）。
- [x] **验收**：无库与真库两种模式下该套件全绿。

> **Task 8 实测**：与 Task 7 同一次跑（守卫在同一个文件里）。无库模式下该套件 3 例绿 / 18 例门控 skip。设计好的红确实出现了 —— Task 7 的端点一落地，旧守卫立刻报 `offenders: ["me/me.controller.ts"]`。
> **偏离计划的一处，而且是必须偏离的**：计划说「扫本文件自身的源码，按标题正则匹配」。**那样写会立刻空转** —— 判据的正则本身就写在这个文件里，扫自己一定命中，守卫就永真了。改成让第 7 组**自注册**：组内一行 `feedVisibilityAsserted = true`，守卫读这个标志。`describe` 的回调在收集阶段就执行（`describe.skip` 也一样，它只把里面的 `it` 标成跳过），所以无库模式下那一组整组 skip、标志照样置上 —— 守卫与门控无关，两种模式都跑。组被删掉或改名，标志不会置上，守卫立刻红。
> **反向断言留了三条**：正则对 `@Get('feed')` / `@Get('me/feed')` 判真、对 `@Get(':id')` 判假；判据函数喂假数据（有 feed 的挑出来、没 feed 的不挑）；外加一条**「本阶段确实有 feed 路由」** —— 上面那条蕴含式在「没有 feed 路由」时自然成立，这条钉住前件为真，蕴含式因此不是空转。feed 端点若被挪走或删掉，这条会红并提醒重新想守卫的形状。

---

## 3C · 客户端

### Task 9: `api/reports.ts` + feed 的 api 包装

- [x] **RED**：`miniprogram/test/` 追加断言：`reportPost(postId)` 打到 `POST /reports` 且请求体形状正确；`fetchFeed(params)` 打到 `GET /me/feed` 并带分页参数；两者都经 `api/request.ts`（不许直接 `wx.request`，`wx-guard` 守着）。
- [x] **GREEN**：新建 `api/reports.ts`，feed 的包装加进既有 `api/posts.ts`（它已经有 `fetchPosts`，同一域）。分页参数复用 `api/paged.ts` 的 `PageParams`（偏差 #34）。
- [x] **验收**：miniprogram 测试全绿；`tsc --noEmit` 干净。

> **Task 9 实测**：miniprogram **39 套 / 483 例全绿**（基线 38 套 / 477 例；+1 套 +6 例）。`tsc --noEmit` 干净。`wx-guard` 与 `module-guard` 都在这 39 套里，仍绿 —— 新文件没有直呼 `wx.request`。
> **新套件单独成文件**（`test/moderation-api.spec.ts`，不塞进 `social-api.spec.ts`）：理由同服务端把 `/reports` 与 `/moderation/*` 拆两个 controller —— 阶段边界在排查时有用。
> **比计划多做的一样 —— `reportImage`**：`targetType` 白名单含 `post_image`，而图片与动态的审核状态独立（撤下一张图不影响文字）。两个具名函数各写死一个 `targetType`，**不把它开放给页面传** —— 传错类型在服务端是 422 `MODERATION_TARGET_INVALID`，而那种错重试也没用，不如在包装层就消灭掉。
> **`fetchFeed` 的参数类型是 `PageParams` 而不是 `FetchPostsParams`**：没有 `petId` 正是它与 `fetchPosts` 的根本区别。专门断言了「data 的键**只有** `page` 与 `pageSize`」，免得日后有人顺手塞个 petId 进去（服务端会忽略它，那种静默无效最难查）。

### Task 10: feed 页面（`packages/profile/pages/feed/`）

- [x] **RED**：`miniprogram/test/feed-page.spec.ts` 断言视图装配：`buildPostView` 复用既有那份（偏差 #37：相对图片地址必须过 `resolveImageUrl`，且只在视图装配里做一次）；空态分「一只都没关注」（引去广场）与「关注了但都没发过动态」（引去看关注列表）两种；翻页走 `mergePage`（`utils/list-paging.ts`）。
- [x] **GREEN**：页面四件套 + 注册进 `app.json` 的 `packages/profile` 分包页面列表。**不改 tabBar**（阶段 0 的 tabBar 真机验证项还没闭合，动它会把两件事混在一起）。入口放在个人中心的入口列表里，与「我关注的」相邻。
- [x] **GREEN**：动态卡复用 `audit-badge` 组件展示审核角标——feed 里全是别人 `approved` 的内容，角标理论上不出现，但组件复用比新写一份卡片可靠。
- [x] **验收**：miniprogram 测试全绿。

> **Task 10 实测**：miniprogram **40 套 / 496 例全绿**（Task 9 收尾是 39 套 / 483 例；+1 套 +13 例 = 新套件 10 例 + 既有 `profile-page.spec.ts` 那条入口断言改写）。`tsc --noEmit` 干净。
> **空态的判据是 `followingCount` 的三态，不是两态**：`0` = 一只都没关注（引去广场）、`>0` = 关注了但他们没发过（引去关注列表）、`-1` = **还没取到**，两种空态都不显示。第一版写成 `!followingCount` 把「还没取到」和「一只没关注」混成同一支 —— 那会在首屏那一瞬间闪一下「还没有关注任何宠物」，而实际上可能关注了一堆。关注数从 `GET /me` 来（它已经给了 `followingCount`），不为这一个数再拉一遍关注列表；这一发**失败也不弹 toast** —— 它只影响空态文案指向哪里，而列表那一发失败时已经提示过了。
> **`init()` 里两发并行**（`Promise.all([loadFollowingCount(), loadPage(1, true)])`）：它们互不依赖，串起来白等一个 RTT。
> **一处测试自身的返工，与 Task 6 那次同源**：原本写 `expect(ts).not.toContain('petId')` 来钉住「feed 不吃 petId」，结果被**解释这件事的注释**撞红（注释里写着「不吃 petId」）。文本级断言撞上自己的说明文字，与 `audit-literal-guard` 那次是同一个陷阱。改成断言调用形状：`/fetchFeed\(\{\s*page,\s*pageSize:\s*PAGE_SIZE\s*\}\)/`。
> **`onShow` 走 `init()` 而不是直接 `loadPage(1)`**：关注/取关之后回来，关注数与列表都变了，两样都得重取。`init` 里那句是 `loadPage(1, true)` —— force 是必须的，`onShow` 与 `onLoad` 可能挨得很近，不 force 会被 loading 闸门挡掉。
> **`onGoPlaza` 用 `wx.switchTab`**：广场是 tab 页，`navigateTo` 到 tab 页会**静默失败**（不报错、不跳转），那种失败在真机上最难查。
> **顺带改了既有断言**：`test/profile-page.spec.ts` 的「四个入口」那条按顺序钉住了 `PROFILE_ENTRIES` 的键，加入口必然撞红。改成五个键并把顺序一起钉住（`feed` 紧跟 `following`）—— 这条断言的价值正在于顺序，改成集合比较反而更弱。

### Task 11: 关注开关接进宠物详情页（计划外补入）

> **为什么插在这里**：`followPet` / `unfollowPet` 在 `api/follows.ts` 里齐备，服务端
> `POST|DELETE /pets/:id/follow` 也在，但**没有任何页面调用它们**——宠物详情页没有关注
> 按钮。phase2-notes 的偏差 #39 与实际不符。没有这一步，谁也关注不了任何宠物，
> Task 10 的 feed 页面永远是空列表，Task 7 的三身份断言也没有真实数据可断。
> 这是本轮唯一的计划外新增任务，记进 notes 的偏差清单。

- [x] **RED**：`test/pet-detail-page.spec.ts` 追加断言：详情页 data 有 `isFollowing` 与
      `following`（进行中标志）；wxml 有关注按钮且文案随 `isFollowing` 切换；
      `onToggleFollow` 按当前态分别调 `followPet` / `unfollowPet`；成功后就地翻转
      `isFollowing`（**不重拉详情**——整页 loading 会把相册和滚动位置一起重置）；
      失败弹 toast 且 `isFollowing` **不翻转**（乐观更新在这里不合适：关注态是
      feed 的入口条件，显示成功而实际没写进去，用户会以为 feed 该有内容）。
- [x] **RED**：断言**自己的宠物不出关注按钮**。服务端 `FOLLOW_SELF:42203` 会挡，
      但让按钮出现再报错是把一个必然失败的动作摆在用户面前。
- [x] **GREEN**：`pages/pet-detail/index.ts` 加 `onToggleFollow`；`detail-model.ts` 的
      `buildDetailView` 透出 `isFollowing` 与 `isOwn`（`PetDetailDto.isFollowing` 服务端
      已给，未登录一律 `false`，不用页面兜 `?? false`）。
- [x] `following` 进行中标志挡连点：关注/取关不幂等于「点两次等于点一次」的直觉——
      连点会打出两个反向请求，最终态取决于哪个先回。
- [x] **验收**：miniprogram 测试全绿；`tsc --noEmit` 干净。

> **Task 11 实测**：miniprogram **40 套 / 504 例全绿**（Task 10 收尾是 40 套 / 496 例；+8 例，同一批文件里加的）；server **43 套绿 / 6 skip，450 绿 / 125 skip / 575 例**（Task 8 收尾是 445/125/570；+5 例）；`@paws/types` **6 套 / 82 例全绿**（基线 79 例，+3）。三处 `tsc --noEmit` 干净。
> **`isOwn` 是服务端新加的字段，计划里没写**：计划假设 `buildDetailView` 能自己算出「是不是我的宠物」，但客户端**拿不到主人是谁** —— `PetDetail` 只有 `owner.{nickname, avatarUrl, ownerVerified}`，而 `ownerId` 刻意不下发（`PetRepository.findOwnerId` 的注释就写着这条）。会话里存的是 `userId`，可它跟昵称对不上。所以只能由服务端算：`PetDetail.isOwn: boolean`，`PetsService.detail` 多接一个 `viewerId`，用既有的 `findOwnerId` 比对。**下发布尔值而不是 `ownerId`** —— 客户端要判的本来就只是「是不是我」，把主人的用户 id 放进公开响应是白扩攻击面。这条改动跨了三个包（types → server → miniprogram），走 `npm run sync:types` 同步。
> **`PetDetail` 在服务端有第二份定义**（`pets.service.ts` 里的本地 interface，与 `packages/types` 那份形状一致但各自独立）。这是既有结构，本任务只跟着加了同一个字段 —— 两份定义漂移的风险是既有账，记进 Task 13 的 notes。
> **未登录时不查归属那一发**：没有 viewer 就一定不是「我的」，省一次 `findOwnerId` 往返。
> **不做乐观更新**（与页面别处的取向不同，计划里也点明了）：关注态是关注流的入口条件，显示成功而实际没写进去，用户会以为 feed 该有内容却一直空着。所以先等服务端回，再改本地态；而且改的是**服务端回的那个值**，不是本地推算的 `next` —— 两者理应一致，真不一致时该显示库里的事实。
> **就地翻转用路径式 `setData`**（`'view.isFollowing'` / `'view.followText'`）：只改那两格，不重建整个 view 对象，相册与滚动位置都不动。`followTextOf` 从 `detail-model.ts` 导出，让「翻转时的文案」与「首次渲染的文案」共用同一份映射。
> **`following` 复位在 `finally` 里**：失败一次就永久禁用按钮的话，用户只能退出重进。
> **两处既有测试跟着改**：`pet-edit-page.spec.ts` 的 `PetDetail` 夹具补 `isOwn: true`（编辑页只会打开自己的宠物）；`packages/types/test/social.spec.ts` 的 `PetDetail.isFavorite` 那组基底补 `isOwn`，另新增一组 `PetDetail.isOwn` 的断言（含「响应里没有 ownerId」那条）。
> **一处测试自身的返工，与 Task 6 / Task 10 同源**：`finally` 里的复位断言写成 `/finally\s*\{\s*this\.setData/`，被夹在中间的**注释**撞红。这已经是本轮第三次踩「文本级断言撞上自己的说明文字」了 —— 正则里容一行注释解决。

### Task 12: 举报入口

- [x] **RED**：断言点了举报 → 弹确认 → 调 `reportPost` → 成功后**把那条从列表里原地删掉**（`dropById`，偏差 #39：不许重拉那一页，滚动位置会跳且服务端那一页已经错位）。举报成功的提示语要说明「内容已提交复核」，不是「已删除」。
- [x] **GREEN**：举报按钮挂在 feed 动态卡上。用 `wx.showModal` 确认（举报是不可撤销的动作，且会让内容对所有人消失）。举报原因先用固定白名单的单选（`ReportReason`），不做自由文本——自由文本本身是 UGC，又要过一遍内容安全，本阶段不引入这条路径。
- [x] **验收**：miniprogram 测试全绿；`tsc --noEmit` 干净。

> **Task 12 实测**：miniprogram **41 套 / 513 例全绿**（Task 11 收尾是 40 套 / 504 例；+1 套 +9 例）。`tsc --noEmit` 干净。
> **两步而不是一步：先 `showActionSheet` 选原因，再 `showModal` 确认**。原因是必填的（服务端白名单校验），而举报不可撤销 —— 只弹一个确认框就发，等于让人在没选原因的情况下做一个撤不回的动作。
> **新建 `utils/report-view.ts`** 而不是把选项写在页面里：白名单与文案都从 `@paws/types` 派生（`REPORT_REASONS` / `REPORT_REASON_LABELS`），客户端**不排第二套顺序、不写第二份文案** —— 服务端校验的正是那个数组，两边分叉的后果是用户选了个服务端不认的原因（422）。`reasonAt` 按下标反查，所以「顺序一致」这件事有断言钉着。
> **`reasonAt` 越界回 `null`，不猜默认原因**：猜「其他」会让一条本该失败的举报以错误的原因落库，而排查时看到的原因是错的 —— 报错的原因比报错本身更难查。
> **`ACTION_SHEET_MAX_ITEMS = 6` 有专门一条断言**：白名单恰好 6 项，正是 `wx.showActionSheet` 的上限。再加一种原因就装不进了，那条断言会在那一刻变红，提醒改成自定义选择器而不是静默截断。
> **回调式 API 包成 Promise，且 `fail` 分支也要 resolve**：用户点蒙层关掉 action sheet 时走的是 `fail` 而不是 `success` —— 漏了它那条 Promise 永远不 settle，`reportingId` 就再也复位不了，按钮永久禁用。这是本任务唯一一处真正会咬人的细节。
> **提示语是「已提交复核」**：内容并没有被删掉，只是撤下等运营复核，复核通过还会回来。说「已删除」是在向用户撒谎。
> **本轮第四次同款陷阱**：`expect(ts).not.toContain('已删除')` 被**解释这件事的注释**撞红（注释里写着「不是『已删除』」）。同 Task 6 / 10 / 11。改成断言真实的 toast 调用形状（`/showToast\(\{\s*title:\s*'已提交复核'/`）。另一条 `not.toContain('loadPage')` 也踩了相邻的坑 —— 切片切到文件尾，把 `loadPage` 自己的定义包进去了，改成切到下一个方法为止。

---

## 收口

### Task 13: 全量回归 + 真库走查 + 验收记录

- [x] 四套回归全绿：server 真库+真 Redis、server 无库无 Redis、miniprogram、`@paws/types`。
      **三套全绿，真库那套未执行** —— 本环境没有 `server/.env`，见 notes 第三节。
- [x] 三处 `tsc --noEmit` 干净 + `npm run build` 通过。
- [x] **真 HTTP 走查**：新增 `server/test/manual/phase3-walkthrough.mjs`，覆盖：普通用户举报一条 `approved` 动态 → 三种身份各验一次可见性 → 运营拿工单列表 → 复核通过 → 重新可见 → 再举报一次 → 复核驳回 → 作者看到驳回原因 → 全程核对 `audit_log` 的流水条数与内容。**不被 jest 收集**（`testMatch` 只匹配 `**/test/**/*.spec.ts`），且**有意在库里留数据**——所以断言里不许写死全表行数（这个坑踩过两次，commit `48fab02` 与 `9475fdf`）。
      **脚本已写好并通过 `node --check`，但未执行**（要真库 + 真 Redis + moderator 账号）。
- [x] 写 `docs/superpowers/phase3-notes.md`：自动化回归结果表、走查记录、暴露的限制、**与本计划的所有有意偏差**、留给阶段 4 的清单。必须记进去的既有账：`phone_enc` / `pgcrypto` 从未实现、`pet_photos` 没有 `audit_status` 且宠物照片不过机审、私信本体因资质挂起。
- [x] notes 里另记**本阶段开工前的 Skyline 滚动修复**（11 个实页套 `scroll-view`、`onPullDownRefresh`/`onReachBottom` 迁到容器属性、新增 `test/page-scroll.spec.ts` 全页面守卫）：它不在本计划范围内，是执行前发现「页面根本滑不动」临时插入的。**限制**：本环境起不了微信开发者工具，真机滚动手感、`refresher` 动画、compose 页键盘弹起时的推挤都未验证。
- [x] `RELEASE_CHECKLIST.md` 追加：运营账号的 `role` 必须在生产库里手工授予（不能靠种子，`SEED_DEMO_DATA` 在生产是关的）；`audit_log` 的备份与保留策略（合规流水，不可随库一起清）。
- [ ] 按任务粒度提交，中文提交信息，前缀 `feat/fix/test/docs/chore`。**只在明确要求时提交**。

> **Task 13 实测**（三套，无库无 Redis）：
> · server **43 套绿 / 6 skip，450 绿 / 125 skip / 575 例**
> · miniprogram **41 套 / 513 例全绿**
> · `@paws/types` **6 套 / 82 例全绿**
> · 三处 `tsc --noEmit` 干净；`npm run build` 通过（types → dist，server → dist 含 `*.sql` 拷贝）
> · 走查脚本 `node --check` 通过，且确认**不被 jest 收集**（`--listTests` 49 个全是 `.spec.ts`）
>
> **真库那一套与走查都没跑** —— `server/.env` 不在这份工作树里。notes 第三节逐条列出了
> 因此**一次都没在真 Postgres 上执行过**的 7 处代码（两条 CTE、多态 LEFT JOIN、
> `JOIN follows`、`findRole`、图片仓储方法、可见性第 6/7 组）。这是本阶段最大的未闭合项。
>
> **走查脚本里内建了一处限制说明**：`FAKE_CONTENT_SECURITY=1` 时没有任何内容会自动过审，
> 而举报要求内容当前可见 —— 两条叠起来使**完整闭环在假实现下走不完**。脚本检测到这点
> 会打印说明并提前返回，不报失败。这条也写进了 `RELEASE_CHECKLIST.md`。
>
> **`RELEASE_CHECKLIST.md` 比计划多加两条**：提审前必须关掉假内容安全并用正式 AppID
> 真跑一次机审；`POST /reports` **目前没有限流** —— 一个账号可以把整页内容逐条举报，
> 每条都会立刻对所有人隐藏。那是本阶段最明显的滥用面，也进了阶段 4 清单。

---

## 附录 A：建表语句

```sql
-- 审核动作的不可变流水。spec §4.4：与 moderation_tasks 不可互相替代 ——
-- 那张是队列，这张是流水；队列会被更新，流水只追加。
--
-- actor_id 与 target_id 都不挂外键，理由不同：
--   actor_id：流水必须比它记录的主体活得久。ON DELETE SET NULL 会改写一条
--     本该不可变的记录，RESTRICT 会让有审核历史的用户永远删不掉。
--   target_id：目标是多态的（post / post_image 两张表），同 favorites/view_history。
-- 机审的流水 actor_id 为 NULL —— 那不是人做的动作。
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  actor_id TEXT,
  action TEXT NOT NULL
    CHECK (action IN ('report','review_approve','review_reject','auto_approve','auto_reject')),
  target_type TEXT NOT NULL CHECK (target_type IN ('post','post_image')),
  target_id TEXT NOT NULL,
  status_before TEXT NOT NULL
    CHECK (status_before IN ('pending','approved','pending_review','rejected')),
  status_after TEXT NOT NULL
    CHECK (status_after IN ('pending','approved','pending_review','rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_log_target_idx ON audit_log (target_type, target_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_actor_idx ON audit_log (actor_id, created_at DESC);

-- 待处理的审核工单。result IS NULL 即待处理。
-- source 保留 spec §4.4 的三个值，但本阶段机审不入队（机审当场就有结论，
-- 入队等于建一条立刻要关掉的工单）。
CREATE TABLE IF NOT EXISTS moderation_tasks (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL CHECK (target_type IN ('post','post_image')),
  target_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('wx_auto','user_report','manual')),
  reported_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  reason TEXT,
  result TEXT CHECK (result IN ('approved','rejected')),
  handled_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  handled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- 举报幂等的实现（Global Constraint 27）：同一目标同时只能有一条未处理工单。
-- 部分索引而不是整表唯一 —— 同一条内容可以被举报、复核、再被举报第二次。
CREATE UNIQUE INDEX IF NOT EXISTS moderation_tasks_open_target_idx
  ON moderation_tasks (target_type, target_id) WHERE result IS NULL;
CREATE INDEX IF NOT EXISTS moderation_tasks_queue_idx
  ON moderation_tasks (created_at) WHERE result IS NULL;
```

`reported_by` 与 `handled_by` **挂**了外键（`ON DELETE SET NULL`）：工单是队列不是流水，运营账号注销后把工单上的指针置空是可接受的，而队列本身不承担合规留痕的职责——那是 `audit_log` 的事。这与 `audit_log.actor_id` 不挂外键的取向不矛盾，两张表的职责不同。

## 附录 B：`users.role` 的迁移写法

```sql
-- 运营角色。RBAC 的最小落法（spec §3.1 的运营后台复用同一 API + RBAC 隔离）。
-- 只增一列，不改任何既有列的类型或约束，符合 Global Constraint 22。
-- 既有 8 个种子用户自动落 'user'。
--
-- CHECK 写成**列级**约束跟在同一句里，不另开 ADD CONSTRAINT：
-- ADD CONSTRAINT 没有 IF NOT EXISTS，重跑会报重复，而列级 CHECK 跟着
-- ADD COLUMN IF NOT EXISTS 一起幂等 —— 列已存在时整句跳过，不会重复加约束。
-- 已在远程库上用临时表实测：重跑两次约束数不变（都是一条
-- 自动命名的 users_role_check），且非法值被拦（SQLSTATE 23514）。
ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user'
  CHECK (role IN ('user','moderator','admin'));
```

约束的存在性如果将来真要单独判，查 `pg_constraint`（`conrelid = 'users'::regclass AND contype = 'c'`）而不是 `information_schema.constraint_column_usage`——后者对复合主键会返回重复行，且它描述的是「约束引用了哪些列」，对 CHECK 的语义依版本而变。`information_schema.check_constraints` 也可以，但拿不到表名，得再 join 一次。

角色**不进 JWT**：令牌是阶段 0 签的，里面没有角色字段；而把角色塞进令牌会让「撤销运营权限」要等到令牌过期才生效（`JWT_TTL_SECONDS`）。每次复核多一次 O(1) 查询，换的是即时可撤销。



