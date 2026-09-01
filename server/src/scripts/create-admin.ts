/**
 * 建一个运营账号（阶段 4：独立 Web 后台）。
 *
 * 跑法（需要 DATABASE_URL）：
 *   node dist/scripts/create-admin.js <用户名> <角色>
 * 密码从 **stdin** 读，不走命令行参数 —— 参数会进 shell history 与 `ps` 输出。
 *
 * **刻意没有对应的 HTTP 端点**：运营账号不该能从公网创建。加人要登服务器，
 * 换来的是「注册入口忘了删」这类事故的概率归零。
 *
 * 这个脚本只做一件事：给一个**已存在的**用户挂上用户名与密码，或者建一个
 * 只有凭据、没有微信身份的纯运营账号。它不授予角色之外的任何东西 ——
 * 权限判定仍然每次请求从 `users.role` 读（Global Constraint 28）。
 *
 * 那条 upsert 本身在 `../auth/admin-account.ts`：这个文件从 argv 取参、
 * 从 stdin 读密码、跑完 `process.exit`，测试碰不到它，而那条 SQL 是整条链上
 * 唯一会写库的语句，必须可测。
 */
import { createInterface } from 'node:readline';
import { Pool } from 'pg';
import { USER_ROLES, type UserRole } from '@paws/types';
import { upsertAdminAccount } from '../auth/admin-account';
import { hashPassword, PASSWORD_MIN_LENGTH } from '../auth/password';

/** 只允许授这两个 —— `user` 不需要用户名密码（小程序用户走微信）。 */
const GRANTABLE: readonly UserRole[] = ['moderator', 'admin'];

function usage(message: string): never {
  console.error(`错误：${message}

用法：node dist/scripts/create-admin.js <用户名> <角色>
  <用户名>  3–32 个字符，只允许字母数字与 . _ -（登录时按它精确匹配）
  <角色>    ${GRANTABLE.join(' | ')}

密码从 stdin 读（不回显不了 —— 这是脚本不是 TTY 工具，别在有旁人时跑）：
  echo '你的密码' | node dist/scripts/create-admin.js ops-alice moderator
或交互式输入后按 Ctrl-D。

密码至少 ${PASSWORD_MIN_LENGTH} 位（按码点算）。`);
  process.exit(2);
}

/** 用户名限制得比密码严：它进 URL 与日志，也是唯一索引的键。 */
function parseUsername(raw: string | undefined): string {
  const username = (raw ?? '').trim();
  if (!username) usage('缺少用户名');
  if (!/^[A-Za-z0-9._-]{3,32}$/.test(username)) {
    usage(`用户名不合法：${username}（3–32 位，只允许字母数字与 . _ -）`);
  }
  return username;
}

function parseRole(raw: string | undefined): UserRole {
  const role = (raw ?? '').trim();
  if (!(GRANTABLE as readonly string[]).includes(role)) {
    usage(`角色只能是 ${GRANTABLE.join(' / ')}，收到：${role || '(空)'}`);
  }
  return role as UserRole;
}

/** 读 stdin 的全部内容当密码。尾部换行要去掉 —— `echo` 会带一个。 */
async function readPassword(): Promise<string> {
  const rl = createInterface({ input: process.stdin });
  const lines: string[] = [];
  for await (const line of rl) lines.push(line);
  const password = lines.join('\n');
  if (!password) usage('stdin 里没有密码');
  return password;
}

async function main(): Promise<void> {
  const username = parseUsername(process.argv[2]);
  const role = parseRole(process.argv[3]);

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('错误：需要 DATABASE_URL —— 运营账号只存在于真库里。');
    process.exit(2);
  }

  const password = await readPassword();
  // 长度校验在 hashPassword 里，抛出来的报错已经说清了规则。
  const passwordHash = await hashPassword(password);

  const pool = new Pool({ connectionString, max: 1 });
  try {
    const result = await upsertAdminAccount(pool, { username, passwordHash, role });
    if (!result) {
      console.error('错误：既没更新也没插入 —— 检查库里 username 那一列是否存在（跑过迁移吗）。');
      process.exit(1);
    }
    console.log(
      result.created
        ? `已建运营账号：${username}（${role}），userId=${result.userId}`
        : `已更新既有账号的密码与角色：${username}（${role}），userId=${result.userId}`,
    );
    console.log('提醒：角色随时可撤 —— UPDATE users SET role = \'user\' WHERE username = $1；');
    console.log('      令牌里不带角色，所以撤权立即生效，不必等令牌过期。');
  } finally {
    await pool.end();
  }
}

void main().catch((err: unknown) => {
  console.error(`建号失败：${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
