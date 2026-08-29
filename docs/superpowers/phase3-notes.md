# 阶段 3 验收记录：内容审核与关注流

计划：`docs/superpowers/plans/2026-08-26-phase3-moderation-feed.md`（13 任务，实际执行 13 项 + 1 项计划外补入）
分支：`main`　执行方式：inline TDD（每任务 RED → GREEN）
本轮模式：**无库无 Redis**。这与阶段 1/2 不同，是本轮最重要的限制 —— 详见第三节。

## 一、自动化回归

| 包 / 环境 | 结果 |
| --- | --- |
| server（无库 + 无 Redis） | **43 suites / 450 tests 绿，6 suites / 125 tests 按门控 skip**（共 49 套 / 575 例） |
| server（真库 + 真 Redis） | **未执行** —— 本环境没有 `server/.env`，见第三节 |
| miniprogram | **41 suites / 513 tests 全绿** |
| `@paws/types` | **6 suites / 82 tests 全绿** |
| `tsc --noEmit` | server / miniprogram / `@paws/types` 三处干净 |
| `npm run build` | 通过（`@paws/types` → `dist`，server → `dist` 含 `*.sql` 拷贝） |
| guard suites | miniprogram 侧 style-guard / module-guard / wx-guard / app-json / sync-types / page-scroll，server 侧 audit-literal-guard 与改造后的 feed 可见性守卫，全绿 |

各任务收尾时的增量（无库模式，便于核对每一步真的加了断言）：

| 任务 | server | miniprogram | types |
| --- | --- | --- | --- |
| 基线（Task 3 收尾） | 39 绿 / 6 skip，393+120=513 | 38 套 / 477 | 5 套 / 79 |
| Task 4 举报端点 | 40 绿，406+121=527 | — | — |
| Task 5 ModeratorGuard | 41 绿，414+121=535 | — | — |
| Task 6 复核端点 | 42 绿，431+121=552 | — | — |
| Task 7+8 feed 与守卫 | 43 绿，445+125=570 | — | — |
| Task 9 api 包装 | — | 39 套 / 483 | — |
| Task 10 feed 页面 | — | 40 套 / 496 | — |
| Task 11 关注开关 | 43 绿，450+125=575 | 40 套 / 504 | 6 套 / 82 |
| Task 12 举报入口 | — | 41 套 / 513 | — |

跳过的 125 条全部是 Postgres / Redis 集成用例，走 `describeDb = DB_URL ? describe : describe.skip`
门控，无库时不产出任何断言 —— 不是失败，也不是假绿。

## 二、演示走查

**未执行。** 走查脚本 `server/test/manual/phase3-walkthrough.mjs` 已写好（`node --check`
通过、`testMatch` 只匹配 `**/test/**/*.spec.ts` 所以不被 jest 收集），但它要求真库 +
真 Redis + 一个 `role=moderator` 的账号，本环境三样都没有。

脚本本身覆盖：三身份登录 → 建宠物发动态 → **举报拒绝路径**（举报 pending 的 / 不存在的
必须 404 且响应一字不差、未知 `target_type` 42204、非白名单原因 42200、未登录 401）→
完整闭环（举报 → 三身份可见性 → 幂等重复举报 → 普通用户看工单 403 → 运营取工单列表
→ 复核通过 → 重新可见 → 同一工单再复核 42205 → 再举报产生**新**工单 → 复核驳回 →
作者看到驳回原因、他人 404）→ 关注流（空列表不是 404、关注后混排、rejected 不进 feed、
自己的动态不进自己的 feed、未登录 401）→ `isOwn`。

**脚本里内建了一处限制说明，值得单独记**：`FAKE_CONTENT_SECURITY=1` 时**没有任何内容
会自动过审**（刻意不放行，Global Constraint 17），而举报要求内容当前可见（`approved`）。
两条规则叠起来的后果是：**完整闭环在假实现下走不完** —— 内容停在 `pending`，举报按
Global Constraint 26 返回 404。脚本检测到这一点会打印说明并提前返回，而不是报失败。
要走完必须关掉假实现、用正式 AppID 真跑机审，或先手工 `UPDATE posts SET audit_status`。
这不是缺陷，但提审前的真跑必须走完这一段。

## 三、本轮最重要的限制：真库分支一次都没跑过

`server/.env` 在这份工作树里**不存在**（只有 `.env.example`），所以 `DATABASE_URL` /
`REDIS_URL` 未设，所有 DB 门控套件一律 skip。阶段 1/2 笔记里那些 44–45 套 / 495–513 例
的真库数字，本轮**无法复现**。

具体说，下面这些代码**只经过编译与无库模式验证，没有在真 Postgres 上执行过一次**：

1. **举报的单条 CTE**（`PostgresModerationRepository.report`）—— 三件事原子完成那条语句，
   包括 `ON CONFLICT (target_type, target_id) WHERE result IS NULL DO NOTHING` 撞部分
   唯一索引的行为、`WHERE EXISTS (SELECT 1 FROM queued)` 把状态迁移与流水挂在入队之上。
2. **复核的拿票 CTE**（`PostgresModerationRepository.resolve`）—— 带条件 UPDATE
   （`AND result IS NULL`）的并发语义，以及 `TARGET_RESOLVE_UPDATE` 里 `posts` 与
   `post_images` 两支参数编号的对齐。
3. **工单列表那条多态 LEFT JOIN**（`SELECT_OPEN_TASKS`）—— 两组 LEFT JOIN 摊平
   `post` / `post_image`、`json_build_array(pi.url)` 与 `json_agg` 两支的分叉。
4. **feed 的 `JOIN follows`**（`PostgresPostRepository.listFeed`）。
5. **`findRole` 的 `SELECT role FROM users`**（无库模式走的是注入的角色种子）。
6. **`findImageById` / `setImageAuditStatus`** 的 Postgres 实现。
7. **可见性套件的第 6、7 组**（举报翻转可见性、feed 可见性）—— 两组都是真库门控。

提审前必须在有 `.env` 的机器上补跑一次带库回归 + 走查。这是本阶段最大的未闭合项。

## 四、与计划的有意偏差

### 1. 抽出两个「只提供仓储」的模块（Task 4 / Task 7）

`ModerationModule` 在无库模式下要拿动态仓储当举报目标源，而 `PostsModule` 已经 import
了 `ModerationModule`（它要机审裁决）—— 反向再 import 就成环。照 `PetRepositoryModule`
的既有做法抽出 `PostRepositoryModule`；Task 7 同理抽出 `FollowRepositoryModule`
（无库 feed 要问「这个人关注了哪些宠物」，而 `FollowsModule` 带着依赖宠物仓储的
`FollowsService`）。

**不能各建一个工厂**：那等于两份内存数据。Task 4 第一次就是这么挂的 —— 举报改了这边的
状态，`GET /posts` 读的是那边的，7 例红，症状是「状态迁了但查不到」。

### 2. 举报的幂等判定放在可见性判定**之前**（Task 4）

计划第 4 条的字面顺序是「先判可见性，再判状态机」，幂等分支没有明确位置。实现放在了
可见性之前，结论一致但顺序不同，理由：内容一旦被举报就迁到 `pending_review`、
**对举报人自己也不可见了**。先判可见性会让重复举报拿到 404 —— 等于告诉举报人
「刚才那次没成功」，而实际上成功了。

泄露面被限死在「这条 id 正在复核中」这一位信息上：不回内容、不回工单 id、不回举报人，
响应与新建工单时完全一致。而队列里有工单必然意味着真有人举报过它（机审不入队），
所以探测者拿不到「任意 id 是否存在」。代码里注明这是 Global Constraint 26 上一处
**有意的例外**。

### 3. `PetDetail.isOwn` 是服务端新加的字段（Task 11）

计划假设 `buildDetailView` 能自己算出「是不是我的宠物」。**算不出来** —— 客户端拿不到
主人是谁：`PetDetail` 只有 `owner.{nickname, avatarUrl, ownerVerified}`，`ownerId`
刻意不下发（`PetRepository.findOwnerId` 的注释就写着这条），而会话里存的 `userId`
跟昵称对不上。

所以由服务端算：新增 `PetDetail.isOwn: boolean`，`PetsService.detail` 多接一个
`viewerId`，用既有的 `findOwnerId` 比对。**下发布尔值而不是 `ownerId`** —— 客户端要判的
本来就只是「是不是我」，把主人的用户 id 放进公开响应是白扩攻击面。改动跨三个包
（types → server → miniprogram），走 `npm run sync:types` 同步。

### 4. Task 8 的守卫判据换了实现方式

计划说「扫本文件自身的源码，按标题正则匹配」判断 feed 可见性断言是否存在。**那样写会
立刻空转** —— 判据的正则本身就写在这个文件里，扫自己一定命中，守卫永真。

改成让第 7 组**自注册**：组内一行 `feedVisibilityAsserted = true`，守卫读这个标志。
`describe` 的回调在收集阶段就执行（`describe.skip` 也一样，它只把里面的 `it` 标成
跳过），所以无库模式下那一组整组 skip、标志照样置上 —— 守卫与门控无关，两种模式都跑。
组被删掉或改名，标志不会置上，守卫立刻红。另加一条「本阶段确实有 feed 路由」钉住蕴含式
的前件为真，避免它退化成永真。

### 5. 计划外补做的实现细节

- **`PostRepository.findImageById` / `setImageAuditStatus`**（Task 4）：`target_type`
  白名单含 `post_image`，不加这两个方法那一半目标类型在无库模式下根本无从下手。
- **`reportImage`**（Task 9）：客户端侧同理。两个具名函数各写死一个 `targetType`，
  **不把它开放给页面传** —— 传错类型在服务端是 422，那种错重试也没用。
- **驳回必须写原因**（Task 6）：`rejected` 而 `rejectReason` 为空 → 422。作者能在
  「我的动态」看到这个原因，空着等于告诉他「被撤了但不告诉你为什么」。放行时反过来把
  传进来的原因**丢掉** —— 留着只会显示一条陈旧的驳回理由。
- **`AuthModule` re-export `UsersModule`**（Task 5）：守卫是**宿主模块**的 injectable
  —— `@UseGuards(...)` 写在谁的 controller 上，Nest 就在谁的注入上下文里造实例。
  `AuthGuard` 没有依赖所以这件事一直没人察觉，而 `ModeratorGuard` 要仓储，不 re-export
  的话每个挂运营端点的模块都得自己再 import 一遍 `UsersModule`，漏一个就是启动时才炸。
- **`utils/report-view.ts`**（Task 12）：选项从 `REPORT_REASONS` /
  `REPORT_REASON_LABELS` 派生，客户端不排第二套顺序、不写第二份文案。`reasonAt` 按下标
  反查，越界回 `null` 而**不猜默认原因** —— 猜「其他」会让举报以错误原因落库，
  排查时看到的原因是错的。

### 6. 「不存在」与「已被处理」分成 404 与 422（Task 6）

与举报那条路径的取向**相反**：那里分开会泄露内容存在性，而这里调用方是运营 ——
他手上的工单 id 本来就是列表给的，把「你点的这条别人刚处理完」告诉他才是对的。

### 7. 空态判据用三态而不是两态（Task 10）

feed 页的 `followingCount`：`0` = 一只都没关注（引去广场）、`>0` = 关注了但他们没发过
（引去关注列表）、`-1` = **还没取到**，两种空态都不显示。第一版写 `!followingCount`
把「还没取到」和「一只没关注」混成同一支 —— 那会在首屏闪一下「还没有关注任何宠物」，
而用户可能关注了一堆。

## 五、四次踩同一个坑：文本级断言撞上自己的说明文字

本轮有四处测试自身的返工，同源同因，值得单列一节 —— 这类断言在**结构守卫**里很常见，
而它的失败模式是「断言红了但被测代码是对的」，最容易被误判成实现缺陷。

| # | 任务 | 断言 | 撞在什么上 | 改法 |
| --- | --- | --- | --- | --- |
| 1 | Task 6 | `audit-literal-guard` 扫 `result === 'rejected'` | 解释这件事的**注释**里写了那个比较写法 | 改成 `REVIEW_OUTCOME` 查表，`raw in REVIEW_OUTCOME` |
| 2 | Task 10 | `expect(ts).not.toContain('petId')` | 注释「feed 不吃 petId」 | 断言调用形状 `/fetchFeed\(\{\s*page,\s*pageSize/` |
| 3 | Task 11 | `/finally\s*\{\s*this\.setData/` | 夹在中间的一行注释 | 正则里容一行注释 |
| 4 | Task 12 | `expect(ts).not.toContain('已删除')` | 注释「不是『已删除』」 | 断言真实 toast 调用形状 |

第 4 条相邻还有一处：`not.toContain('loadPage')` 的切片切到了文件尾，把 `loadPage`
自己的定义包了进去 —— 改成切到下一个方法为止。

**教训**：文本级断言的作用域要么切准（到下一个方法为止），要么断言**调用/语法形状**
而不是「源码里没有这几个字」。注释是源码的一部分。

## 六、其他实现细节里的坑

1. **`Object.hasOwn` 不能用**：项目 tsconfig 的 target 还在 ES2021，`tsc` 报 TS2550。
   改用 `in`（`REVIEW_OUTCOME` 是本文件的字面量对象，原型链上没有可撞的键）。
2. **非 ASCII 放不进 HTTP 头**：`moderator-guard.spec.ts` 里断言「令牌乱值」原本写
   `Bearer 不是令牌`，superagent 直接抛 `Invalid character in header content`。
3. **测试套件不 import `AuthModule`**（`moderator-guard.spec.ts`）：它带着
   `RateLimitModule` → Redis 客户端，本套件与限流无关，而那条依赖在无 Redis 环境下会让
   套件卡在重连上跑不完（第一次这么写超时 31s 挂掉）。改成
   `imports: [UsersModule] + providers: [AuthGuard, ModeratorGuard]`，同
   `auth-guard.spec.ts` 的做法。
4. **回调式 wx API 包 Promise 时 `fail` 分支也要 resolve**（Task 12）：用户点蒙层关掉
   `showActionSheet` 走的是 `fail` 而不是 `success` —— 漏了它那条 Promise 永远不 settle，
   `reportingId` 再也复位不了，按钮永久禁用。
5. **`ACTION_SHEET_MAX_ITEMS = 6` 有专门断言**：举报原因白名单恰好 6 项，正是
   `wx.showActionSheet` 的上限。再加一种原因就装不进了，那条断言会在那一刻变红，
   提醒改成自定义选择器而不是静默截断。
6. **`onGoPlaza` 用 `wx.switchTab`**：广场是 tab 页，`navigateTo` 到 tab 页**静默失败**
   （不报错、不跳转），那种失败在真机上最难查。
7. **举报/关注不做乐观更新**：关注态是 feed 的入口条件，显示成功而实际没写进去，
   用户会以为 feed 该有内容却一直空着。所以先等服务端回，再改本地态；而且写回的是
   **服务端返回的那个值**，不是本地推算的 —— 两者理应一致，真不一致时该显示库里的事实。
8. **一处返工**：举报的 CTE 原先写成 `TARGET_UPDATE[type].replace('$2','$6')`，用字符串
   替换给绑定参数重编号。参数顺序一动就静默错位，而错位的后果是「状态迁到了错的值」。
   改成定值表只存表名，`UPDATE` 整句连参数号一起写在 CTE 里。

## 七、本阶段开工前的 Skyline 滚动修复（不在计划范围内）

执行 Task 4 之前发现**页面根本滑不动**，临时插入的修复：11 个实页套 `scroll-view`、
`onPullDownRefresh` / `onReachBottom` 迁到容器属性、新增 `test/page-scroll.spec.ts`
全页面守卫。commit `d81974a`。

原因：Skyline 不提供全局滚动，页面级的 `enablePullDownRefresh` /
`onReachBottomDistance` 没有载体，那两个页面级回调不会被触发。

**限制：本环境起不了微信开发者工具**，所以下面三样都**未验证**：
真机滚动手感、`refresher` 动画、compose 页键盘弹起时的推挤。

## 八、既有未闭合的账（跨阶段结转，本阶段未动）

1. **`phone_enc` / `pgcrypto` 从未实现。** spec 要求手机号加密存储，实际没有这一列，
   也没装 pgcrypto。
2. **`pet_photos` 没有 `audit_status`**，宠物照片**不过机审**。spec §4.1/§4.5 声称有，
   实际没有。宠物相册的安全边界目前只由取图路由兜着（私有档对他人 404）。
   这也是 `MODERATION_TARGET_TYPES` 里没有 `pet_photo` 的原因 —— 没有状态可撤。
3. **私信本体因类目资质挂起。** `packages/chat` 分包与 `messages` 表在，端点不在。
4. **`PetDetail` 在服务端有第二份定义**（`pets.service.ts` 里的本地 interface，与
   `packages/types` 那份形状一致但各自独立）。这是既有结构，本轮 Task 11 只跟着加了
   同一个字段（`isOwn`）。两份定义漂移是既有风险，没有守卫钉住。
5. **锁定依赖树 76 个 `npm audit` 漏洞告警**（4 low / 18 moderate / 12 high /
   42 critical），未处理（`npm audit fix` 是明确禁止的操作）。

## 九、留给阶段 4 的清单

1. **补跑真库回归 + 走查**（第三节那 7 项）。这是最高优先级，其余都排在它后面。
2. **运营侧的界面**：本阶段只有 API（`GET /moderation/tasks` +
   `POST /moderation/tasks/:id/resolve`），没有任何页面。运营目前只能用 curl。
3. **图片举报的客户端入口**：`reportImage` 的 api 包装在，但没有页面调用它 ——
   feed 卡片上只有「举报整条动态」。图片举报要先有一个能长按某张图的交互。
4. **`pet_photos` 的审核状态**（既有账 2）：要么补上那一列并接机审，要么在 spec 里
   明确记为不做。当前状态是「文档说有、实际没有」，这种不一致比任一选择都差。
5. **举报的限流**：`POST /reports` 目前没有限流。一个人可以把整页内容全举报一遍，
   每条都会让内容立刻对所有人消失（直到运营复核）。这是本阶段最明显的滥用面。
6. **工单列表的筛选与排序**：目前只有「未处理、按时间正序」一种。真实运营会要按
   `reason` 筛、按目标类型筛。
7. **审计流水的查询入口**：`AuditLogRepository.listByTarget` 只能按目标查，没有
   「某个运营做过什么」的入口（`audit_log_actor_idx` 索引已经建好了，就等一个端点）。
