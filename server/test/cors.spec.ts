import { corsOptionsFor, parseAllowedOrigins } from '../src/common/cors';

/**
 * 跨域配置（运营后台的前置条件）。
 *
 * **小程序不需要 CORS** —— `wx.request` 不受同源策略约束，从来没有 Origin 头。
 * 这套配置只为一件事存在：让独立部署的运营后台（浏览器里的 Web 应用，
 * 与 API 不同源）能调 `/moderation/*`。
 *
 * 因此默认必须**关着**：没配 `ADMIN_ORIGINS` 就等于没有 Web 后台，
 * 那时开放任何跨域来源都是白送攻击面。
 */
describe('parseAllowedOrigins', () => {
  it('未配置 / 空串 → 空数组（fail closed，不是放开）', () => {
    expect(parseAllowedOrigins(undefined)).toEqual([]);
    expect(parseAllowedOrigins('')).toEqual([]);
    expect(parseAllowedOrigins('   ')).toEqual([]);
  });

  it('逗号分隔多个来源，去空白', () => {
    expect(parseAllowedOrigins('https://admin.example.com, http://localhost:5173')).toEqual([
      'https://admin.example.com',
      'http://localhost:5173',
    ]);
  });

  it('丢掉重复项 —— 同一来源写两遍不该出现在响应头里两次', () => {
    expect(parseAllowedOrigins('https://a.com,https://a.com')).toEqual(['https://a.com']);
  });

  it('拒绝通配符 `*`，即使混在清单里', () => {
    // 运营后台的令牌能撤下任何内容。`*` 在这条 API 上没有任何合理用途，
    // 而「临时设成 * 调通了就忘了改」是最常见的上线事故 —— 直接不接受。
    expect(() => parseAllowedOrigins('*')).toThrow(/通配符/);
    expect(() => parseAllowedOrigins('https://admin.example.com,*')).toThrow(/通配符/);
  });

  it('拒绝不带协议或带路径的值 —— Origin 比对是精确字符串匹配', () => {
    // 浏览器发的 Origin 恒为 `协议://主机[:端口]`，没有路径、没有尾斜杠。
    // 配错一个字符的后果是「跨域静默失败」，那种问题最难查，所以启动时就拦。
    expect(() => parseAllowedOrigins('admin.example.com')).toThrow(/协议/);
    expect(() => parseAllowedOrigins('https://admin.example.com/')).toThrow(/路径/);
    expect(() => parseAllowedOrigins('https://admin.example.com/moderation')).toThrow(/路径/);
  });

  it('允许 http 但仅限本地开发地址', () => {
    // 生产用 http 等于把运营令牌明文放在网络上。localhost/127.0.0.1 是例外 ——
    // 本地起 Vite dev server 时没有证书。
    expect(parseAllowedOrigins('http://localhost:5173')).toEqual(['http://localhost:5173']);
    expect(parseAllowedOrigins('http://127.0.0.1:5173')).toEqual(['http://127.0.0.1:5173']);
    expect(() => parseAllowedOrigins('http://admin.example.com')).toThrow(/https/);
  });
});

describe('corsOptionsFor', () => {
  it('没有来源时返回 null —— 调用方据此完全不开启 CORS', () => {
    expect(corsOptionsFor([])).toBeNull();
  });

  it('origin 是精确清单，不是反射回请求的 Origin', () => {
    const opts = corsOptionsFor(['https://admin.example.com']);
    expect(opts).not.toBeNull();
    // 反射请求里的 Origin（`origin: true`）等于对所有来源开放 —— 那是
    // 「看起来配了白名单，实际等于 *」的经典错法。
    expect(opts?.origin).toEqual(['https://admin.example.com']);
  });

  it('不开 credentials —— 这套 API 用 Bearer 头，不用 Cookie', () => {
    // 不带 Cookie 就没有 CSRF 面：跨站请求带不上凭据，攻击者拿不到令牌。
    // 真要开 credentials，得连带补 CSRF 防护，那是另一整件事。
    expect(corsOptionsFor(['https://admin.example.com'])?.credentials).toBe(false);
  });

  it('只允许后台真正用到的方法与头', () => {
    const opts = corsOptionsFor(['https://admin.example.com']);
    // 运营后台只读工单、发复核 —— 没有 PUT / DELETE 的用途。
    expect(opts?.methods).toEqual(['GET', 'POST', 'OPTIONS']);
    expect(opts?.allowedHeaders).toEqual(['Authorization', 'Content-Type']);
  });

  it('预检结果可缓存，但不长 —— 改白名单后不必等一天才生效', () => {
    expect(corsOptionsFor(['https://admin.example.com'])?.maxAge).toBe(600);
  });
});
