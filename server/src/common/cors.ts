/**
 * 跨域配置，**只为运营后台存在**。
 *
 * 小程序不需要它 —— `wx.request` 不受同源策略约束，从来不发 Origin 头。
 * 会需要 CORS 的只有一种调用方：浏览器里的运营后台（独立部署，与 API 不同源）。
 *
 * 所以默认必须关着：没配 `ADMIN_ORIGINS` 就说明还没有 Web 后台，
 * 那时开放任何跨域来源都是白送攻击面。这个模块的每一条校验都朝同一个方向 ——
 * **配错就启动失败，而不是静默放宽**。运营令牌能撤下任何内容，
 * 这条路径上「宽松的默认值」的代价太高。
 */

/** 传给 `app.enableCors` 的形状。只列本项目真正用到的字段。 */
export interface CorsOptions {
  origin: string[];
  credentials: boolean;
  methods: string[];
  allowedHeaders: string[];
  maxAge: number;
}

/** http 只对本地开发地址放行 —— 生产用 http 等于把运营令牌明文放在网络上。 */
const LOCAL_HTTP = /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/;

/**
 * 解析 `ADMIN_ORIGINS`（逗号分隔）。
 *
 * 校验在**启动时**做而不是请求时：配错一个字符的表现是「跨域静默失败」，
 * 浏览器控制台里那条 CORS 报错离真正的原因（环境变量里多了个尾斜杠）很远。
 * 启动就崩反而好查。
 */
export function parseAllowedOrigins(raw: string | undefined): string[] {
  const items = (raw ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  for (const item of items) {
    // `*` 在这条 API 上没有任何合理用途，而「临时设成 * 调通了就忘了改」
    // 是最常见的上线事故 —— 不接受，连混在清单里也不行。
    if (item === '*' || item.includes('*')) {
      throw new Error(`ADMIN_ORIGINS 不接受通配符：${item}`);
    }
    if (!item.startsWith('http://') && !item.startsWith('https://')) {
      throw new Error(`ADMIN_ORIGINS 的每一项必须带协议（https://...）：${item}`);
    }
    // 浏览器发的 Origin 恒为 `协议://主机[:端口]` —— 没有路径也没有尾斜杠，
    // 而比对是精确字符串匹配，多一个字符就永远匹配不上。
    const afterScheme = item.slice(item.indexOf('://') + 3);
    if (afterScheme.includes('/')) {
      throw new Error(`ADMIN_ORIGINS 的每一项不能带路径或尾斜杠：${item}`);
    }
    if (item.startsWith('http://') && !LOCAL_HTTP.test(item)) {
      throw new Error(`ADMIN_ORIGINS 只允许 https（本地 localhost/127.0.0.1 例外）：${item}`);
    }
  }

  // 去重：同一来源写两遍不该出现在响应头里两次。
  return [...new Set(items)];
}

/**
 * 由来源清单生成 CORS 选项。清单为空时返回 `null` —— 调用方据此**完全不开启**
 * CORS，而不是开一个空白名单（后者仍会发预检响应，行为上更难解释）。
 */
export function corsOptionsFor(origins: string[]): CorsOptions | null {
  if (origins.length === 0) return null;
  return {
    // 精确清单，**不是** `origin: true`。反射请求里的 Origin 等于对所有来源开放 ——
    // 那是「看起来配了白名单、实际等于 *」的经典错法。
    origin: origins,
    // 这套 API 用 `Authorization: Bearer`，不用 Cookie。不开 credentials 就没有
    // CSRF 面（跨站请求带不上凭据）。真要开得连带补 CSRF 防护，那是另一整件事。
    credentials: false,
    // 运营后台只读工单、发复核。没有 PUT / DELETE 的用途。
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    // 预检可缓存，但不长 —— 改白名单后不必等一天才生效。
    maxAge: 600,
  };
}
