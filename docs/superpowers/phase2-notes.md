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
