# 运营后台（`@paws/admin`）

独立的 Web 应用，运营人员用账号密码登录后复核举报工单。

**与小程序共用同一套服务端 API**（spec §3.1）—— 权限由 `ModeratorGuard` 在服务端
每次请求查库判定，前端这一侧不做任何权限决策。

## 跑起来

```bash
# 依赖装在仓库根（npm workspaces）
npm install

# 开发（默认 5173，/api 代理到 localhost:3000）
npm run dev -w @paws/admin

# 类型检查 + 打包
npm run build -w @paws/admin

# 测试
npm test -w @paws/admin
```

服务端要一起起着。想连别的后端：`ADMIN_API_TARGET=http://其他地址 npm run dev -w @paws/admin`。

## 两个前缀都要反代

Vite 把 `/api/*` 与 `/uploads/*` 都反代到服务端（见 `vite.config.ts`），所以本地开发
**压根不发跨域请求** —— 不必先配 `ADMIN_ORIGINS`。

**`/uploads/` 那条不是可选的。** 工单里的 `imageUrls` 是服务端拼的相对路径
（`/uploads/:ownerId/:name`），漏了这条规则，那些请求会打在前端自己的 server 上拿 404 ——
后台里**一张图都看不见**，不只是待审的那些。`/api` 会被去掉前缀（服务端路由上没有那一段），
`/uploads` **不能** —— 服务端那条路由本身就带这个前缀。

生产是同一个形状，Nginx 两条都要配：

```nginx
location /api/     { proxy_pass http://服务端:3000/; }        # 去掉 /api 前缀
location /uploads/ { proxy_pass http://服务端:3000/uploads/; } # 保留前缀
```

只有前后端分开部署在不同域时才需要服务端的 CORS：

```bash
ADMIN_ORIGINS=https://admin.example.com   # 服务端环境变量，默认关闭
```

那条配置只接受 https（`localhost` / `127.0.0.1` 例外）、拒绝通配符，配错直接启动失败。

注意 CORS 管不到 `<img>` —— 图片不受同源策略约束，它只需要那条反代存在。

## 建账号

后台**没有注册入口** —— 服务端刻意没有那个端点。加人要登服务器：

```bash
echo '一个至少 12 位的密码' | npm run admin:create -w server -- ops-alice moderator
```

同一个用户名再跑一次就是改密码与改角色。撤权：`UPDATE users SET role = 'user' WHERE username = $1` ——
角色不在令牌里，撤权立即生效。

## 已经能用的

- 账号密码登录，会话存 `localStorage`，刷新不掉线
- 待复核工单分页列表（页大小 20，与服务端 `parseListQuery` 的上限一致）
- 工单带被举报内容的原文、图片、举报原因、作者昵称
- 放行（举报不成立）与撤下（举报成立，必须写原因）
- 图片点开看大图
- 令牌失效时自动回到登录页

## 还没有的

- **审计日志页**：服务端目前没有查询端点（`AuditLogRepository` 只有写入）
- **已处理工单的历史**：`GET /moderation/tasks` 只出 `result IS NULL` 的
- **筛选与排序**：服务端固定按创建时间正序（先举报的先处理）
- **待审图片看不到**：待审图落私有档，只有作者本人取得到（`UploadsService.fetch`），
  而 `<img>` 压根不会带 Authorization 头 —— 运营连自己的身份都递不过去。已过审的图
  （公开档）正常显示。界面上取不到的图会画成占位并说明原因，不留碎图图标。
  真要看待审图，得服务端为运营单独开一条取图路径

## 目录

```
src/
  api/
    session.ts      登录态（localStorage 读写 + 存坏了当没登录）
    client.ts       fetch 包装：Bearer 头、统一包络、401 清会话
    moderation.ts   两个端点的包装 + 页大小常量
  components/
    Toast.tsx       浮出提示（替掉 alert）
    RejectDialog.tsx 驳回原因输入（替掉 prompt）
    ImageLightbox.tsx 大图预览
    TaskCard.tsx    一条工单
  pages/
    LoginPage.tsx
    TasksPage.tsx
  App.tsx           登录 / 工单两个视图的切换
  styles.css
test/               vitest + @testing-library/react，58 个用例
```

## 几个刻意的选择

**不引路由库。** 只有两个视图，一个 `session` 状态就够。等审计日志页进来、
真的需要「地址栏表达位置」时再引。

**不引 UI 框架。** 两页七个组件，引一套组件库会为了几个按钮拖进几十个包。
等手写开始重复再换。

**判据是业务码不是 HTTP 状态。** 服务端的包络是 `{ code, message, data }`，
`code` 才是真相 —— 与小程序侧同一套约定。

**失败文案原样用服务端的。** 登录失败时服务端刻意让「用户名不存在」与「密码错误」
收敛成同一句（防枚举），前端按码分支写自己的文案会把那道收敛拆开。唯一的例外是
429 —— 补一句限流量级，否则运营会以为服务挂了、继续重试把配额烧光。

**UGC 一律走文本插值，绝不用 `dangerouslySetInnerHTML`。** 令牌就在
`localStorage` 里，被举报的正文是攻击者可控的内容。

## 部署

1. `npm run build -w @paws/admin` → `admin/dist/`
2. 静态文件交给 Nginx（或 CDN）
3. Nginx 反代**两个**前缀到服务端：`/api/`（去前缀）与 `/uploads/`（保留前缀）——
   漏了后者后台里一张图都看不见
4. 前后端同域时不必开 CORS；分域部署才需要服务端配 `ADMIN_ORIGINS`
5. 用 CLI 建第一个运营账号
