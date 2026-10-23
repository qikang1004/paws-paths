# 结转账：手机号加密存储（`phone_enc` / pgcrypto）

对应 `phase3-notes.md` 第八节既有账 1。spec §4.1 的 `users` 表写着 `phone_enc`，§4.5 第 4 条：
「手机号 `phone_enc` 用 `pgcrypto` 加密存储，接口一律返回脱敏形式」。此前没有这一列，也没装 pgcrypto。

## 一、做了什么

- **迁移**（`schema.sql`，幂等）：`CREATE EXTENSION IF NOT EXISTS pgcrypto`；`users` 加
  `phone_enc BYTEA`、`phone_hash TEXT CHECK (phone_hash ~ '^[0-9a-f]{64}$')`，都允许 NULL；
  `phone_hash` 上建部分索引（非唯一）。
- **加密**：`pgp_sym_encrypt(phone, $key, 'cipher-algo=aes256')` / `pgp_sym_decrypt`，钥匙来自
  `PHONE_ENC_KEY`，每次作为**查询参数**传进去，库里不存、SQL 文本里不出现。
- **查找**：spec 没写怎么按号查人。pgp_sym_encrypt 每次加盐，密文不能做等值查找，所以按通行做法
  另加一列确定性的 `phone_hash = HMAC-SHA256(规范化手机号, PHONE_HASH_KEY)`。用带钥匙的 HMAC 而不是
  裸 SHA-256：手机号空间小，裸哈希可以穷举反查。
- **钥匙**：`src/users/phone-crypto.ts` 的 `readPhoneKeys` 在用到时读两把钥匙（同 `JWT_SECRET` 的做法）：
  缺失、短于 32 字符、两把相同都直接报错，报错只点名变量不回显值；绝不退化成存明文。
  `server/.env.example` 只有变量名与说明，没有值。
- **规范化 / 脱敏**：只收大陆 11 位号（去空格、短横线、`+86`），脱敏为前三后四（`138****8000`）。
- **仓储**：`UserRepository.setPhone / findPhone / findIdByPhoneHash`，内存与 Postgres 两种实现同契约。
- **服务**：`UsersService.bindPhone`（只回 `phoneMasked`）/ `maskedPhone` / `findUserIdByPhone`。

## 二、刻意没做 / 已知限制

1. **没有对外端点。** 手机号的来源是 `wx.getPhoneNumber`，需要企业主体且是付费能力（spec §10），
   目前没有这个资质。存储层与服务方法先落好，端点、`/me` 的 `phoneMasked` 字段等资质下来再接。
2. **没有明文数据要迁。** 此前从没有任何手机号列，所以不存在「把旧明文加密回填」这一步。
   将来真要从别处导入明文，走 `UsersService.bindPhone` 逐条写入即可（它会规范化、加密、算哈希）。
3. **钥匙轮换没有实现。** 换 `PHONE_ENC_KEY` 需要一次「旧钥匙解、新钥匙加」的重加密迁移；换
   `PHONE_HASH_KEY` 需要重算全部 `phone_hash`。上线后写入过数据就不能随手换（已写进 `.env.example`
   与 `RELEASE_CHECKLIST.md`）。
4. **查找索引不唯一。** 「一个号只能绑一个账号」是业务规则，spec 没有要求；万一重复，
   `findIdByPhoneHash` 取最早建的账号，结果稳定。
5. **无库模式不模拟加密**：内存仓储只在进程内存里存规范化后的号，加密存储的断言全在 Postgres 门控测试里。

## 三、验证到哪一步

- 无库：单元测试（规范化、脱敏、HMAC、钥匙校验）与内存仓储 / 服务契约全绿；迁移 SQL 文本断言全绿。
- **真库未跑**：`test/user-phone.spec.ts` 的 Postgres 部分（需要 `DATABASE_URL`）会断言：
  `phone_enc` 是 bytea 且不含明文、往返解密一致、拿错钥匙解不开、按哈希查得到；全部在事务里跑完回滚。
  上线前请在真库上跑一遍迁移（确认 pgcrypto 装得上）和这套测试。
