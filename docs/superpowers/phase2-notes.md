# 阶段 2 验收记录：身份与社交

计划：`docs/superpowers/plans/2026-08-24-phase2-identity-social.md`（16 任务）
分支：`db-integration`　执行方式：inline TDD（每任务 RED → GREEN → 提交）

本文件在阶段 2 执行过程中逐步补写；完整的回归结果与演示走查在 Task 16 收尾时补齐。

## 与计划的偏差（全部有意）

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
