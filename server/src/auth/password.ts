import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

/**
 * `promisify(scrypt)` 只挑得到不带 options 的那个重载（3 参版），而成本参数必须
 * 从 options 传 —— 所以手写这层包装而不是用 promisify。
 */
function scryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (err, derived) => {
      if (err) reject(err);
      else resolve(derived);
    });
  });
}

/**
 * 运营后台账号的密码哈希。
 *
 * 用 Node 内置的 **scrypt**，不引新依赖：它是内存硬的 KDF，OWASP 的密码存储
 * 指南把它与 argon2 / bcrypt 并列为可接受选项。bcrypt 要么带原生编译
 * （部署环境多一个变数），要么用纯 JS 版（更慢），而这条路径上「少一个依赖」
 * 本身就是安全收益。
 *
 * 这些是**运营**账号的密码 —— 泄一个等于泄一个能撤下任何内容的身份。
 *
 * 只用于运营后台，**不用于普通用户**：小程序用户走微信登录（`openid`），
 * 压根没有密码。这也是为什么密码列加在 `users` 上却允许为 NULL。
 */

/** 密码最短长度，按**码点**算。运营账号不接受弱口令。 */
export const PASSWORD_MIN_LENGTH = 12;

/**
 * 上限。scrypt 没有 bcrypt 那个 72 字节静默截断的坑，但仍要挡住
 * 「拿超长输入当 DoS」—— 这个函数是故意慢的，输入越长算得越久。
 */
export const PASSWORD_MAX_LENGTH = 1024;

/**
 * scrypt 的成本参数。N=16384 / r=8 / p=1 是 Node 文档的推荐起点，
 * 单次约 50–100ms —— 登录是低频操作，这个代价换的是离线爆破成本。
 *
 * 这三个值**写进哈希串**（见 `formatHash`），验证时按串里的值算而不是按这里的
 * 默认值算。所以将来调高 N 不会作废已存下的哈希，老账号下次登录照常验得过。
 */
const DEFAULT_COST = 16384;
const BLOCK_SIZE = 8;
const PARALLELIZATION = 1;
const SALT_BYTES = 16;
const KEY_BYTES = 32;

/** 只有一种算法，但格式里留了这一格 —— 将来换 argon2 时靠它区分新旧哈希。 */
const ALGORITHM = 'scrypt';

export interface ParsedHash {
  algorithm: string;
  cost: number;
  blockSize: number;
  parallelization: number;
  salt: Buffer;
  hash: Buffer;
}

/** `scrypt$16384$8$1$<saltB64>$<hashB64>` —— 自描述，不需要另存参数列。 */
function formatHash(parsed: Omit<ParsedHash, 'algorithm'>): string {
  return [
    ALGORITHM,
    parsed.cost,
    parsed.blockSize,
    parsed.parallelization,
    parsed.salt.toString('base64'),
    parsed.hash.toString('base64'),
  ].join('$');
}

/**
 * 解析哈希串。格式不对返回 `null`（不抛）—— 库里那一列被手改坏、或迁移留下
 * 半截值时，登录该失败而不是 500：500 会把「这个账号存在但数据坏了」告诉探测者。
 */
export function parseHash(stored: string): ParsedHash | null {
  const parts = stored.split('$');
  if (parts.length !== 6) return null;
  const [algorithm, costRaw, blockRaw, parallelRaw, saltRaw, hashRaw] = parts;
  if (algorithm !== ALGORITHM) return null;

  const cost = Number(costRaw);
  const blockSize = Number(blockRaw);
  const parallelization = Number(parallelRaw);
  // 参数必须是正整数：非数字会让 scrypt 抛，而 NaN 传进去的报错离原因很远。
  if (![cost, blockSize, parallelization].every((n) => Number.isInteger(n) && n > 0)) return null;

  const salt = Buffer.from(saltRaw, 'base64');
  const hash = Buffer.from(hashRaw, 'base64');
  // base64 解码不会失败，只会得到空/截断的 buffer，所以在这里卡长度。
  if (salt.length < SALT_BYTES || hash.length < KEY_BYTES) return null;

  return { algorithm, cost, blockSize, parallelization, salt, hash };
}

function assertLength(password: string): void {
  // 按**码点**数，不是 `String.length` 也不是字节数：
  //   · 用字节数算会让 4 个汉字（12 字节）通过 12 位的门槛 —— 那是个只有中文
  //     用户才踩得到的弱口令漏洞；
  //   · `String.length` 对 emoji 是 2，反而会让含 emoji 的密码「显得更长」。
  const points = [...password].length;
  if (points < PASSWORD_MIN_LENGTH) {
    throw new Error(`密码至少 ${PASSWORD_MIN_LENGTH} 位`);
  }
  if (points > PASSWORD_MAX_LENGTH) {
    throw new Error(`密码过长（上限 ${PASSWORD_MAX_LENGTH} 位）`);
  }
}

/** 哈希一个新密码。`cost` 只在测试里传 —— 生产一律用默认值。 */
export async function hashPassword(
  password: string,
  opts: { cost?: number } = {},
): Promise<string> {
  assertLength(password);
  const cost = opts.cost ?? DEFAULT_COST;
  const salt = randomBytes(SALT_BYTES);
  const hash = await scryptAsync(password, salt, KEY_BYTES, {
    N: cost,
    r: BLOCK_SIZE,
    p: PARALLELIZATION,
  });
  return formatHash({
    cost,
    blockSize: BLOCK_SIZE,
    parallelization: PARALLELIZATION,
    salt,
    hash,
  });
}

/**
 * 校验密码。任何异常都收敛成 `false` —— 这条路径上只有两种合理结果。
 *
 * **参数从哈希串里读**，不用当前默认值：那是「调高成本参数不作废老哈希」的关键。
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parseHash(stored);
  if (!parsed) return false;
  // 不校验长度：长度规则是**设密码**时的约束，改规则不该让老账号登不进来。
  try {
    const actual = await scryptAsync(password, parsed.salt, parsed.hash.length, {
      N: parsed.cost,
      r: parsed.blockSize,
      p: parsed.parallelization,
    });
    // 长度不同时 timingSafeEqual 会抛，所以先比长度 —— 长度本身不是秘密，
    // 这一步用 !== 是安全的。内容一律走定长时间比较：字符串比较会在第一个
    // 不同的字节处提前返回，逐字节试探就能把摘要问出来。
    if (actual.length !== parsed.hash.length) return false;
    return timingSafeEqual(actual, parsed.hash);
  } catch {
    return false;
  }
}
