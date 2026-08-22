const TAG_PATTERN = /^v(\d+\.\d+\.\d+)$/;

const PEM_PATTERN = /-----BEGIN[\s\S]*?-----END[^-]*-----/g;

/**
 * 覆盖 errCode / errmsg / err_msg / error_code / base_resp.err_msg 等写法。
 * JSON 串必须认 \" 转义：否则 {"errmsg":"bad \"q\" invalid ip"} 会在转义引号处
 * 截断，值的尾部照样漏进日志。
 */
const ERR_FIELD_PATTERN =
  /(["']?err(?:or)?_?(?:code|msg)["']?\s*[:=]\s*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^,;}\n]*)/gi;

/**
 * 与 ERR_FIELD_PATTERN 的标签部分同源，只用来「探测是否带 errcode/errmsg 字段」。
 * 无 g 标志，可安全反复 .test()（有 g 时 lastIndex 有状态，会漏判）；要求标签后紧跟
 * : 或 =，把「字段形态的接口错误」和正文里恰好出现 error 一词区分开。
 */
const ERR_FIELD_DETECT = /["']?err(?:or)?_?(?:code|msg)["']?\s*[:=]/i;

/**
 * request url 的查询串带 appid，路径留着好排查，问号后面整段隐去。
 * 字符类要排除 ] } ) 与引号：日志里 URL 常被 `CGI[url]` 这类括号包住，
 * 早先的 [^\s]* 会把结尾的 ] 一起吃掉，隐去后括号不闭合（纯外观问题）。
 */
const URL_QUERY_PATTERN = /(https?:\/\/[^\s?]*)\?[^\s"'\])}]*/gi;

/** appid / signature 等也可能脱离完整 url，以 key=value 形式单独出现。 */
const SENSITIVE_PARAM_PATTERN = /\b(appid|access_token|secret|signature)=([^&\s]*)/gi;

/** JSON 形态的 "appid":"..." / "signature":"..."：抓不到就会绕过上面的 key=value 规则。 */
const SENSITIVE_JSON_PATTERN =
  /(["'](?:appid|access_token|secret|signature)["']\s*:\s*)(["'][^"']*["'])/gi;

/**
 * miniprogram-ci 自己往 console 打 errCode/errMsg，我们的 try/catch 拦不住，
 * 所以上传期间把它的日志出口过一遍这个函数。私钥正文同理，绝不能落进日志。
 * 替换顺序有讲究：URL 先做，?appid=.. 变成 ?[已隐去] 后参数模式不会再命中同一段。
 *
 * 固有限制（info/log 通道，尽力而为）：本函数只认「带标签」的敏感串。库里
 * jsonRespParse 在 JSON 解析失败时会经 log.info 转储原始响应体（core/utils/jsonParse.js），
 * 若该响应体本身畸形、字段无 errcode/errmsg 标签，正则无从识别、可能透传。
 * 这是正则脱敏方案的固有短板，不在本次收窄范围内彻底解决——真正的接口错误码
 * 走的是 error 通道，由 hasErrField 的 fail-closed 判定兜底。
 */
export function redactSensitive(text: string): string {
  return text
    .replace(PEM_PATTERN, '[已隐去私钥]')
    .replace(URL_QUERY_PATTERN, (_m, base: string) => `${base}?[已隐去]`)
    .replace(ERR_FIELD_PATTERN, (_m, label: string) => `${label}[已隐去]`)
    .replace(SENSITIVE_PARAM_PATTERN, (_m, key: string) => `${key}=[已隐去]`)
    .replace(SENSITIVE_JSON_PATTERN, (_m, label: string) => `${label}[已隐去]`);
}

/**
 * 是否带 errcode/errmsg 字段特征。error/warn 通道用它做 fail-closed 判定：
 * 命中即整条压掉，而不是脱敏后放行——因为接口错误的 errmsg 值可能跨多个位置参数
 * （如 warn('errCode: -1', 'invalid ip ...')），逐参数脱敏会漏掉后一个参数里的正文。
 */
export function hasErrField(text: string): boolean {
  return ERR_FIELD_DETECT.test(text);
}

/** 缺哪些一次说清，别让人跑一次补一个。 */
export function requireEnv(env: NodeJS.ProcessEnv, names: string[]): void {
  const missing = names.filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new Error(`缺少环境变量：${missing.join(', ')}`);
  }
}

/** 版本号只允许来自 git tag 或显式覆盖，禁止读 package.json——那个会忘记改。 */
export function resolveVersion(env: NodeJS.ProcessEnv): string {
  if (env.UPLOAD_VERSION) return env.UPLOAD_VERSION;
  const ref = env.GITHUB_REF_NAME;
  if (!ref) {
    throw new Error('没有 tag，也没给 UPLOAD_VERSION，无法确定体验版版本号');
  }
  const matched = TAG_PATTERN.exec(ref);
  if (!matched) {
    throw new Error(`tag ${ref} 不符合 vX.Y.Z 格式`);
  }
  return matched[1];
}

export function resolveDesc(env: NodeJS.ProcessEnv, version: string): string {
  if (env.UPLOAD_DESC) return env.UPLOAD_DESC;
  const sha = (env.GITHUB_SHA ?? 'local').slice(0, 7);
  return `体验版 ${version} · ${sha}`;
}
