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
- [ ] 确认 `SEED_DEMO_DATA` 留空或为 `0`，别把 8 只测试宠物插进生产库。
- [ ] `WX_APPID` / `WX_SECRET` 由平台密钥管理注入，不落任何仓库文件。

## 微信后台与 CI Secret

- [ ] 在微信小程序后台把 GitHub Actions 的出口 IP 加入 IP 白名单。
- [ ] 在仓库配置 `WX_PRIVATE_KEY` 与 `WX_APPID` 两个 Actions Secret。

## 首次实跑验收

- [ ] 用真实 Secret 实跑一次 CI 工作流与 `ci.upload`，确认体验版上传成功（推真实 tag `v0.1.0` 触发）。

## 安全跟进

- [ ] 评估锁定依赖树的 76 个 `npm audit` 漏洞告警（4 low / 18 moderate / 12 high / 42 critical），决定升级或豁免。
