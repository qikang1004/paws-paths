# 阶段 1 验收记录：浏览闭环

计划：`docs/superpowers/plans/2026-08-22-phase1-browsing-loop.md`（17 任务）
分支：`phase1-prep`　执行方式：inline TDD（每任务 RED → GREEN → 提交）
本轮模式：**不跑 Docker**。服务端以 InMemory 仓储 + seed 数据运行；Postgres/PostGIS 与 Redis
的集成用例已就位但按 `DATABASE_URL` / Redis 可用性门控跳过，有库环境时一设即跑。

## 一、自动化回归

| 包 | 结果 |
| --- | --- |
| server | `npx jest --runInBand` → **90 passed, 20 skipped**（14 suites passed, 5 skipped） |
| server | `npx tsc --noEmit` 干净；`npm run build` 通过（含 `*.sql` 拷贝到 dist） |
| miniprogram | `npx jest` → **267 passed（24 suites）** |
| miniprogram | `npx tsc --noEmit` 干净 |
| guard suites | style-guard / module-guard / wx-guard / app-json / sync-types 全绿 |

跳过的 20 条全部是 PostGIS / Redis 集成用例，属环境门控（`describeDb = DB_URL ? describe : describe.skip`），
不是失败也不是假绿——无库时不产出任何断言。

## 二、演示走查（服务端 InMemory 模式，实际 HTTP 请求）

服务以 `PORT=3100`、不设 `DATABASE_URL`/`REDIS_URL` 启动，全部结果为真实响应。

**广场首屏**（`GET /pets?lat=39.9042&lng=116.4074`）
8 只宠物、`hasMore=false`、距离严格由近到远：奶昔 330m、大黄 352m、花花 577m、咪咪 590m、
豆包 799m、可乐 902m、团子 1202m、旺财 1503m。封面宽高各不相同（600×800 / 800×600 / 900×600 /
700×700 / 600×900），瀑布流分列有真实比例可用。

**双层筛选**
- `species=cat` → 奶昔（布偶）、花花（中华田园猫）、咪咪（美短）、团子（英短）4 只。
- `species=cat&breed=布偶` → 只回奶昔。与计划的验收预期一致。
- `species=bird` → 422 / `42200 非法的物种筛选`。

**分页拼接**（临时 `pageSize=3`）
第 1 页 `p-2,p-1,p-5` `hasMore=true`；第 3 页 `p-6,p-7` `hasMore=false`。页面侧 `mergePage`
按 id 去重后追加，第 1 页从空列表合并等价于替换。

**宠物详情**（`GET /pets/p-2`）
奶昔 / 布偶 / female / 2024-02-14 / 330m；bio、性格标签（温柔、爱睡觉）、主人（阿喵，已认证）、
2 张照片（800×600、600×800）齐全。不存在的 id → 404 / `40400 宠物不存在`。
无坐标请求 → `distanceMeters: null`（城市模式，页面隐藏距离行而不显示 0m）。

**周边搜索与类目**
- `keyword=医院` → 2 家：宠福康 4.8/¥320/223m、贝恩 4.5/¥280/982m，标签与封面都有。
- `category=park` → 朝阳公园宠物区、奥森宠物公园。
- 无坐标 → 10 家、`distanceMeters: null`、按名称中文排序。
- `radiusMeters=500` → 5 家，最远 448m，半径过滤生效。
- 校验：非法类目 422、只给 lat 422「经纬度必须成对提供」、关键词 51 字 422、radius 99999 422。

**场所详情与收藏**（`GET /venues/v-1`，坐标 39.905/116.405 齐全 → 导航入口可渲染）
- 未登录 `POST /venues/v-1/favorite` → **401**。
- 带 JWT → `200 {"isFavorite":true}`；重复 POST 仍 `200 true`（幂等，不是 201）。
- `GET /venues/v-1` 回读 `isFavorite: true`；`DELETE` → `200 false`，回读 `false`。

**跨端契约抽查**
详情页无定位时 `fetchPetDetail` 会把 `lat/lng` 以 `undefined` 放进 query。实测
`GET /pets/p-2?lat=undefined&lng=undefined` → 200，因为服务端 `optionalNumber` 把
`""` 与 `NaN` 一并归为缺省。不是隐患，已核实。

## 三、本轮暴露的限制

- ~~**Redis 不可用时登录必 500**~~ → **已在阶段 1 收口时修掉**，决策与证据见
  「六、Redis 故障降级决策」。原症状：`LoginRateLimitGuard` → `RedisRateLimitStore.increment`
  没有 try/catch，Redis 缺失（ECONNREFUSED）或存在但需密码（NOAUTH）都会抛到统一异常层变成
  `50000 服务异常`。浏览闭环本身不受影响（`/pets`、`/venues` 是 optional-auth，无 token 照常
  返回），被挡住的是登录与收藏这类需要身份的动作。
- **收藏链路的演示用自签 JWT 完成**，没走真实 `wx-login`：`WX_APPID`/`WX_SECRET` 为空（正式
  AppID 与私钥按约定不入库），且上面那条 Redis 限流问题也会挡住登录。签名密钥与服务端一致，
  `AuthGuard` 只校验签名与 `sub`，因此收藏的鉴权、幂等、状态回读都是真实通路。
- **POI 代理的上游调用仍未实机验证**（缓存层已在收口时补上真 Redis 验证）。无
  `TENCENT_MAP_KEY` 时 `TencentPoiClient` 为 null，`search()` 直接落到 extras 分支——这正是
  本轮演示走的路径。「extras 缺失 → 评分/人均行隐藏」这一侧由两端单元测试覆盖（服务端
  `venues.service` 用不在 extras 的 poi-a/poi-b 断言 rating/avgPrice 为 null；小程序
  `buildVenueView` 断言 `showRating/showPrice` 为 false，且 rating 0 视为无评分）。
  **收口时补了 `test/poi-cache.integration.spec.ts`（8 条，真 Redis）**：TTL 真落到键上、
  中文键值往返无损、`poi:gh:wx4g0b:cafe:咖啡` 这类键在真 Redis 里确认生成、二次查询命中
  缓存不再调上游、坏缓存回源、空结果与 null 都不写缓存。
  **仍未验的只剩 `TencentPoiClient.searchPlace` 那次真实 HTTP**（URL 拼装、`status !== 0`
  的判定、字段映射），它需要正式 key，属于外部依赖项而非代码缺陷。
- **`<template is="{{itemTemplate}}">` 动态模板的渲染兼容性仍未证伪**。wf-list 的测试断言的是
  markup 结构，不是 Skyline/glass-easel 的实际渲染。计划里的回退方案（页面直写双列 + pet-card
  独立组件，wf-list 退化为纯函数 + 列样式）不改变任何对外数据契约，真机/开发者工具首次打开时
  若渲染异常按该方案切换即可。
- **开发者工具冒烟未做**：本轮无法在此环境启动微信开发者工具，页面层验证止于 markup 断言 +
  服务端真实响应。tabBar 自定义属性交付、`useCompilerPlugins` 与 `noEmit` 是否冲突这两条阶段 0
  的待实机项同样仍未闭合。

## 四、与计划的偏差（全部有意，已在 SDD 台账逐条记录）

1. **`distributeWaterfall` 放 `utils/` 而非 `tools/`**：`tools/` 是 Node 构建脚本目录，被
   `packOptions.ignore` 排除出包体，而它是运行时代码。
2. **token 名无 `--token-` 前缀**：计划写 `--token-color-primary` 等，实际是 `--color-primary`、
   `--space-md`、`--radius-full`。style-guard 的 `findUndefinedVars` 会直接拦下臆造名。
3. **`chip--sm` 而非 `chip-sm`，且落在 `styles/semantic.wxss`**：仓库的修饰符约定是双横线
   （`chip--active`）；`styleIsolation: apply-shared` 只让页面与 app.wxss 的样式进组件，
   **组件之间不互通**，宠物卡（wf-list）与场所卡（venue-card）都要用，就必须提到语义层。
4. **`buildVenueView` 放 `utils/venue-view.ts`**：venue-card 组件与分包详情页都要用，
   组件反向依赖页面目录是层次倒置；`venue-list-model` 再导出，计划里的导入路径仍然成立。
5. **场所详情页是分包页**：`app.json` 声明 subPackage root `packages/venue` + `pages/detail/index`，
   不存在计划写的 `pages/venue-detail/`。跳转目标 `/packages/venue/pages/detail/index?poiId=…`，
   相对导入退四级。
6. **geohash 字面量**：计划注释里的 `wx4g0f` 是错的，`encodeGeohash(39.9042,116.4074,6)` 为
   `wx4g0b`（已对 Wikipedia `u4pruydqqvj`、原点 `s00000` 与前缀性质交叉验证并写成断言）。
7. **POI 类目映射不含裸「店」**：计划的规则与计划自己的用例冲突（「神秘小店」期望 other），
   以可执行用例为准，收窄为 `宠物店|超市|商场|用品|食品|粮`。
8. **`metaText` 过滤空段**：性别 unknown 时输出「布偶 · 2 岁」，不留计划字面量里的「· ·」空洞。

## 五、遗留到阶段 2

- ~~Redis 故障时登录限流的 fail-open / fail-closed 取向~~ → 已决策并实现，见第六节。
- 真实 `TENCENT_MAP_KEY` 下的 POI 上游调用验证。~~Redis geohash 缓存命中~~已用真 Redis 验过
  （`test/poi-cache.integration.spec.ts`），剩下的是拿到 key 后验 `searchPlace` 那次真实 HTTP。
- 有库环境跑通 20 条门控集成用例（PostGIS 距离/半径与 InMemory 的 ±50m 一致性已写好断言）。
- 微信开发者工具冒烟：~~动态模板渲染~~（用户已确认双列瀑布流显示正常，回退方案不启用）、
  tabBar 自定义属性、图片加载抖动的实际观感。
- 功能面：follow、view_history、UGC 动态、字体子集、automator 5 条主链路自动化。

## 六、Redis 故障降级决策

**决策（用户选定）**：`降级放行 + 告警日志`（fail-open）。Redis 不可用时 `increment` 返回 0，
限流器视为未超限，登录照常进行，同时写一条 ERROR 日志。

**取舍**：登录可用性优先于限流保护。代价明确 —— **Redis 宕机窗口内登录端点没有暴力破解防护**，
靠 ERROR 日志告警补偿。选它的理由是阶段 2 会放大 fail-closed 的伤害：关注、发布动态、私信全部
需要登录态，Redis 抖动会拖垮所有写操作，而浏览还能用。

### 实现里比 try/catch 更要紧的一件事

补 try/catch 只解决「抛不抛错」，不解决「多久才失败」。实测 ioredis 默认参数
（`maxRetriesPerRequest` 默认 20）下，Redis 宕机时单条 `incr` 要 **10.7 秒**才抛错 ——
那样降级放行等于把登录请求挂死 10 秒，对用户和 500 一样糟，还多占连接。

对照数据（远端 Redis vs 本地不可达端口 6399）：

| 配置 | 健康路径 | 宕机路径 |
| --- | --- | --- |
| ioredis 默认 | 554ms | **10719ms** |
| 收紧后（现状） | 554ms | 212~2000ms |

参数落在 `server/src/common/redis-client.ts`，三处 Redis 客户端（限流、POI 缓存、
access_token 存储）共用，避免各写一份后漂移。

### 走过的弯路：`enableOfflineQueue: false` 不能用

它看着是正解 —— 宕机期间命令 0~2ms 立即失败。但 `lazyConnect` 下建连要约 1 秒，
关掉离线队列后这 1 秒内的**所有命令都失败**，于是限流器收到一串 0。等于**服务启动第一秒
不限流**，而那正是暴力破解最可能撞上的窗口；更糟的是它静默降级，不会有人发现。
在 getter 里补 `connect()` 也救不回来，因为 `connect()` 本身是异步的（实测前 5 次命令仍全失败）。

最终方案：**保留离线队列**（首条命令能等到建连），靠 `maxRetriesPerRequest: 1` +
`retryStrategy` 退避上限 + `Promise.race` 硬超时（2s）三层限制放大。

### 顺带修掉的两处同源缺陷

- `RedisPoiCache`：注释写着「缓存不可用不阻断主链路」，但默认参数下它要阻断 10.7 秒。
  已换共用参数，并把静默 catch 改成 warn 日志（原本故障完全不可观测）。
- `RedisTokenStore`：同样的 10.7 秒问题，影响更大 —— 它是 access_token 单点缓存，
  故障会拖死每个微信接口调用。**只换连接参数，刻意不加降级**：静默返回 null 会让每个请求
  都去刷 token，撞微信调用频率限制并互相顶掉彼此的 token。
- `onModuleDestroy` 统一改为 `quit()` 超时后 `disconnect(false)` 兜底。`quit()` 要等服务端
  应答，Redis 不可达时不解析，会把优雅关闭卡住；`false` 参数同时取消重连定时器。

### 验证证据

单元 15 条（`test/rate-limit-degradation.spec.ts` + `test/rate-limit.spec.ts`）、
共用模块 16 条（`test/redis-client.spec.ts`）、真实 Redis 集成 4 条
（`test/rate-limit-degradation.integration.spec.ts`，含健康路径「计数必须是真的，不能是 0」
这条防误降级回归）。全量 **160 passed / 26 suites**（真库 + 真 Redis），无库无 Redis 环境
134 passed / 26 skipped。

端到端（真实 HTTP，`dist/main.js`）：

- **Redis 指向 6399（宕机）**：`POST /auth/wx-login` 连续 3 次全部 `code: 0`，耗时
  1204/2298/2379ms；服务日志 2 次登录对应 2 条 `限流存储不可用，本次放行` ERROR，一一对应。
  改动前此处是 `50000`。
- **健康 Redis**：连打 35 次登录 → 前 30 次 `201`，第 31 次起 `429` +
  `{"code":42900,"message":"操作太频繁，请稍后再试"}`，与配置的 30 次/60 秒吻合。
  这条是反面证据，证明没有误降级、限流真实生效。
