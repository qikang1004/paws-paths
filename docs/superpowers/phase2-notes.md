# 阶段 2 验收记录：身份与社交

计划：`docs/superpowers/plans/2026-08-24-phase2-identity-social.md`（16 任务）
分支：`db-integration`　执行方式：inline TDD（每任务 RED → GREEN → 提交）
本轮模式：**带真库真 Redis**。远程 PostgreSQL 16 + PostGIS 与 Redis 全程可用，
阶段 1 里按门控跳过的集成用例这轮全部真跑；无库无 Redis 的降级模式另跑一遍。

## 一、自动化回归

| 包 / 环境 | 结果 |
| --- | --- |
| server（真库 + 真 Redis） | **44 suites / 485 tests 全绿**（117.9s） |
| server（无库 + 无 Redis） | **38 suites / 383 tests 绿，6 suites / 102 tests 按门控 skip** |
| miniprogram | **37 suites / 421 tests 绿** |
| `@paws/types` | **5 suites / 56 tests 绿** |
| `tsc --noEmit` | server / miniprogram / `@paws/types` 三处干净 |
| `npm run build` | 通过（`@paws/types` → `dist`，server → `dist` 含 `*.sql` 拷贝） |
| guard suites | miniprogram 侧 style-guard / module-guard / wx-guard / app-json / sync-types，server 侧 audit-literal-guard 与 `post-visibility.security` 末尾那条 feed 路由守卫，全绿 |

跳过的 102 条全部是 Postgres / Redis 集成用例，走的是 `describeDb = DB_URL ? describe : describe.skip`
门控，无库时不产出任何断言 —— 不是失败，也不是假绿。

**带库回归暴露了四处只在并发 + 真实数据下才出现的问题**，都不是被测代码的缺陷，
但都会让回归随机变红，所以一并修在了测试基础设施里（前三条是提交 `48fab02`，
第 4 条是走查跑过几遍之后才浮出来的）：

1. **默认 5000ms 兜不住多往返的用例。** 远程库单次热连接 ~600ms，一个 `beforeEach`
   建号 + 建宠物就四五次往返。原先靠各套件自己写 `jest.setTimeout(30_000)`，
   碰库的套件漏一个就在带库回归里红一次（第一遍带库跑就是这么红的，一片钩子超时）。
   这是**环境属性不是套件属性**，收进 `server/jest.config.js` 的 `testTimeout`。
2. **全表计数断言会随并行邻居起伏。** 「种子后 8 只宠物」那类断言只能数种子前缀行
   （`WHERE id ~ '^p-[0-9]+$'`）—— `pet-write` / `my-pets` 那几个套件正在建自己的
   测试宠物，写死全表行数就是让断言依赖别人的进度。
3. **「迁移幂等」不能在用例里重跑迁移。** `schema.sql` 的 DDL 要 ACCESS EXCLUSIVE 锁，
   而 43 个邻居套件正在同几张表上开事务，两边等成环 → `error: deadlock detected`
   （两轮全量回归都复现，单跑该套件永远绿）。迁移里的咨询锁只让**多次迁移**互相排队，
   管不住普通业务流量。证据因此拆成两半：「重复执行不报错」搬到 `test/global-setup.ts`
   连跑两遍（整轮唯一没有并发的时刻，报错就是全局 setup 失败），「种子没被灌重」
   留在套件里按 id 集合断言。
4. **`GET /pets` 的两条断言写死了「全库正好 8 只」。** 阶段 2 让宠物变成用户可建的，
   于是走查每跑一遍 pets 表就长一只 —— 第一次带库回归绿，是因为它跑在走查之前。
   连带暴露出两处更细的东西，两条断言现在都按它们重写：
   - **不给坐标时距离一律为 null**（排序退回 `last_active_at`）。原来那条
     「首项距离最近」的排序断言跑的正是不带坐标的路径，全是 null 的数组永远「有序」，
     它其实什么都没验。排序契约挪到带 `lat`/`lng` 的那条上。
   - **用户建的宠物可以没有位置**（偏差 #38：填资料的路上不弹定位授权框），
     所以带坐标时距离列里会有 null。它们必须排在最后 —— Postgres `ORDER BY ... ASC`
     的 NULLS LAST 与 InMemory 的 `?? +Infinity` 是同一个约定，现在两边都被断言钉住了。
   计数则改成与取数同一套过滤（`public` + 有封面）后查真实总数再比 —— 没有封面的
   宠物被 `JOIN pet_photos` 挡在页外，而新建的宠物在传第一张照片之前正是这种状态。

## 二、演示走查（真库 + 真 Redis，实际 HTTP）

服务以 `PORT=3100` + `.env`（真 `DATABASE_URL` / `REDIS_URL`）+ `FAKE_WECHAT_LOGIN=1`
+ `FAKE_CONTENT_SECURITY=1` 启动。走查脚本 `server/test/manual/phase2-walkthrough.mjs`
按用户真实路线串 31 步，每步打印真实响应，关键处内联断言（失败即中断）。
每轮用带时间戳的 code 换一对新用户 —— 走查会改昵称、建宠物、发动态，复用同一个用户
跑第二遍时「新用户昵称是占位值」这类断言必然假红。

**登录 → 个人中心**
两个 code 换到两个 `isNewUser: true` 的用户。未登录 `GET /me` → 401 `40100`。
改名前昵称是占位值「微信用户」、三个计数全 0。`PUT /me` 改昵称 + 头像后回读生效；
昵称 21 字 → 422「昵称最多 20 个字」；一个可改字段都不给 → 422「没有需要更新的字段」。

**建宠物**
`POST /pets` 只给名字与物种（外加可选的品种/性别/简介）→ 返回 `p-<uuid>`；
不给生日落建号当天（`birthDate: 2026-08-26`，年龄显示 0，主人一眼看得出要补）。
`species=all` → 422「物种只能是 dog / cat / other」（`all` 是筛选用的伪物种）。
`GET /me/pets` 回来的清单**没有 `hasMore`**（刻意不分页）且**含这只没有封面的新宠物**；
`GET /pets/:id` 对它 200、`photos: 0` —— 详情页必须打得开，否则主人没有入口传第一张照片。

**传图**
`POST /uploads`（multipart + `width=800`/`height=600`）→ `{key, url, width, height,
auditStatus: 'pending'}`。**`pending` 不是 `approved`** —— 假实现刻意不放行。
不给宽高 → 422「必须提供图片的真实宽高」；把 shell 脚本改名成 `.png` → 422
「只能上传 JPG / PNG / GIF / WEBP 图片」（按魔数嗅探，不听客户端报的 MIME）。

**待审图片的三种身份**（过审必要条件，这条最关键）
作者本人 200 且响应头是 `Cache-Control: private, no-store`；其他登录用户 404 `40400`；
未登录 404 `40400`。403 与 404 不分开是有意的：分得开，这个差别本身就把
「这个 key 有东西」告诉了探测者。

`POST /pets/:id/photos` 把这张图挂上宠物 → 详情 `photos: 1`（800×600），
`GET /me/pets` 的封面指针同步指向它（第一张自动成为封面）。

**关注**
关注自己的宠物 → 422 `42203`「不能关注自己的宠物」。`POST /pets/p-2/follow` 两次都
200 `{isFollowing: true}`（幂等，不是 201、不是第二次报错）。关注不存在的宠物 → 404。
`GET /pets/p-2` 带登录态回读 `isFollowing: true`。`GET /me/following` → 1 只「奶昔」、
`hasMore: false`。

**收藏与浏览历史**
收藏一只宠物 + 一家场所 → `GET /me/favorites` 混排两条、按收藏时间倒序
（`venue:宠福康宠物医院`、`pet:可乐`）。看两个详情页后 `GET /me/history` 回三条
（`venue:有猫咖啡`、`pet:花花`、`pet:奶昔`），按 `viewed_at` 倒序 —— 「奶昔」是关注那步
顺带看的详情，历史是异步写的（不阻塞详情响应），所以走查里等了 600ms 再读。

**发动态**
空内容（三个空格）→ 422「说点什么再发吧」。正常发布 → `auditStatus: 'pending'`、
图片也是 `pending`、带 `petName`。拿别人的宠物发 → 403 `40300`「只能为自己的宠物发动态」。

**可见性（Global Constraint 16 的现场验证）**
`GET /posts?petId=<我的宠物>`：作者本人 1 条（`auditStatus: pending`，供角标用）、
其他登录用户 0 条、未登录 0 条，三者 `hasMore` 均为 `false`（过滤在 SQL 的 WHERE 里，
不是取完一页再筛，否则 `hasMore` 会指向一页永远取不出内容的幻影下一页）。
`GET /posts/:id`：作者 200（含 1 张图）、他人 404 `40400`「动态不存在」、未登录同样 404。

陌生人看种子数据 `GET /posts?petId=p-5` → 只回 `po-3:approved:1图`：
`po-5`（rejected）整条不可见，而 `po-3` 挂的两张图里 `pi-6`（pending）不返回、
`pi-4`（approved）与**文字照常显示** —— 图片与动态的审核状态各自独立。

**聚合计数**
走查末尾 `GET /me` → `petCount: 1 / followingCount: 1 / favoriteCount: 2`，与上面的动作对得上
（真库模式下是一条子查询算出来的，不是四次往返）。

## 三、本轮暴露的限制

1. **本地磁盘存储是单机限定的。** 多副本部署时每个实例只看得见自己那块盘，A 实例上传的
   图到 B 实例就是 404。`UPLOAD_ROOT` 默认落 `server/var/uploads`（已 gitignore），
   容器里随实例销毁。正式环境必须换对象存储（spec §10），`ImageStorage` 接口留在那儿
   就是为了这次替换只动一个 provider。
2. **待审图片没有表，统计只能扫盘。** 档位（`public`/`private` 目录）就是审核状态
   （偏差 #18），所以「待审图片有多少张」得递归列目录。阶段 4 换对象存储时状态会挪进
   `post_images`，那时才有表。
3. **机审只证明了链路接得上。** `FAKE_CONTENT_SECURITY=1` 跳过了真实的 `msgSecCheck` /
   `imgSecCheck`，微信那端的调用是否正确**没有验证过**。见下面第六节。
4. **没有人工复核入口。** 状态机的 `approved → pending_review`（已公开内容被举报后撤下）与
   `pending_review → approved/rejected` 三条边都在 `packages/types/src/audit.ts` 里定义、
   有单测覆盖，可见性侧也已经把 `pending_review` 当作对他人不可见来处理 ——
   缺的只是触发它的端点。举报与后台复核是阶段 3。
5. **没有关注流。** 动态只有「某只宠物的列表」与「详情」两条读路径。`GET /me/feed`
   不在 spec §8 阶段 2 的完成标志里，且本阶段无消费者。有一条静态守卫盯着：谁加出
   feed 路由，那条会红并把人指回可见性断言（偏差 #30）。
6. **无库降级模式下三处失真**：个人中心的三个计数恒为 0（偏差 #5）、新建宠物的主人
   信息落占位值（#12）、收藏/关注/历史各自只在自己的内存仓储里。只影响演示，
   代价是不把四个仓储耦到一起。
7. **`POST /pets` 不给生日会落建号当天**（#11）。`pets.birth_date` 是阶段 1 的
   `DATE NOT NULL`，改列违反「迁移只增不改」，放成可空又要把两端的
   `PetSummary.birthDate` 变成可空。有意留下的瑕疵。
8. **`wx.request` 发不出 PATCH**，所以 `/me` 与 `/pets/:id` 各有一个 PUT 别名
   （#33）。语义仍是局部更新，两个动词共用同一份实现 —— 分两份实现的话
   「清空头像 vs 不动头像」这个语义迟早只在一个动词上是对的。
9. **远程库下的回归慢且对并发敏感**：全量带库跑 117.9s，`testTimeout` 要 30s；
   「迁移幂等」的证据只能在 `global-setup` 里取（见第一节第 3 条）。

## 四、与计划的偏差（全部有意）

### 1. `favorites` 表被原地改结构 —— 对 Global Constraint 22「只增不改」的有意例外

**背景**：spec §4.2 要求 `favorites` 是多态的 —— `(user_id, target_type, target_id)`，
`target_type IN ('pet','venue')`。阶段 1 实际建的是 `(user_id TEXT, poi_id TEXT)` 复合主键，
**只支持场所收藏**；宠物详情页的收藏心标（原型 `_2`）因此在阶段 1 从未落地。

**为什么不能「只增」**：新建一张 `favorites_v2` 再双写，等于让「同一个收藏」有两处真相，
而阶段 1 的场所收藏必须继续工作。旧表本身就是与 spec 的偏差，留着它没有任何消费者会受益。

**做法**（`server/src/database/schema.sql` 末尾新增的「既有表的迁移」段）：
建表语句直接写成多态形状（新库一步到位），旧库靠一个 `DO $$ ... END $$` 块迁移，
顺序是**加列 → 回填 `('venue', poi_id)` → `SET NOT NULL` → 上 CHECK → 换主键 → `DROP COLUMN poi_id`**。
任何一步提前都会让有数据的旧库迁移失败。

两个非显然的点，都在 SQL 注释里写了，这里再记一遍原因：

- 整段包在「`poi_id` 这列还在吗」的判断里。不只是为了幂等（迁移每次启动都重跑），
  更是因为**新库根本没有 `poi_id`**，而裸写的 `UPDATE favorites SET target_id = poi_id`
  会在语义分析阶段就因为列不存在而报错 —— 哪怕它永远不会被执行到。
  plpgsql 对没走到的分支不做名字解析，所以 `DO` 块挡得住，`IF` 之外的裸 SQL 挡不住。
- `schema.sql` 整体是一条多语句查询，跑在同一个隐式事务里 ——
  要么全成要么全滚回，不会留下「加了列但没换主键」的半截状态。

**验证**：`server/test/migrations.spec.ts` 断言 SQL 文本（新库形状 + 迁移语句顺序），
`server/test/postgres.integration.spec.ts` 在**真库**上断言迁移已落地
（列名、主键三元组、CHECK 生效、索引存在）。远程 Postgres 上的实际迁移已跑通：
旧的 `(user_id, poi_id)` 主键换成了三元组，`poi_id` 列已删除。

### 2. 收藏仓储从 `src/venues/` 搬到 `src/favorites/`

收藏在阶段 2 变成跨域的（宠物 + 场所），留在 `venues` 下会让 `PetsModule` 反向依赖 `VenuesModule`。
`FavoritesModule` 只 import 两个「仓储专用模块」（`PetRepositoryModule` / `VenueRepositoryModule`）
来做卡片投影，`PetsModule` / `VenuesModule` / `MeModule` 再 import 它 —— 与
`FollowsModule` / `HistoryModule` 同一套打断循环的方式，不需要 `forwardRef`。

`VenuesService` 仍然直接注入 `FAVORITES_REPOSITORY`（而不是绕 `FavoritesService`）：
它要的就是「给这一页 20 张卡批量打心标」，多一层没有收益，阶段 1 的
`venues.service.spec.ts` 也只需要改一行 import 路径。

顺带修掉一处 N+1 的隐患：阶段 1 的 `applyFavorites` 是「取出用户全部收藏 id 再 has()」，
现在改成 `favoriteIds(userId, 'venue', 这一页的 id)` —— 给 20 张卡打标不该把整个收藏夹拉进内存。

### 3. 「重复收藏」与「重复浏览」的时间语义刻意相反

`view_history` 是 `ON CONFLICT DO UPDATE SET viewed_at = now()`（再看一次要顶到最前），
`favorites` 是 `ON CONFLICT DO NOTHING`（再点一次心标**不该**让它在收藏列表里重排）。
两个仓储的内存实现也照此分叉，双跑契约测试里各有一条专门断言这件事。

### 4. `GET /me` + `PATCH /me` 挂在 `MeController` 上，没有新开 `UsersController`

计划 Task 8 的 GREEN 写的是「`UsersController`（当前只有 service）」。实际把两个端点
加在了既有的 `MeController` 上：路径本来就是 `/me`，与同文件的 `/me/following`、
`/me/history`、`/me/favorites` 同属「当前用户的数据」，共用类级 `@UseGuards(AuthGuard)`。
拆成两个 controller 会让同一个前缀的鉴权与路由散在两处，且第二个 controller 里
一定要把那句「这里没有一个端点能匿名访问」的约定再抄一遍 —— 抄漏就是越权。

`UsersService` 因此多了 `profile()` / `updateProfile()`，`MeModule` 多 import 一个
`UsersModule`。校验函数 `parseProfilePatch` 放在 `users.service.ts` 而不是 controller 里：
它是纯函数，和 `MeController` 里的 `parseListQuery` 一样能单独测，但它属于用户域的规则。

### 5. 无库模式下个人中心的三个计数恒为 0

`InMemoryUserRepository` 看不见 `pets` / `follows` / `favorites` —— 那是另外三个仓储。
要算真数就得把三者注进 `UsersModule`，即给内存实现加 6 个方法（其中 3 个在有库模式下
是死代码），只为让**演示降级模式**的计数好看。这不值那个耦合，所以 `findProfile`
直接返回 `petCount: 0 / followingCount: 0 / favoriteCount: 0`，并在代码里注明是有意的。

`test/profile.controller.spec.ts` 的「计数是真查出来的」一段因此用 `DATABASE_URL` 门控，
只在真库下跑；它插一只宠物、一条关注、两条收藏，断言 `1 / 1 / 2`，
并额外断言种子用户 `u-1` 的 1 只宠物 + 3 条关注不会漏进我的资料里。

### 6. `PATCH /me` 的「缺字段」与「显式 null」是两种语义

`COALESCE($2, nickname)` 那种写法分不出这两者 —— 客户端不传 `avatarUrl` 会被当成清空头像。
所以 `PostgresUserRepository.updateProfile` 按调用方真给了的字段动态拼 SET 列表
（列名是代码里的定值，不来自请求体，没有注入面），`parseProfilePatch` 也用
`'avatarUrl' in body` 而不是 `body.avatarUrl != null` 来判断。一个可改字段都没给 → 422：
静默 200 只会让客户端把字段名写错这种 bug 更难查。

昵称长度按**码点数**（`[...nickname].length`）而不是 `String.length`：后者一个 emoji 顶两格，
10 个 emoji 的昵称会被当成 20 字拦下。spec §5.1 说的是「20 字」。

### 7. 封面是 `pets.cover_photo_id` 一个指针，不是 `pet_photos.is_cover`

计划 Task 9 的 RED 写的是「`is_cover` 唯一性（一只宠物只能有一张封面）」。阶段 1 建的
`pet_photos` 里**没有** `is_cover` 列，封面是 `pets.cover_photo_id`。加列会撞 Global
Constraint 22（迁移只增不改），而且指针模型更强：「一只宠物只有一张封面」是结构决定的，
不需要唯一索引维持，也不存在「两行都为 true」这种可写坏的中间态。换封面就是改指针，
测试因此断言的是 `PATCH /pets/:id { coverPhotoId }` 的行为与「指向别人宠物的照片 → 422」。

`cover_photo_id` 上刻意没挂外键：挂了就得在删照片时先解指针再删行，多一次往返，
而 `removePhoto` 那条 CTE 已经在同一语句里把指针顶给下一张了。

### 8. 没有照片的宠物：进不了广场，但详情页必须打得开

广场卡片是照片打底的，没封面渲染不出来，所以 `list` / `listByIds` 保持 `INNER JOIN`
封面照片。`getById` 反过来走 **LEFT** JOIN + `COALESCE(ph.url, '')` —— 刚建好还没传照片的
宠物如果详情页 404，主人就再没有入口进去加第一张照片了。

顺带修掉一个此前无法触发的缺陷：`list` 的 `hasMore` 计数查询原先不看封面，
而取数那条 JOIN 会把无封面的宠物挡在页外。阶段 1 的种子每只宠物都有照片，所以这个
不一致一直没露头；Task 9 让「建了但还没传照片」成为常态后，它会让 `hasMore` 指向
一页永远取不出内容的幻影下一页。现在计数里补了
`AND EXISTS (SELECT 1 FROM pet_photos ph WHERE ph.id = p.cover_photo_id)`。

### 9. 硬删要手工清三张表：一张没级联，两张挂不上外键

`DELETE /pets/:id` 是硬删（本阶段无审计要求）。计划写的是「硬删 + FK cascade」，
但实际只有阶段 2 建的表能靠级联：

- `pet_photos.pet_id` 是**阶段 1** 的外键，没有 `ON DELETE CASCADE` —— 不先删照片
  直接删宠物会撞约束。
- `favorites` / `view_history` 是多态表（`target_type` + `target_id`），`target_id`
  上压根挂不了外键，级联无从谈起。留下的孤儿行会一直把个人中心的 `favoriteCount`
  撑高，指向一只已经不存在的宠物。
- `follows.target_pet_id`、`posts.*`、`post_images.post_id` 是阶段 2 的表，带级联，不用管。

所以 `remove` 是一个显式 `BEGIN`/`COMMIT` 事务，按 `pet_photos` → `favorites` →
`view_history` → `pets` 的顺序删。DB 门控的那条测试四张表各断言一次零行。

### 10. 照片增删压成单条数据修改型 CTE

`addPhoto`（插行 + 必要时设封面）和 `removePhoto`（删行 + 必要时顶封面）本来各是一个
四五次往返的事务。远程库热连接单次往返实测 ~200ms，`BEGIN`+一次查询+`COMMIT` 就 ~600ms ——
这两个方法在照片测试里被反复调用，把 `pet-write.controller.spec.ts` 顶到了 Jest 默认的
5000ms 之外，而且超时每次随机落在不同用例上（看起来像 flaky，其实是延迟）。

PostgreSQL 的 `WITH ... INSERT/UPDATE/DELETE` 子语句保证各执行一次、执行到底，
不管主查询有没有读它们的输出，因此原子性不用事务兜。一个坑：所有子语句看的是
**语句开始时的同一份快照**，所以 `removePhoto` 里挑「剩下的第一张」的子查询必须写
`id <> $1` 排掉正在删的那张 —— 快照里它还在。

该套件另外加了 `jest.setTimeout(30_000)`（同 `test/rate-limit-degradation.integration.spec.ts`
既有的 `30_000` 先例）：压到 1 次往返之后余量已经够，但一个用例二三十次往返摆在那儿，
默认值本来就不该指望。

### 11. `POST /pets` 不给生日就落建号当天

`pets.birth_date` 是阶段 1 的 `DATE NOT NULL` 且没有默认值，改列违反 Global Constraint 22，
放成可空还会连带把两端的 `PetSummary.birthDate: string` 变成可空。而建号那一刻主人手上
通常只有名字和物种，逼他填齐生日会把人挡在门外 —— 所以只有 `name` 与 `species` 必填，
没给生日就落 `todayIso()`：年龄显示成 0，主人一眼就看得出这里要补。这是个有意留下的
瑕疵，代码里注明了原因。

写入侧的物种白名单**不含 `all`**：那是筛选用的伪物种，不是一种宠物。`PATCH` 同样不收。

### 12. 无库模式下新建宠物的主人信息落占位值

`InMemoryPetRepository` 看不见 `users`（那是另一个仓储），所以 `create` 落
`ownerNickname: '微信用户'`、`ownerAvatarUrl: null`、`ownerVerified: false`。与上面第 5 条
（三个计数恒为 0）同一取向：只影响演示降级模式，不值得为它把两个仓储耦起来。

内存实现另外改成了**实例级的种子可变副本**（`PET_SEED.map(...)`）—— 写端点会改这两个
数组，直接改模块级常量的话，同一进程里的下一个测试套件会看到上一个套件建的宠物。
封面指针连着 `coverUrl` / `coverWidth` / `coverHeight` 三个冗余字段一起挪（Postgres 侧
靠 JOIN 拿到，内存侧只能手工同步），这件事由私有的 `setCover` 一处负责。

### 13. `src/moderation/` 装的是内容安全接缝，不是状态机

Global Constraint 15 把状态机的唯一实现点写成 `server/src/moderation/audit-state.ts`。
实际它在 `packages/types/src/audit.ts`（阶段 0 就建好了，Task 2 只补了 `isVisibleTo`）——
小程序端也要它来决定审核角标显不显示，放进 `server/` 就得抄一份到 `miniprogram/`，
那正是这条约束本身要禁的事。约束的意图（唯一实现、共用状态机）成立，路径不成立。
本任务新建的 `server/src/moderation/` 目录因此只装内容安全的 DI 接缝。

### 14. `ContentSecurityVerdict` 只有三态，不含 `pending_review`

内容安全返回的是「机审的结论」，只可能是 `approved` / `rejected` / `pending`（没有结论）。
`pending_review` 是**已发布内容被举报后撤下待人工复核**的状态，机审这条路径永远到不了它 ——
让接口能返回它，调用方就得处理一个实际不会发生的分支。所以用
`Extract<AuditStatus, 'approved' | 'rejected' | 'pending'>` 收窄，仍然从同一个 `AuditStatus`
派生，不另立一套字面量。

微信的 `suggest`（pass / risky / review）到三态的映射走一张
`Readonly<Record<string, ContentSecurityVerdict>>` 查表，不写 `suggest === 'pass'`：
一是 `test/audit-literal-guard.spec.ts` 会拦下 `server/src/` 里的状态字面量比较，
二是查表天然处理「微信加了个新 suggest 值」—— 查不到就当没有结论，落 `pending`。

### 15. fail-closed 要按失败形态逐个断言，不能只测一种

「调用失败就留 `pending`」听起来一句话就够，但失败有七种长相：网络异常、HTTP 非 2xx、
响应体不是 JSON、`errcode 40001`（token 失效）、`errcode 45009`（配额超限）、
`errcode 0` 但没有 `result`、未知 `suggest`。只测其中一种，剩下六条里任何一条走进
「拿不到结论就当通过」都测不出来 —— 而这正是 Global Constraint 18 要防的。
所以那条测试是表驱动的，七种形态各排一遍，断言 `[label, verdict]` 全为 `pending`。

`errcode 87014` 是唯一的例外：它是微信明确判定「内容含违规」的错误码，不是「调用失败」，
落 `rejected`。取 token 本身失败时连请求都不发（断言 `calls` 为空）。

### 16. `ModerationModule` 暂时没有任何 import 方

它只导出 `CONTENT_SECURITY_API` 令牌，不导出两个实现本体 —— 业务代码因此拿不到
「绕开开关直接调真微信」的路径。目前 `app.module.ts` 还没 import 它：第一个消费者是
Task 12 的 `PostsModule`。接缝先立起来、消费者后接上，是为了让 Task 10 的测试只验接缝
（真假切换 + fail-closed），不掺发布流程的状态迁移。

`imgSecCheck` 走 `FormData` + `new Blob([data])`，**不手写 `Content-Type`**：
multipart 的 boundary 由 fetch 自己填，手写那行 header 会让 boundary 对不上。

### 17. 「没打 WARN」不能写成 `not.toHaveBeenCalled()`

接线测试最初断言的是「真实现生效时一条 WARN 都没有」。无库模式下它是绿的，
带 `--env-file=.env` 跑就红：`ModerationModule` import 了 `WechatModule`，而 `.env` 里
`FAKE_WECHAT_LOGIN=1` 开着，邻居那个开关自己打了一条 WARN，被这条断言算到了头上。

这是断言写宽了，不是被测代码的问题：测试想说的是「**这条** WARN 没打」。改成按开关名
筛 `warn.mock.calls` 再数，两个开关各测各的，测试也不再随环境变量的顺风顺水而变色。
教训：spy 整个 logger 时，断言必须锚定到自己那条消息 —— 模块图上任何一个邻居
将来多打一条日志，宽断言都会红，而红的原因和被测代码无关。

### 18. 上传不加表：审核状态就是文件所在的那一档

计划把审核状态默认成一行数据。实际没建 `uploads` 表，图片落在
`<root>/public/…` 还是 `<root>/private/…` 本身就是状态：`public` = 机审通过，
`private` = 还没有结论。理由有两条。

一是无库模式：上传是演示路径的一环，加一张表就得连带加一个内存仓储孪生体
（同第 12 条的老问题），而这张表除了「哪一档」没有别的字段。
二是双份状态：库里写 `approved`、盘上却躺在 `private/` 的组合一旦出现，
没有任何一方是权威。一份状态就没有对不齐的可能。

代价记在这儿：这一档只能靠列目录来统计，将来要「待审图片有多少张」得扫盘。
阶段 4 换对象存储时状态会跟着挪进 `post_images`，那时才有表。

### 19. 取图必须是控制器路由，不能是静态目录

计划 Task 11 的 GREEN 写的是「本地磁盘存储 + 静态路由」，验收却要求
「未过审图片的 URL 对他人返回 404 而非直接可访问」。两条对不上：静态中间件
拿不到请求者身份，它只会按路径发字节。所以 `GET /uploads/:ownerId/:name` 是
`UploadsController` 的路由，过 `OptionalAuthGuard`，私有档只对 key 第一段那个
owner 开放。按验收判，不按实现提示判。

三件配套的事：

- **「不存在」和「无权看」对外必须是同一个响应。** 都走 404 —— 一旦 403/404
  分得开，这个差别本身就把「这个 key 有东西」告诉了探测者。
- **`Cache-Control` 在这里是安全控制，不是性能调优。** 待审图片发
  `private, no-store`：少了这行，CDN 或反向代理会把作者自己看到的那张缓存下来
  发给别人，上面那条「他人 404」就绕过去了。公开档才发 `max-age=31536000, immutable`。
- **路径按解析出的字段重建，不用调用方给的字符串拼。** 先用整键白名单正则卡一遍，
  再 `join(root, lane, ownerId, name + '.' + ext)`。express 会把 `%2f`、`%2E` 解码进
  `req.params`，正则要卡的是解码后的那个值。

### 20. 违规的图一个字节都不落盘，尺寸上限分两级

机审在落盘**之前**：先写再删的话，中间任何一次崩溃都会在盘上留下一张没人知道
该不该发的图。裁决到档位走 `Readonly<Record<ContentSecurityVerdict, StorageLane | null>>`
查表（同第 14 条的理由），`rejected` 映到 `null` —— 微信已经明确判违规的图存下来，
只是给自己留一份将来可能被误发出去的违规内容。测试断言 `rejected` 那条前后
整个目录树的递归列表一字不差。

尺寸上限有两个，管的是两件事：multer 的 `fileSize` 是内存保护（超了 413，请求体
根本不读完），业务上限是 422。multer 那道设成业务上限的两倍，「稍微超一点」的
文件才落在 422 上而不是 413 上 —— 否则用户看到的是一个没有 `{ code, message }`
包装的框架错误。

图片类型按魔数嗅探，不听客户端报的 MIME：一个 shell 脚本改名成 `.jpg` 就能混进
图片目录，而那个目录是要对外发字节的。WEBP 要连查 RIFF 头和第 8 字节起的 `WEBP`，
只认 RIFF 会把 AVI / WAV 一起认进来。

### 21. 图片 URL 这一阶段是相对路径，客户端两种都要能认

返回的是 `/uploads/<key>`，不是绝对 URL：存相对路径意味着换域名不用洗库。
阶段 4 换对象存储后会变成绝对 URL（`https://…`），所以小程序端解析图片地址的
那个 helper 从一开始就得同时接受两种形态（Task 14 的活）。

本地磁盘存储是**单机限定**的：多副本部署时每个实例只看得见自己那块盘，
A 实例上传的图到 B 实例上就是 404。正式环境要换对象存储（spec §10），
`ImageStorage` 接口留在那儿就是为了这次替换只动一个 provider。

### 22. 远程库下 Jest 默认的 5000ms 兜不住多往返的用例

Task 11 提交前的带库回归红了两条，`pets.controller.spec.ts` 那条是
「详情带 isFollowing」超时（实测 7061ms）。它一个用例要四次真往返远程 Postgres
（读详情 → 关注 → 再读详情，外加 `afterEach` 的取消关注），单次热连接 ~600ms 起。
不是本任务引入的问题：这个套件只 import `PetsModule`，`app.module.ts` 的改动碰不到它。

按 `pet-write.controller.spec.ts` 与 `rate-limit-degradation.integration.spec.ts` 的既有做法
加 `jest.setTimeout(30_000)`。第二条失败没能单独复现（它落在另一个套件上，输出被
截掉了），修完这一条之后整套 406 通过、0 失败 —— 同一类超时抖动，记在这儿以防再遇到：
带库跑红了先看是不是超时，再看是不是断言。

### 23. 可见性过滤必须写进 SQL 的 WHERE，不能取完一页再筛

「未 approved 对他人不可见」（Global Constraint 16）如果实现成「按分页取一页，
再把不可见的 `filter` 掉」，坏的是**分页本身**：一页 10 条里筛掉 7 条，客户端拿到
3 条还被告知 `hasMore`，翻下一页又跳过了那 7 条的位置。所以过滤条件下沉到仓储：

```sql
WHERE po.pet_id = $1 AND (po.audit_status = ANY($2) OR po.author_id = $3)
```

未登录时 `$3` 传 `null`，`po.author_id = NULL` 求值为 NULL（不是 true），
于是只剩公开的那些 —— 两种身份共用同一条语句，不必分叉出一条「匿名版」SQL。
`$2` 那个数组是 `AUDIT_STATUSES.filter(isPubliclyVisible)`，从状态机派生而不是
另抄一份字面量（新加的 `AUDIT_STATUSES` 就是为它而加的）。

### 24. 动态和它的图片一条语句写完，外键在语句末尾才校验

`create` 用数据修改型 CTE：`WITH created AS (INSERT INTO posts …), created_images AS
(INSERT INTO post_images … FROM jsonb_to_recordset($5::jsonb) AS i(…)) SELECT … FROM created`。

三个不显然的点：

- **不开事务也安全**。各子语句保证各执行一次、执行到底，而外键的检查发生在整条
  语句末尾，所以「图片那条子语句先跑」不会因为 `posts` 那行还没有就失败。
  这一条原先只是注释里的断言，Task 12 的带库回归（30/30）真跑过了。
- **图片 id 在应用侧生成**（`randomUUID()`），所以图片子语句不必等 `created` 的
  `RETURNING` —— 否则就得让两条 INSERT 有先后依赖，反而回到多语句。
- **变长的图片数组走 `jsonb_to_recordset`**，不是六个并行的 `unnest` 数组：
  后者要求调用方保证六个数组一样长，错一个就是行错位，而错位不会报错。

### 25. 机审不阻塞响应，测试用 `settleAuditChecks()` 收敛而不是 sleep

发布响应恒为 `pending`：微信那两个接口正常也要几百毫秒、慢的时候是几秒，而这一刻
的答案无论如何都是「待审」，让用户对着转圈等一个已知结果毫无意义。

异步就带来「测试怎么知道机审跑完了」的问题。`sleep(200)` 这种写法在远程库上必然
偶发红。改成服务自己攒句柄：`private readonly inFlight = new Set<Promise<void>>()`，
公开一个 `settleAuditChecks()` 等它们排空（`while (size > 0)` 循环 —— 等待期间
可能又发了新动态），`onModuleDestroy` 也调它，免得进程退出时把一条已经拿到裁决、
还没写回状态的动态永久留在待审。
### 26. 图片的审核状态按它落的存储档位反查，客户端报的 `auditStatus` 一概不读

发动态时请求体里那个 `images[].auditStatus` 是**不读**的：读它等于让发布方自己声明
「我这张图过审了」。真相是图片上传时机审给的裁决，而那个裁决已经体现在文件落在
哪一档（第 18 条：上传不加表，档位就是状态）。于是 `UploadsService` 新增
`laneOfUrl(url)`：剥掉 `/uploads/` 前缀 → 过 `parseImageKey` 白名单 → `storage.locate`，
再经 `Readonly<Record<StorageLane, AuditStatus>>` 换成审核状态。

外链、拼错的 key、已经删掉的文件都会拿到 `null` —— 一律落 `pending`（验不了就不放行）。
测试里拿一个 `https://picsum.photos/...` 的地址断言了这条：作者自己看得到那张图带
`pending`，其他人拿到的 `images` 是空数组，而**文字照常显示**。

### 27. `PetRepository` 加 `findNameById`，而不是复用 `listByIds` 或改 `findOwnerId`

`PostRow` 要带 `petName`（列表和详情都要显示，客户端不该为一个名字再请求一次）。
三条路只有一条能走：

- `listByIds` 不行 —— 它是封面照片的 INNER JOIN（第 8 条），刚建好还没传照片的宠物
  在那条路径上直接取不到，而「新建宠物 → 立刻发第一条动态」正是最常见的路径。
- 把 `findOwnerId` 改成一次返回归属 + 名字也不行 —— 三个调用方加两个 spec 文件都要跟着改，
  而其中两个调用方只关心归属。
- 加一个窄接口 `findNameById`。Postgres 侧读动态时名字本来就随 `JOIN pets` 免费带回来，
  只有发布这一条路径多付一次 O(1) 查询，而它和归属查询是 `Promise.all` 并发打的。

### 28. `parseListQuery` 从 `MeController` 提到 `common/list-query.ts`

`GET /posts` 要同一套分页校验（page ≥ 1、pageSize 1..20）。让动态域去 import 一个
controller 文件，等于把「当前用户的数据」那一域拖进自己的依赖里，所以直接把函数
挪进 `common/`。纯搬移，规则一字未改，`me.controller.ts` 改成 import。

（`PetsController` 里还有一份内联的同规则校验 —— 它同时解析 species/breed/radius
等筛选项，形状不同，这次不动。）

### 29. `parseDimension` 只收字符串，是有意的，所以两条通道各有一个宽高校验

Task 12 的第一次 RED 之后，唯一红的那条用例红在**测试自己**调 `uploads.save()` 时
传了数字宽高：`parseDimension` 明确只接受字符串（multipart 的字段一律是字符串，
第 21 条的上游），数字进去就是 `null` → 422。

没有把它改成「两种都收」：动态发布的宽高来自 JSON，本来就是数，`positiveInt()`
卡的就是数。两个函数各卡各自那条通道的形状，互相将就的话，两边都会悄悄放过
对方那种错误输入。测试改成传 `'400'` / `'300'`。

### 30. 「关注流同样过滤」这条断言没有对象，改成一条会变红的静态守卫

计划 Task 13 列的第四条是「关注流 `GET /me/feed`（若本阶段实现）同样过滤」。本阶段
**没有**关注流端点 —— 动态只有「某只宠物的列表」与「详情」两条读路径（Task 12 的
`PostsController` 注释里记了原因：全局信息流本阶段没有消费者）。

对着不存在的路由写 `expect(404)` 是空跑：那个 404 来自「没有这条路由」，而不是来自
可见性过滤，加上 feed 之后它照样绿。所以改成扫 `server/src/**/*.controller.ts` 的
静态守卫，正则卡 `@Get('…feed…')` / `@Post('…feed…')` 这类声明，断言当前一个都没有；
守卫自己另有一条「真出现 feed 路由时能抓到」的反向断言（同 `audit-literal-guard` 的写法）。
谁在阶段 3 加出关注流，这条会红，并把人指回上面那五组可见性断言。

这条守卫不需要库，所以放在门控 describe **之外** —— 无库模式下它照常跑。

### 31. 安全套件自带用户与宠物，不打在种子数据上

其余套件都读种子（p-2 / p-5）或往 p-1 上写。这套要数「未登录这一页有几条」，
任何别的套件往同一只宠物上发一条动态都会把它弄红 —— 而那种红是并发顺序造成的，
看起来像 flaky。所以 `beforeAll` 自己插 `u-vis-author` / `u-vis-other` /
`p-vis-1` / `p-vis-2`，`afterAll` 按 `posts → pets → users` 顺序收走
（`post_images` 靠 posts 的级联）。插入都带 `ON CONFLICT DO NOTHING`：
上一轮崩在中途时还能重跑。

第二只宠物 `p-vis-2` 是专门给「pending 迁到 approved 后所有人可见」那条用的 ——
它会改一条动态的状态，摆在 `p-vis-1` 上就会让分页那两条断言依赖 describe 的执行顺序。

那条迁移直接调 `POST_REPOSITORY.setAuditStatus`，不走端点：人工复核端点是阶段 3 的事，
而机审已经收敛过了。这是夹具手段，代码里注明了。

### 32. 这五组断言是用变异测试证过的，不是永真的

测试是在 Task 12 的实现已经绿了之后补的（Task 13 本身就是「给既有过滤补专项测试」），
所以「先红后绿」没法靠时间顺序证明。改成往实现里各打一处伤：

- `list` 的 WHERE 加 `OR TRUE` → 4 条红（他人列表、匿名列表、迁移那条、分页那条），
  详情的 3 条仍绿。
- `detail` 去掉 `isVisibleTo` 判断 → 3 条红（他人详情、匿名详情、迁移那条），列表的仍绿。

两次都改回原状（`git diff` 空 + `tsc --noEmit` 干净）。这也顺带验证了两条路径的
过滤是**各自独立**的：列表那份在 SQL 里，详情那份在服务层，伤一处不会连带另一处变红。

分页那条断言（未登录 `pageSize=2` 的第一页 `hasMore` 为 `false`）就是为「筛在 LIMIT
之后」这种写法准备的：那样写会取到 rejected + pending 两条，筛完 0 条，`hasMore`
还是 true —— 客户端看到一个永远取不出内容的幻影下一页。这条只有真库能证，
内存实现是另一份代码。

### 33. `wx.request` 发不出 PATCH —— 服务端给 `/me` 与 `/pets/:id` 各加了一个 PUT 别名

小程序端的 `updateProfile` / `updatePet` 原本写 `method: 'PATCH'`（服务端就是
`@Patch()`），`tsc` 直接红：`miniprogram-api-typings` 里 `wx.request` 的 method
白名单是 `OPTIONS | GET | HEAD | POST | PUT | DELETE | TRACE | CONNECT`，
**没有 PATCH**。这不是类型定义漏了，是基础库真的不支持 —— 把客户端的联合类型
拓宽成 `'PATCH'` 只会把红移到 `wxAdapter.request` 里的 `wx.request({ method })`，
而且真机上会被基础库拦掉。

所以改的是服务端：`MeController` 与 `PetsController` 各多一个 `@Put()` 路由，
和原来的 `@Patch()` 共用同一份实现（`MeController.applyPatch` / `PetsService.update`），
语义仍然是**局部更新**（只改调用方真给了的字段）。小程序端一律发 PUT，
PATCH 留给 curl 与后续非小程序端。

两个动词绝不能各写一份校验：`/me` 的「清空头像」靠 `'avatarUrl' in body` 区分
「不动」与「清空」，分两份实现的话这个语义迟早只在一个动词上是对的。
`test/profile.controller.spec.ts` 与 `test/pet-write.controller.spec.ts` 因此各加了
一段 PUT 的等价性断言（401/403/404、局部语义、422 校验），无库与真库都跑过。

Nest 的路由装饰器不能叠：`@Patch()` 与 `@Put()` 写在同一个方法上时后生效的那个会
覆盖 `METHOD_METADATA`，所以必须是两个方法委托到一处。

### 34. `PageParams` / `PagedResponse<T>` 放在 `api/paged.ts`，不进 `shared/types`

`miniprogram/shared/types/` 是 `npm run sync:types` 从 `packages/types/src` 生成的，
手改会被 sync-types 守卫判红。而分页参数是**客户端拼请求**的形状（服务端那边是
`parseListQuery` 收 query string），本来也不属于跨端共享的 DTO。放在 api 层，
四个列表包装（following / favorites / history / posts）共用同一份。

### 35. `formatPostTime` 的「刚刚」是严格小于一分钟

第一版测试把「60 秒前」也断言成「刚刚」，实现返回「1分钟前」—— 是**测试错了**：
`diff < MINUTE` 的边界上，60 秒前确实该显示「1分钟前」。改成用 `now - 30_000`
测「刚刚」，另加一条边界断言把「整一分钟 → 1分钟前」钉住。
`at(y, m, d, h, min)` 这个本地日历构造器只到分钟，所以亚分钟的用例直接减毫秒。

### 36. `GET /me/pets` 刻意不分页、刻意不筛封面

广场的 `GET /pets` 分页且只出有封面的宠物（瀑布流要预估高度）。「我的宠物」两条都反过来：

- **不分页**：两个消费者（发布页选宠物、「我的动态」按宠物取动态）都需要完整清单才能
  工作，分页只会逼它们自己拼页。响应形状因此是 `{ items }`，没有 `hasMore` / `page`。
- **不筛封面**：刚建好还没传照片的宠物进不了广场，但必须出现在这份清单里 ——
  否则主人没有入口进去传第一张照片。

`MyPetListResponse` 单独定义（而不是复用 `PetListResponse`），就是为了让「这里没有分页」
在类型上是显式的。

### 37. 客户端要把相对图片地址补全，这件事只能在视图装配里做一次

服务端存的是相对路径（见 #21），`resolveImageUrl` 对绝对地址是空操作。原先
`buildFeedItem` 漏了这一步 —— 用假数据（picsum 的绝对 URL）看不出来，接上真库后
广场与关注列表的封面、主人头像会整片空白。修在 `utils/pet-card-view.ts` 一处：
`coverUrl` 与 `ownerAvatarUrl` 都过 `resolveImageUrl(…, baseUrl ?? API_BASE_URL)`，
`buildPostView` / `buildFavoriteRow` / `buildHistoryRow` 本来就是这么做的。

页面模板里不做这件事：一旦有第二处拼地址，两处的 base 迟早不一致。

### 38. 宠物照片必须先有 petId，所以新建页要在原地翻成编辑态

`POST /pets/:id/photos` 挂在已存在的宠物上，新建时压根没有 id。两条路：把选好的
本地临时文件攒着、等保存完再逐张传；或者先保存资料、再传图。

选后者：临时文件攒在页面里，中途退出就全丢了，而用户以为「我已经选好了」。
所以 `pet-edit` 保存成功后把 `id` 写进 data、`isNew` 翻成 `false`，选图器这才出现；
在那之前显示的是一句「先保存资料，就能传照片了」，而不是一个点了会失败的按钮。

新建时的坐标取 `locationStore.state`（**不是** `ensure()`）：填宠物资料的路上弹一个
定位授权框太突兀，已经有精确定位就带上，没有就不带。

### 39. 取关 / 取消收藏必须原地删行，不能重拉那一页

`dropById` 放在 `utils/list-paging.ts` 里 `mergePage` 旁边。重拉当前页有两个毛病：
滚动位置会跳回顶部，而且服务端那一页的内容已经错位（少了一条，下一页的第一条被吞）。
返回新数组是因为 `setData` 按引用比对，原地 `splice` 不会触发渲染。

取消收藏没有统一的 `DELETE /me/favorites/:id`，动作挂在各自资源上
（`unfavoritePet` / `removeFavorite`），所以收藏页按 `targetType` 分派。
取关则刻意**不**放进关注列表：开关只留在宠物详情页一处，列表页靠 `onShow` 重拉第一页
同步 —— 同一个动作有两个入口，两处的乐观更新迟早对不上。

### 40. 按天分段要从合并后的整份列表算，不是每页各算一份

浏览历史页在 data 里同时留着 `rows`（未分段的整份）与 `sections`。翻页时先
`mergePage` 再 `groupByDay(merged.items)` 重算全部分段。只对新一页分段的话，跨页的
同一天会分裂成两个「今天」标题 —— 而这正是分页边界上最容易漏测的一格。

### 41. 「我的动态」得先选一只宠物，因为 `GET /posts` 的 `petId` 必填

服务端刻意没有全局信息流（本阶段无消费者），所以这页的顺序是：取「我的宠物」→
定下选中那只 → 才有列表可拉。一只宠物都没有时走「先建一只」的空态，而不是拿空 id
去请求一次注定 422 的列表。「没宠物」与「有宠物但没发过」是两种空态，前者引去建宠物，
后者引去发布页。

选中项的规则（`utils/my-pets-view.ts` 的 `resolvePetId`）与发布页共用一份：还在清单里
就保留，否则退回第一只。各写一遍必然分叉成「一处保留、一处重置」，用户会觉得列表
在自己换宠物。

切宠物时旧那只的响应可能后到，所以请求前记下 `petId`、回来后比一次，不是当前那只
就整份丢掉 —— 否则两只宠物的动态会串在一起。

### 42. 发布页只发 url 与宽高，客户端拿到的 `auditStatus` 不回传

上传接口会回一个 `auditStatus`（见 #26），那是给页面看的。`toPublishBody` 把它摘掉：
发回服务端等于让发布方自己声明「我这张图过审了」。字数按码点数卡（`countChars`），
和服务端 `[...content].length` 同一个口径 —— 用 `.length` 会让「500 字」对爱用 emoji
的人变成 250 个，客户端先拦住了服务端允许的内容。

发布响应的 `auditStatus` 恒为 `pending`，所以提示语是「发出去了，审核中」并在页面上
写明「通过前只有你自己看得见」，不是「已发布」。选图一律经 `pickAndUploadImages`
（Global Constraint 21：宽高必须是 `chooseMedia` 的真值），发布页自己不碰选图接口。

多行输入框要把 `.field` 的圆角压回 `--radius-md`：`--radius-full` 那道弧会把
`textarea` 的头尾两行切掉（`pet-edit` 的简介与发布页的正文各有一处）。

## 五、遗留到阶段 3

按 spec §8，阶段 3 是私信。本阶段主动留给它的东西：

1. **私信本体**：`conversations` / `messages` 两张表、会话列表与聊天页、未读数。
   社交类目资质要在提审前办下来（`RELEASE_CHECKLIST.md` 的合规一节）。
2. **举报与人工复核端点**：状态机的 `approved → pending_review → approved/rejected`
   三条边已定义且有单测，缺的只是触发它的接口与后台动作（每次动作都要写 `audit_log`，
   Global Constraint 里的合规项 3）。
3. **关注流 `GET /me/feed`**：`follows` 表已经在了，缺的是读路径。加它的时候
   `post-visibility.security.spec.ts` 末尾那条静态守卫会红一次 —— 它的作用就是
   提醒补三种身份的可见性断言。
4. **对象存储替换 `LocalDiskImageStorage`**：接口不变，换一个 provider。
   多副本部署之前必须做，理由见第三节第 1 条。
5. **阶段 0 / 1 的老遗留仍未收口**：`page, .token-scope` 能否把自定义属性送到框架
   tabBar 节点（需真机验证）；`useCompilerPlugins: ["typescript"]` 与 `noEmit: true`
   是否冲突；`TencentPoiClient.searchPlace` 的真实 HTTP 调用（需要真的
   `TENCENT_MAP_KEY`，目前只有契约测试）。

## 六、过审前必办

**关掉 `FAKE_CONTENT_SECURITY`，用正式 AppID 真跑一次 `msgSecCheck` / `imgSecCheck`。**

本阶段的机审是假实现（当初的决定：先跑通链路，不卡在 AppID 上）。它保证了
**收敛方向正确** —— 一律落 `pending`，未过审内容对他人 404，这条已经在演示走查里
逐身份验过。但它**没有证明**微信那端的调用是对的：Task 10 的真实实现路径
（access_token 经 Redis 单点缓存、`media_url` 传法、errcode 分支、超时与降级）
只有契约测试与单测覆盖，没跑过真接口。

所以提审前的顺序是：拿到正式 AppID → 配好上传私钥（不入库）→
`FAKE_CONTENT_SECURITY` 置空重跑一遍走查 → 确认三处：正常文本/图片过、
违规文本/图片被拦、微信侧报错时只写日志不把 errmsg 透给前端。
这三条不过，「未过审内容对他人不可见」就只是一条自证的断言。

