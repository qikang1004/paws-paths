import { createHmac } from 'node:crypto';

/**
 * 手机号的规范化、脱敏与查找哈希（spec §4.5 第 4 条）。
 *
 * 加密本身在库里做（pgcrypto 的 `pgp_sym_encrypt`，见 `PostgresUserRepository.setPhone`），
 * 这里只放与库无关、两种仓储都要用的那几样。
 */

/** 两把钥匙的最短长度（字符）。随机生成 32 字节再转 hex 就是 64 个字符，远超这个下限。 */
export const PHONE_KEY_MIN_LENGTH = 32;

export interface PhoneKeys {
  /** pgcrypto 对称加密用，对应 `PHONE_ENC_KEY`。 */
  encKey: string;
  /** 查找哈希（HMAC-SHA256）用，对应 `PHONE_HASH_KEY`。 */
  hashKey: string;
}

/**
 * 从环境变量读两把钥匙。调用时读（同 `JWT_SECRET`）：不绑手机号的部署不必配，
 * 真用到时缺了就直接报错 —— 绝不退化成存明文。
 *
 * 报错只点名变量，**不回显值**：这条消息会进日志。
 */
export function readPhoneKeys(env: Record<string, string | undefined> = process.env): PhoneKeys {
  const encKey = requireKey(env, 'PHONE_ENC_KEY');
  const hashKey = requireKey(env, 'PHONE_HASH_KEY');
  // 用途不同的两把钥匙必须是两把：同一把的话，查找哈希那条路径（Node 进程内的 HMAC）
  // 一旦泄露，密文也跟着失守。
  if (encKey === hashKey) throw new Error('PHONE_ENC_KEY 与 PHONE_HASH_KEY 不能相同');
  return { encKey, hashKey };
}

function requireKey(env: Record<string, string | undefined>, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`缺少环境变量 ${name}`);
  if (value.length < PHONE_KEY_MIN_LENGTH) {
    throw new Error(`环境变量 ${name} 至少 ${PHONE_KEY_MIN_LENGTH} 个字符`);
  }
  return value;
}

/**
 * 规范化成 11 位大陆手机号，不是手机号返回 null。
 *
 * 只收大陆号：`wx.getPhoneNumber` 给的 `purePhoneNumber` 就是这个形状，
 * 而脱敏规则（前三后四）也只对 11 位成立。去掉空格、短横线与 `+86` / `86` 前缀，
 * 保证同一个号无论怎么写，查找哈希都是同一个值。
 */
export function normalizePhone(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let digits = raw.replace(/[\s-]/g, '');
  if (digits.startsWith('+86')) digits = digits.slice(3);
  else if (digits.length === 13 && digits.startsWith('86')) digits = digits.slice(2);
  return /^1[3-9]\d{9}$/.test(digits) ? digits : null;
}

/** 脱敏：前三后四，中间四位打码。入参必须是 `normalizePhone` 的结果。 */
export function maskPhone(phone: string): string {
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
}

/** 查找哈希：HMAC-SHA256(规范化手机号, hashKey) 的小写十六进制。 */
export function phoneLookupHash(phone: string, hashKey: string): string {
  return createHmac('sha256', hashKey).update(phone).digest('hex');
}
