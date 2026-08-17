# 萌宠社交圈 · 微信小程序设计文档

- 日期：2026-08-16
- 原型来源：`stitch_/`（7 个页面原型 + `_8.txt` PRD + `paws_paths/DESIGN.md` 设计系统）
- 交付目标：可上线 MVP

---

## 1. 项目定位与范围

面向宠主的同城社交小程序。用户浏览附近宠物、发现宠物友好场所、管理自己的宠物资料并与其他宠主互动。

### 1.1 原型盘点

| 编号 | 页面 | 状态 |
|---|---|---|
| `_1` | 宠友广场（首页瀑布流） | 纳入 |
| `_2` | 宠物详情 | 纳入 |
| `_3` | 宠物周边 | 纳入 |
| `_4` | 个人中心（早期稿） | **废弃**，被 `_5` 取代 |
| `_5` | 个人中心（含宠物认证区） | 纳入，以此为准 |
| `_6` | 犬证上传 | 纳入 |
| `_7` | 我关注的 | 纳入 |

`_8.txt` 的 PRD 只覆盖 4 个模块（广场 / 详情 / 周边 / 个人中心），而原型实际包含另外 4 个子系统（UGC 发布、私信、关注关系、证照认证）。本文档以**原型为准**，PRD 视为不完整草稿。

### 1.2 首期范围（全量纳入）

1. 宠友广场：双层筛选 + 宠物卡瀑布流
2. 宠物详情：图集轮播、资料、性格标签、宠主信息、日常相册
3. 宠物周边：POI 搜索、类目筛选、场所卡、导航跳转、收藏
4. 个人中心：资料、宠物管理、入口列表
5. 关注关系 + 我关注的
6. 发布动态（UGC 图文）+ 内容安全审核
7. 站内私信（联系宠主）
8. 证照认证：犬证上传审核 + 疫苗档案 + 运营审核后台

范围超出单轮实现容量，因此**架构与数据模型一次性定完**（分期会导致返工），**功能按 5 个阶段交付**（见 §8）。

---

## 2. 关键决策记录

| 决策项 | 结论 | 理由 |
|---|---|---|
| 前端框架 | 原生小程序 + TypeScript + Skyline | 无编译层黑盒，官方能力第一时间可用，真机性能最优 |
| 后端形态 | 自建 NestJS API | 地理查询、审核后台、多端复用均需要完整后端控制权 |
| 部署载体 | 微信云托管（首选）/ 云服务器 + Docker（备选） | 云托管免备案与证书维护，且内网调用微信开放接口免鉴权 |
| 地点数据源 | 腾讯地图 POI + 自建 `venue_extras` 补充 | POI 覆盖全国，运营字段本地补齐 |
| Feed 语义 | 一张卡 = 一只宠物 | 对齐原型 `_1`，动态作为详情页相册与关注列表摘要存在 |
| 关注对象 | 宠物（非用户） | 与「宠物卡流」保持一致 |
| 身份证号采集 | **移除** | 犬证编号 + 证件照 + 登记人姓名已足够核验，额外采集显著提高合规负担 |

---

## 3. 架构与部署拓扑

### 3.1 分层拓扑

```
微信客户端（小程序：原生 + TS + Skyline）
        │ HTTPS 443 / WSS
        ▼
Nginx 网关（TLS 终止、限流、静态回源）
        ▼
NestJS API（Node 20，Docker 多实例）
   ├── PostgreSQL 16 + PostGIS   业务数据 + 地理查询
   ├── Redis                     access_token 单点缓存 / 会话 / 频控 / POI 缓存
   ├── 对象存储 COS + CDN         用户图片（独立备案域名）
   └── 微信开放接口                code2Session / 内容安全 / 手机号 / 订阅消息
        ▲
运营后台（Web，复用同一 API，RBAC 隔离）
```

### 3.2 微信平台约束到架构的映射

| 平台约束 | 架构应对 |
|---|---|
| 仅可请求已备案 HTTPS 合法域名，不可用 IP，端口锁 443 | ICP 备案域名 + TLS 1.2+；`api.` / `cdn.` / `wss.` 三个子域名分别登记到 request / downloadFile / socket 白名单 |
| 域名白名单全局生效，无法按环境隔离 | dev 与 prod 域名同时入白名单，API 层做环境路由；开发期启用「不校验合法域名」 |
| `access_token` 有频率限制，多实例各自刷新会互相顶掉 | Redis 单点缓存 + 分布式锁统一续期，业务实例只读不刷 |
| UGC 必须过内容安全，`mediaCheckAsync` 为异步回调 | 内容先落 `pending`，回调地址 `/wx/callback/media` 挂在网关，通过后才对外可见 |
| 主包 ≤ 2MB、总包 ≤ 20MB | 按 tab 与场景分包（见 §5.1） |
| 私信需长连接 | `wx.connectSocket` 走 wss 子域名，网关做 WebSocket 升级；消息先落库再推送 |
| 体验版/正式版需人工上传 | `miniprogram-ci` 接 CI，自动上传体验版并生成预览二维码 |

选用微信云托管时，域名备案、证书维护与 `access_token` 管理三项工作可直接免除；其余架构不变。

**默认按微信云托管实施。** 仅当项目方已具备备案域名与既有运维体系时，切换为云服务器 + Docker，此时 §3.2 表中的前三条约束需自行落实，§4 及之后各节内容不受影响。

---

## 4. 数据模型

共 15 张表（14 张业务表 + 1 张审计表）。设计标准：原型上每个可见元素都能溯源到具体字段。

### 4.1 核心域

| 表 | 关键字段 | 支撑的原型元素 |
|---|---|---|
| `users` | `openid`(唯一)、`nickname`、`avatar_url`、`phone_enc`、`is_verified_owner`、`last_location`(geography)、`status` | `_5` 头像/昵称/「已认证宠主」徽章；`_2` 宠主 mini 卡 |
| `pets` | `owner_id`、`name`、`species`(dog/cat/other)、`breed`、`gender`、`birth_date`、`cover_photo_id`、`bio`、`personality_tags`(text[])、`location`(geography)、`visibility`、`last_active_at` | `_1` 整张卡；`_2` 名字/性别图标/品种/月龄/标签/关于 |
| `pet_photos` | `pet_id`、`url`、`width`、`height`、`sort_order`、`is_cover`、`audit_status` | `_2` 顶部轮播 + 「更多日常」瀑布流 |
| `posts` | `pet_id`、`author_id`、`content`、`audit_status`、`published_at` | 悬浮「发布」按钮；`_7` 最新动态摘要 |
| `post_images` | `post_id`、`url`、`width`、`height`、`audit_status` | 同上 |

两个刻意的建模选择：

- **年龄存 `birth_date`，不存展示文本。** 原型同时出现「2岁」「8个月」「1岁」，是同一规则的不同渲染结果，必须运行时计算（不足 12 个月显示月龄），否则数据随时间腐烂。
- **`pets.location` 与 `users.last_location` 分离。** 宠物卡上的「500m」是宠物位置到当前访问者的距离，两侧都需坐标。宠物位置随宠主最后一次授权定位更新；`GiST` 索引 + `ST_DWithin` 做附近查询。

`pet_photos.width/height` 与 `post_images.width/height` 为瀑布流预估高度而存在（见 §5.2），非可选字段。

### 4.2 关系与互动域

| 表 | 关键字段 | 说明 |
|---|---|---|
| `follows` | `follower_id`、`target_pet_id`、唯一约束 | `_2` 关注按钮、`_7` 列表 |
| `favorites` | `user_id`、`target_type`(pet/venue)、`target_id` | `_2` 收藏心标、`_3` 场所收藏、`_5`「收藏的周边」 |
| `view_history` | `user_id`、`target_type`、`target_id`、`viewed_at` | `_5`「浏览历史」，按 (user, target) 幂等更新时间戳 |
| `venue_extras` | `poi_id`(腾讯 POI 主键)、`category`、`tags`(text[])、`rating`、`avg_price`、`description`、`curated_photo` | 补齐 POI 不提供的评分/人均/宠物友好标签 |

**`venue_extras` 降级规则**：某 POI 无对应记录时，`venue-card` 隐藏评分行与人均行，标签区仅显示由 POI 分类映射生成的类目标签，卡片布局不留空洞。

### 4.3 私信域

- `conversations`：双方 ID、`last_message_at`、双向未读数。用 `LEAST/GREATEST` 归一化双方 ID 建唯一约束，避免同一对人产生两条会话。
- `messages`：`conversation_id`、`sender_id`、`content`、`audit_status`、`read_at`。

### 4.4 认证域

| 表 | 关键字段 |
|---|---|
| `pet_licenses` | `pet_id`、`license_no`、`registrant_name`、`cert_image_key`、`valid_until`、`audit_status`、`reject_reason`、`reviewed_by` |
| `vaccine_records` | `pet_id`、`vaccine_name`、`dose_index`、`vaccinated_at`、`next_due_at` |
| `moderation_tasks` | `target_type`、`target_id`、`source`(wx_auto/user_report/manual)、`result`、`handled_by` |
| `audit_log` | `actor_id`、`action`、`target_type`、`target_id`、`status_before`、`status_after`、`created_at` |

`moderation_tasks` 承载待处理的审核工单，`audit_log` 记录已发生的审核动作，两者不可互相替代：前者是队列，后者是不可变流水。

`_5` 上「已接种3针」「下次接种 2024.10」由 `vaccine_records` 聚合得出，不落冗余字段。

`_6` 的表单字段最终为：犬证编号、登记人姓名、有效期至、证件照。**身份证号已移除**（见 §2）。

**敏感信息硬约束**：

1. 证件照存**私有桶**，绝不进 CDN；审核后台通过 5 分钟有效期签名 URL 访问。
2. `license_no` 与 `registrant_name` 在接口返回时脱敏（如 `京A****567`、`李*`），完整值仅审核后台可见。
3. 所有审核动作全量写 `audit_log`，记录操作人、时间、前后状态。
4. 手机号 `phone_enc` 用 `pgcrypto` 加密存储，接口一律返回脱敏形式。

### 4.5 统一审核状态机

`pet_photos` / `posts` / `post_images` / `messages` / `pet_licenses` 共用：

```
pending ──机审通过──> approved ──举报──> pending_review
   │                                        │
   └──机审驳回──> rejected <────人工驳回──────┘
```

未达 `approved` 的内容对他人不可见，对作者本人显示「审核中」角标。这是通过小程序审核的必要条件，并有对应安全测试（见 §7）。

---

## 5. 小程序端结构

### 5.1 分包

| 包 | 页面 | 理由 |
|---|---|---|
| **主包** | 广场 `plaza`、宠物详情 `pet/detail`、`custom-tab-bar`、公共组件 | 详情页是分享落地页，必须零延迟打开 |
| `venue` | 周边列表、场所详情 | |
| `profile` | 个人中心、宠物编辑、我关注的、我的动态、收藏、浏览历史、设置 | |
| `cert` | 犬证上传、犬证详情、疫苗档案 | 低频且含上传逻辑 |
| `chat` | 会话列表、聊天详情 | 隔离 WebSocket 逻辑 |
| `post` | 发布动态 | |

对 `venue` 与 `profile` 配 `preloadRule` 预下载，切 tab 无感知等待。

### 5.2 原型适配（7 处无法直译）

| 原型用法 | 小程序限制 | 替代方案 |
|---|---|---|
| `Quicksand` 全局字体（含中文） | 中文字体包数 MB，`wx.loadFontFace` 不实用 | Quicksand 做 subset 仅保留数字与拉丁字符（约 20KB），经 `loadFontFace` 加载，用于年龄/距离/评分/价格；中文走系统字体 PingFang SC，字重降一级补偿视重（700→600） |
| Tailwind CDN + `tailwind.config` | 无法运行时注入 CSS | `DESIGN.md` token 编译为 `app.wxss` 中的 CSS 变量 + 语义类（`.card` / `.chip` / `.btn-primary`），Skyline 原生支持 CSS 变量 |
| `column-count: 2` 瀑布流 | Skyline 下多列布局不可靠 | 双列 flex + JS 分配：用 `width`/`height` 算占位高度，累加较短列。同时消除图片加载时的高度抖动 |
| 单位 `px`（4px 基准 / 20px 边距） | 需多机型适配 | token 层统一 `1px = 2rpx`（边距 20px→40rpx），字号同步转 rpx |
| `googleusercontent` / `unsplash` 图片域名 | 非白名单域名无法加载 | 替换为自有 CDN 域名；按 `imageMogr2` 规格裁切，列表仅拉 2 倍宽缩略图 |
| 原生 `tabBar` | 做不出「胶囊高亮 + 白底圆角 + 上方软阴影」 | 使用 `custom-tab-bar`，`env(safe-area-inset-bottom)` 兜安全区 |
| `hover:` / `group-hover:` | 触屏无 hover | 改按压态：`hover-class` + `scale(0.97)`，同时落实 `DESIGN.md` 的「squishy 下沉」反馈 |

Material Symbols 的约 25 个图标转为 SVG 组件（不走字体），避免 FOIT 与字重变体问题。

### 5.3 组件切分

每个组件只做一件事，对外仅暴露数据契约：

- `wf-list` — 双列瀑布流容器，输入 `items[{width,height}]` + 插槽，不关心内容类型；广场卡与详情页相册复用
- `pet-card` — 输入 pet DTO，输出点击事件
- `venue-card` — `extras` 缺失时按 §4.2 规则降级
- `filter-chips` — 两层筛选（类目 + 品种），受控组件
- `audit-badge` — 「审核中 / 未通过」角标，接 `audit_status`
- `media-picker` — 选图 → 压缩 → 直传 COS → 回填审核态，全流程封装
- `empty-state` — 爪印插画空态（`DESIGN.md` 明确要求）
- `sq-button` — 带按压下沉反馈，三变体对齐 `DESIGN.md`（Primary / Secondary / Ghost）

### 5.4 数据流

页面只与 `api/` 层对话，不直接调用 `wx.request`。`request.ts` 统一负责：登录态注入、401 静默重登并重放、错误码映射为中文提示、慢请求 loading 阈值。位置信息由 `store/location.ts` 单点持有，避免各页面重复触发授权弹窗。

---

## 6. 错误处理

| 场景 | 策略 |
|---|---|
| 登录态失效 | 401 触发静默 `wx.login` 重登并重放原请求，用户无感；二次失败才引导登录 |
| 定位被拒绝 | 不阻断，降级为按城市浏览（`_1` 顶部「同城」切换即降级入口），距离字段隐藏 |
| 腾讯地图配额 / QPS | 小程序不直连地图 API（key 会泄漏）。服务端代理 + Redis 按 `geohash + 类目` 缓存 10 分钟；配额耗尽回落到 `venue_extras` 自有数据 |
| 内容机审驳回 | 返回具体原因文案，作者可见「未通过」角标并支持修改重提 |
| 异步审核回调丢失 | 定时对账任务扫 `pending` 超 10 分钟的记录主动查询补偿 |
| 图片上传失败 | 分片重试 + 本地草稿保留，不丢用户已填内容 |
| 空 / 错误 / 无权限态 | 统一走 `empty-state`，三种态各有插画与明确的下一步动作 |

---

## 7. 测试策略

不追覆盖率数字，只死守「错了会出事」的地方。

**必须有测试的领域规则**

- 年龄渲染的月/岁边界（11 个月 vs 12 个月）
- 审核状态机的非法转移拦截
- 会话 ID 双向归一化（同一对用户只产生一条会话）
- 手机号加解密与脱敏输出、`license_no` / `registrant_name` 脱敏
- **未 `approved` 内容对他人不可见** —— 这是安全测试，不是功能测试

**分层**

- 后端：Jest 单元测试 + `testcontainers` 起真实 PostGIS 跑集成测试（距离查询无法用假库验证）
- 小程序端：工具函数单测 + `miniprogram-automator` 覆盖 5 条主链路（浏览→详情→关注 / 发布→审核→可见 / 周边→导航 / 犬证提交→审核 / 私信收发）
- 真机验收：iOS 与 Android 各一台，重点验字体降级效果、瀑布流无抖动、安全区表现

---

## 8. 分阶段交付

| 阶段 | 内容 | 完成标志 |
|---|---|---|
| **0 · 地基** | 架构搭建、design token 编译、`request` 层、登录、`custom-tab-bar`、分包骨架、CI 上传 | 空壳可跑通并能上传体验版 |
| **1 · 浏览闭环** | 广场（双层筛选 + 瀑布流）、宠物详情、周边（POI + extras 降级） | 可完整演示的产品 |
| **2 · 身份与社交** | 个人中心、宠物增改、关注 / 我关注的、发布动态 + 内容安全接入 | 可提交小程序审核 |
| **3 · 私信** | 会话列表、聊天、WebSocket、消息审核 | 需先确认社交类目资质 |
| **4 · 认证** | 犬证上传、疫苗档案、运营审核后台 | 敏感信息合规完成 |

每阶段独立可提体验版。阶段 1 结束即具备可用产品，这是浏览链路排在最前的原因。

---

## 9. 明确不做（YAGNI）

原型中有痕迹但首期不实现，以防范围蔓延：

- **`_1` 的「附近活动」chip** —— 无对应原型页，活动是独立子系统；首期移除该 chip
- **点赞 / 评论** —— 原型完全未画，不臆造
- **暗色模式** —— `_3` 与 `_6` 的 HTML 带 `class="dark"`，但 `DESIGN.md` 色板未定义任何暗色值，无法实现，视为原型笔误
- 分享海报、多语言、宠物配对

---

## 10. 需要项目方处理的外部事项

以下三项无法由实现工作代替完成：

1. **社交类目资质** —— 一对一私信可能要求「社交-线上交友」类目及额外资质。建议在阶段 2 提审时试探平台反馈，再决定阶段 3 是否如期开工。
2. **`wx.getLocation` 报备** —— 需在 `app.json` 声明 `requiredPrivateInfos` 并在小程序后台填写用途说明，未报备则接口直接调用失败。
3. **备案与主体资质** —— 若选云服务器路线，需提前完成 ICP 备案；`wx.getPhoneNumber` 需企业主体且为付费能力。
