# Paws & Paths

宠物社交小程序。微信小程序前端 + NestJS 后端 + PostgreSQL/PostGIS + Redis。

```
miniprogram/       小程序端（原生 + TypeScript，Skyline 渲染）
server/            NestJS 服务端
packages/types/    前后端共享的类型与错误码
docs/              设计文档与阶段笔记
docker-compose.yml 本地数据库（可选，已有独立 PG/Redis 就不用）
```

## 一、跑起来需要什么

四个东西,缺哪个的表现都不一样:

| 组件 | 必需 | 缺了会怎样 |
|---|---|---|
| Node.js ≥ 20 | 是 | 用了 `--env-file`,低于 20.6 起不来 |
| PostgreSQL 16 + **PostGIS** | 否 | 不设 `DATABASE_URL` 时自动降级为内存模式,有假数据可看 |
| Redis | 否 | 登录接口返回 500,浏览类接口正常(见「已知问题」) |
| 微信开发者工具 | 看端 | 只调后端不需要 |

PostGIS 是硬要求,不是可选扩展。附近搜索用 `ST_DWithin`/`geography` 类型,建表第一句就是 `CREATE EXTENSION postgis`,没装会直接失败。

## 二、本地开发

### 1. 装依赖并构建共享类型

```bash
npm install
npm run build -w @paws/types    # 必须先跑，否则 server 编译报 TS2307
```

`@paws/types` 是 workspace 依赖,前后端都从它拿类型和错误码。它没出 `dist`,后面所有步骤都会失败。

### 2. 准备数据库

已经有独立的 PostgreSQL 和 Redis 就跳过这步。否则:

```bash
docker compose up -d
```

用之前先把 `docker-compose.yml` 里的 `CHANGE_ME_REDIS_PASSWORD` 替换掉。

### 3. 配置 `server/.env`

复制 `server/.env.example` 为 `server/.env` 填真值。这个文件已被 gitignore,不会进仓库。

```bash
DATABASE_URL=postgres://用户:密码@127.0.0.1:5432/paws
REDIS_URL=redis://:你的密码@127.0.0.1:6379
JWT_SECRET=一串足够长的随机字符
SEED_DEMO_DATA=1
PORT=5000
```

`PORT` 改了要同步改 `miniprogram/config.ts` 的 `LOCAL_API_BASE_URL`,两边必须一致。3000 常被别的开发服务器占用,所以默认用 5000。

**`REDIS_URL` 有两个坑,踩了会报 `WRONGPASS` 或 `NOAUTH`:**

- 只有密码没有用户名时,**冒号前必须留空**:`redis://:密码@host:6379`。写成 `redis://密码@host:6379` 会把密码当成用户名,实际传的密码是空的——这是最容易踩的一个。
- 密码含 `@` 不需要转义。`ioredis` 和 `pg` 都按最后一个 `@` 切分认证段,`redis://:pa@ss@host:6379` 能正确解析;写成 `%40` 也可以,两种都实测通过。含 `/` `?` `#` 时才需要 percent-encoding。

`SEED_DEMO_DATA=1` 才灌演示数据(8 用户 / 8 宠物 / 17 照片 / 10 场所)。**只认字面 `1`**,写 `true` 或 `yes` 一律视为关闭——灌数据是不可逆的写库动作,不靠猜语义。

### 4. 启动服务端

```bash
cd server
npm run build
node --env-file=.env dist/main.js
```

启动时会自动建表(幂等,可反复跑),日志里能看到 `[Migrations] 迁移完成（仅建表）` 或 `（含演示数据）`。迁移失败进程直接退出,不会带着空库对外服务。

不设 `DATABASE_URL` 的话会看到 `未设 DATABASE_URL，以 InMemory 模式启动`,这是正常的降级模式。

验证:

```bash
curl "http://127.0.0.1:5000/health"
curl "http://127.0.0.1:5000/venues?lat=39.9042&lng=116.4074"
```

应返回 `{"code":0,"message":"ok","data":...}`。

**如果返回的是一段 HTML,说明打到了别的服务上**——别的开发服务器会把未知路径回落成首页并回 200,看起来像通了。用 `/health` 验最准:只有本项目会回 `{"code":0,...,"status":"up"}`。

### 5. 打开小程序

微信开发者工具导入项目根目录,然后:

- 详情 → 本地设置 → 勾选 **不校验合法域名、web-view、TLS 版本以及 HTTPS 证书**

不勾这项,小程序不允许请求 `http://127.0.0.1`,页面会没数据。

接口地址不用手改。`miniprogram/config.ts` 按运行环境自动选:开发者工具(`envVersion === 'develop'`)走 `http://127.0.0.1:5000`,体验版和正式版走线上域名。改过 `PORT` 的话记得同步这里。

**真机预览连不上本机。** 手机和电脑不是同一个 localhost。要在真机调试有两条路:把 `LOCAL_API_BASE_URL` 临时改成电脑的局域网 IP(手机需在同一 WiFi),或用内网穿透工具。

## 三、测试

```bash
npm test                                    # 全部（server 的集成测试会 skip）
cd server && node --env-file=.env ../node_modules/jest/bin/jest.js   # 带真库跑
```

jest 不会自动读 `.env`,所以要跑数据库集成测试必须显式用 `node --env-file=.env` 启动它。不带的话那 6 个集成用例会 skip——它们是唯一能验证 PostGIS 空间查询的测试,别长期让它们 skip。

建表和种子由 `server/test/global-setup.ts` 全局跑一次,不在各套件的 `beforeAll` 里。

## 四、部署上线

### 服务端

`server/` 是标准 NestJS 应用,构建产物在 `dist/`,入口 `dist/main.js`。原设计目标是微信云托管(会注入 `PORT`),但任何能跑 Node 的平台都行。

部署要点:

1. **环境变量由平台注入,不要上传 `.env`。** 代码里没有 dotenv,`.env` 只在本地配合 `--env-file` 用。
2. **`SEED_DEMO_DATA` 生产必须留空或设 `0`。** 否则会把 8 只测试宠物插进生产库。
3. **建表自动执行,不需要单独的迁移步骤。** 迁移包在 PostgreSQL 咨询锁里,多副本同时启动也不会互相踩。
4. `npm run build` 会把 `src/database/*.sql` 复制进 `dist/`,别只 `tsc`。
5. Redis 和 PostgreSQL 用托管实例,连接串走平台的密钥管理。

### 小程序

CI 已配好(`.github/workflows/ci.yml`):推 `v*` 标签触发上传体验版,用 `miniprogram-ci`。

上线前必办项在 **`RELEASE_CHECKLIST.md`**,逐项勾。其中和本文档直接相关的:

- `miniprogram/config.ts` 的 `PROD_API_BASE_URL` 换成真实备案域名(现在是 `example.com` 占位)
- `project.config.json` 的 `urlCheck` 恢复 `true`、`appid` 从 `touristappid` 换成正式 AppID
- 域名完成 ICP 备案并登记进小程序后台 request 白名单
- 上传私钥只从 CI Secret 注入,绝不入库

## 五、已知问题

**登录接口在本地必然 500,这是预期的。** `POST /auth/wx-login` 要拿 code 去微信服务器换 openid,没有真实 `WX_APPID` / `WX_SECRET` 就走不通(测试号 `touristappid` 拿不到)。报错是 `缺少环境变量 WX_APPID`。浏览类接口(广场、宠物详情、周边)不需要登录态,不受影响。

**Redis 不可用时登录也会 500,但原因不同。** 登录限流依赖 Redis 且没有降级路径(`RedisRateLimitStore.increment` 无 try/catch)。Redis 挂了、密码错了、或 `REDIS_URL` 格式不对都会 500。排查时先看服务端日志区分是哪一种——两者响应体一样,日志不一样。

这是**待决策项**,不是待修 bug:限流组件失效时应该 fail-open(放行,可能被刷)还是 fail-closed(拒绝,当前行为)是安全取舍。背景见 `docs/superpowers/phase0-carryforward.md`。

**依赖树有 76 个 npm audit 告警。** 处置结论见 `RELEASE_CHECKLIST.md`,不要直接跑 `npm audit fix`。

## 六、约定

改代码前值得知道的几条,有自动化测试把关,违反会红:

- 页面不直接 `wx.request`,统一走 `miniprogram/api/`(`test/wx-guard.spec.ts`)
- 页面不直接 `wx.getLocation`,走 `utils/location`(同上)
- `.wxss` 里不写 hex 字面量和裸 `px`,只用 `styles/tokens.wxss` 的变量(`test/style-guard.spec.ts`)
- 接口统一返回 `{ code, message, data }`,`code: 0` 为成功
- `styles/tokens.wxss`、`components/wf-icon/icons.ts`、`shared/` 是生成物,改源再跑 `npm run build:assets -w miniprogram` 和 `npm run sync:types`,CI 会检查是否漂移
