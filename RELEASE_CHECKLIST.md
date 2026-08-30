# 上线清单（Release Checklist）

阶段 0 的验收条件之一是用真实 `v0.1.0` 跑通上传工作流。以下必办项此前只藏在
git-ignored 的流程草稿里，移到仓库根显式追踪。逐项勾选。

## 域名与合规

- [ ] 把 `project.config.json` 的 `setting.urlCheck` 恢复为 `true`（当前为 `false`，仅供开发期免校验合法域名）。
- [ ] 完成 ICP 备案，并在微信小程序后台把 `API_BASE_URL` 的域名登记进 request 合法域名白名单。

## AppID 与上传私钥

- [ ] 用正式 AppID 替换 `project.config.json` 里的 `touristappid`。
- [ ] 上传私钥绝不入库：只从 CI Secret 注入，落盘 `private.key` 后在上传步骤结束时 `rm -f`（`.github/workflows/ci.yml` 已含 `if: always()` 清理步骤）。

## 服务端环境变量

- [ ] 确认部署环境的 `FAKE_WECHAT_LOGIN` 留空或为 `0`。这是**认证绕过开关**：开着它任何 code 都能换到 openid，等于谁都能登录成任意用户。启动日志里会有一条 WARN，上线后核对一次。
- [ ] 确认部署环境的 `FAKE_CONTENT_SECURITY` 留空或为 `0`，并用正式 AppID 真跑一次 `msgSecCheck` / `imgSecCheck`。开着它内容安全检查被假实现替代：**不放行**（UGC 一律停在 `pending`），所以不会造成未审内容外泄，但也没有任何内容能自动过审 —— 用户会以为发布坏了。启动日志里有一条 WARN。
      假实现只证明了链路接得上，没证明微信那端的调用是对的，所以「关掉开关」和「真跑一次」是两件事，都要做。
- [ ] 确认 `SEED_DEMO_DATA` 留空或为 `0`，别把 8 只测试宠物插进生产库。
- [ ] `WX_APPID` / `WX_SECRET` 由平台密钥管理注入，不落任何仓库文件。
- [ ] `DATABASE_URL` / `REDIS_URL` 同样只从密钥管理注入。本地那份 `server/.env` 是 gitignored 的开发配置，不是部署来源。
- [ ] 确认数据库账号有建表权限：服务启动时会跑一次 `runMigrations`（幂等，DDL 全是 `IF NOT EXISTS`，且用咨询锁把多实例的并发迁移排成队）。数据库需要 PostGIS 扩展。

## 图片存储与静态资源（阶段 2 新增）

- [ ] 把 `UPLOAD_ROOT` 指向持久卷。默认值 `server/var/uploads` 在容器里随实例销毁，重启即丢图。
- [ ] **多副本部署前必须换对象存储。** 本地磁盘是单机限定的：A 实例上传的图在 B 实例上就是 404（spec §10 要求对象存储，`ImageStorage` 接口留着就是为了只换一个 provider）。
- [ ] 确认反向代理 / CDN 不缓存带 `Cache-Control: private, no-store` 的响应。待审图片只对作者可见（他人一律 404）的前提就是这行响应头，中间层缓存一层就等于把未过审内容公开了。

## 限流降级告警（fail-open 的必要配套）

登录限流是 **fail-open**：Redis 不可用时降级放行，宕机窗口内登录端点没有暴力破解防护。
这个取舍成立的前提是故障能被及时发现，所以下面这条不是可选项。

- [ ] 给日志接一条告警规则，匹配 `限流存储不可用`（logger 名 `RedisRateLimitStore`，级别 ERROR）。
      每次降级放行都会打一条，高频出现即意味着登录端点正在无保护地对外服务。
- [ ] 确认 Redis 自身有可用性监控。限流降级日志是**后果**，不是根因告警。
- [ ] 决策背景与实测数据见 `docs/superpowers/phase1-notes.md`「六、Redis 故障降级决策」。

## 微信后台与 CI Secret

- [ ] 在微信小程序后台把 GitHub Actions 的出口 IP 加入 IP 白名单。
- [ ] 在仓库配置 `WX_PRIVATE_KEY` 与 `WX_APPID` 两个 Actions Secret。

## 首次实跑验收

- [ ] 用真实 Secret 实跑一次 CI 工作流与 `ci.upload`，确认体验版上传成功（推真实 tag `v0.1.0` 触发）。

## 安全跟进

- [ ] 评估锁定依赖树的 76 个 `npm audit` 漏洞告警（4 low / 18 moderate / 12 high / 42 critical），决定升级或豁免。

## 内容审核（阶段 3 新增）

- [ ] **运营账号的 `role` 必须在生产库里手工授予。** `users.role` 默认是 `'user'`，
      而角色**只从库里读**（Global Constraint 28：不进 JWT，否则撤权要等令牌过期）。
      种子里的 `u-mod` 靠不住 —— `SEED_DEMO_DATA` 在生产是关的。
      逐个授权：`UPDATE users SET role = 'moderator' WHERE id = '<真实用户 id>';`
      授完核对一次 `SELECT id, role FROM users WHERE role <> 'user';` —— 这张表就是
      运营后台的全部权限来源，多授一个人等于多一个能撤下任何内容的账号。
- [ ] **`audit_log` 的备份与保留策略单独定，不能跟着库一起清。** 它是合规流水
      （谁在什么时候把哪条内容撤下/放行），监管问起来要拿得出。三条要求：
      ① 纳入定期备份；② **不设自动清理** —— 表上没有 TTL，也别加；
      ③ 应用侧没有删除入口（`AuditLogRepository` 接口连 update/delete 都没有），
      所以任何清理都只能是 DBA 的显式动作，做之前先确认保留期限。
      与 `moderation_tasks` 分开对待：那张是可被更新的工单队列，这张是只追加的流水，
      两者不可互相替代（Global Constraint 25）。
- [ ] **提审前必须关掉 `FAKE_CONTENT_SECURITY` 并用正式 AppID 真跑一次机审。**
      假实现下**没有任何内容会自动过审**（一律停在 `pending`，刻意不放行），
      而举报要求内容当前可见 —— 两条叠起来会让「举报 → 复核」闭环在假实现下走不完。
      走查脚本 `server/test/manual/phase3-walkthrough.mjs` 会检测并提示这一点。
- [ ] **确认举报限流的阈值适合你的量级。** `POST /reports` 挂了 `ReportRateLimitGuard`，
      **按 userId 键控**（不是 IP —— 举报要求登录，滥用单位是账号；按 IP 会连坐
      同一出口的无辜用户，也拦不住换 IP 的人），默认 **一小时 10 次**
      （`REPORT_RATE_LIMIT`，`server/src/common/rate-limit/rate-limit.service.ts`）。
      正常人一小时举报不了 10 条内容；真要放宽先想清楚：每成功一次举报，那条内容
      就立刻对所有人隐藏直到复核。
- [ ] **限流降级告警要能分清 `login:` 与 `report:`。** 两处限流共用
      `RedisRateLimitStore`，Redis 不可用时都 fail-open 放行并打 ERROR 日志
      （日志里带 key 前缀，不带 userId/IP 本身）。两者失守的后果完全不同 ——
      登录是暴力破解风险，举报是「有人能批量下架内容」，告警规则应分开配。
