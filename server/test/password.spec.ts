import {
  PASSWORD_MIN_LENGTH,
  hashPassword,
  parseHash,
  verifyPassword,
} from '../src/auth/password';

/**
 * 运营后台的密码哈希（阶段 4：独立 Web 后台）。
 *
 * 用 Node 内置的 `scrypt`，**不引新依赖**：它是内存硬（memory-hard）的 KDF，
 * OWASP 的密码存储指南把它与 argon2 / bcrypt 并列为可接受选项。
 * bcrypt 要么带原生编译（部署环境多一个变数），要么用纯 JS 版（更慢），
 * 而这条路径上「少一个依赖」本身就是安全收益。
 *
 * 这些是**运营**账号的密码 —— 泄一个就等于泄一个能撤下任何内容的身份。
 * 所以下面每条断言都在钉同一件事：哈希必须自描述、必须每次加盐、
 * 比较必须定长时间，且格式要能在将来换算法时平滑迁移。
 */
describe('hashPassword / verifyPassword', () => {
  it('同一个密码两次哈希得到不同结果 —— 每次都用新的随机盐', async () => {
    const a = await hashPassword('correct horse battery staple');
    const b = await hashPassword('correct horse battery staple');
    expect(a).not.toBe(b);
    // 但两者都能验通：盐存在哈希串里，不需要另存一列。
    expect(await verifyPassword('correct horse battery staple', a)).toBe(true);
    expect(await verifyPassword('correct horse battery staple', b)).toBe(true);
  });

  it('密码错一个字符就验不过', async () => {
    const hash = await hashPassword('SuperSecret123');
    expect(await verifyPassword('SuperSecret123', hash)).toBe(true);
    expect(await verifyPassword('SuperSecret124', hash)).toBe(false);
    expect(await verifyPassword('supersecret123', hash)).toBe(false);
    expect(await verifyPassword('', hash)).toBe(false);
  });

  it('哈希串是自描述的：算法 + 参数 + 盐 + 摘要，用 $ 分隔', async () => {
    const hash = await hashPassword('whatever-long-enough');
    // 形如 `scrypt$16384$8$1$<saltB64>$<hashB64>`。带上参数是为了将来能调 N
    // 而不作废已有的哈希 —— 验证时按串里写的参数算，不按当前默认值算。
    const parsed = parseHash(hash);
    expect(parsed).not.toBeNull();
    expect(parsed?.algorithm).toBe('scrypt');
    expect(parsed?.cost).toBeGreaterThanOrEqual(16384);
    expect(parsed?.salt.length).toBeGreaterThanOrEqual(16);
    expect(parsed?.hash.length).toBeGreaterThanOrEqual(32);
  });

  it('用旧参数生成的哈希仍然验得过（参数从串里读，不用当前默认值）', async () => {
    // 手工造一个成本更低的哈希，模拟「几年前用更弱参数存下来的密码」。
    const weak = await hashPassword('legacy-password-x', { cost: 16384 });
    expect(await verifyPassword('legacy-password-x', weak)).toBe(true);
    // 参数确实是从串里读的 —— 不是碰巧与默认值相同。
    expect(parseHash(weak)?.cost).toBe(16384);
  });

  it('哈希串损坏 / 格式不对时验证返回 false，不抛异常', async () => {
    // 库里那一列被手改坏、或迁移出错留下半截值时，登录该失败，
    // 而不是 500 —— 500 会把「这个账号存在但数据坏了」告诉探测者。
    for (const bad of [
      '',
      'not-a-hash',
      'scrypt$16384$8$1$onlyfourfields',
      'scrypt$abc$8$1$c2FsdA==$aGFzaA==',
      'md5$16384$8$1$c2FsdA==$aGFzaA==',
      '$$$$$',
    ]) {
      expect(await verifyPassword('anything', bad)).toBe(false);
      expect(parseHash(bad)).toBeNull();
    }
  });

  it('拒绝过短的密码 —— 运营账号不接受弱口令', async () => {
    expect(PASSWORD_MIN_LENGTH).toBeGreaterThanOrEqual(12);
    await expect(hashPassword('short')).rejects.toThrow(/至少/);
    await expect(hashPassword('a'.repeat(PASSWORD_MIN_LENGTH - 1))).rejects.toThrow(/至少/);
    // 恰好够长就放行。
    await expect(hashPassword('a'.repeat(PASSWORD_MIN_LENGTH))).resolves.toContain('scrypt$');
  });

  it('长度按码点算 —— 中文密码不该因为字节数多而被当成更长', async () => {
    // `'密'.length` 是 1 但 UTF-8 占 3 字节。用字节数算会让 4 个汉字
    // 通过 12 位的门槛，那是个只有中文用户才踩得到的弱口令漏洞。
    await expect(hashPassword('密码密码')).rejects.toThrow(/至少/);
  });

  it('超长密码不被静默截断 —— 直接拒绝', async () => {
    // bcrypt 有 72 字节静默截断的历史坑：用户以为设了个长密码，实际只有前 72 字节
    // 作数。scrypt 没有这个限制，但仍然设一个上限挡住「拿超长输入当 DoS」——
    // scrypt 是故意慢的，输入越长算得越久。
    await expect(hashPassword('a'.repeat(1025))).rejects.toThrow(/过长/);
  });

  it('verifyPassword 用定长时间比较（不是 === ）', async () => {
    // 无法直接测时间，所以测实现：源码里必须出现 timingSafeEqual，
    // 且不能出现拿 hash 直接 === 比较的写法。字符串比较会在第一个不同的字节
    // 处提前返回，逐字节试探就能把摘要问出来。
    const src = require('node:fs').readFileSync(
      require('node:path').join(__dirname, '..', 'src', 'auth', 'password.ts'),
      'utf8',
    ) as string;
    expect(src).toContain('timingSafeEqual');
    // 长度不同时 timingSafeEqual 会抛，所以必须先比长度再比内容 ——
    // 那一步用 !== 是安全的（长度本身不是秘密）。
    // 正则容「点号链」：实际写法是 `actual.length !== parsed.hash.length`。
    expect(src).toMatch(/\.length\s*!==\s*[\w.]+\.length/);
    // 摘要本身不许用 === / !== 直接比 —— 那会在第一个不同的字节处提前返回。
    expect(src).not.toMatch(/parsed\.hash\s*[=!]==/);
  });
});
