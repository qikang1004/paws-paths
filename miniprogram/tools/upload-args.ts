const TAG_PATTERN = /^v(\d+\.\d+\.\d+)$/;

const PEM_PATTERN = /-----BEGIN[\s\S]*?-----END[^-]*-----/g;

/**
 * 覆盖 errCode / errmsg / err_msg / error_code / base_resp.err_msg 等写法。
 * JSON 串必须认 \" 转义：否则 {"errmsg":"bad \"q\" invalid ip"} 会在转义引号处
 * 截断，值的尾部照样漏进日志。
 */
const ERR_FIELD_PATTERN =
  /(["']?err(?:or)?_?(?:code|msg)["']?\s*[:=]\s*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^,;}\n]*)/gi;

/** request url 的查询串带 appid，路径留着好排查，问号后面整段隐去。 */
const URL_QUERY_PATTERN = /(https?:\/\/[^\s?]*)\?[^\s]*/gi;

/** appid 也可能脱离完整 url 单独出现。 */
const SENSITIVE_PARAM_PATTERN = /\b(appid|access_token|secret)=([^&\s]*)/gi;

/**
 * miniprogram-ci 自己往 console 打 errCode/errMsg，我们的 try/catch 拦不住，
 * 所以上传期间把它的日志出口过一遍这个函数。私钥正文同理，绝不能落进日志。
 * 替换顺序有讲究：URL 先做，?appid=.. 变成 ?[已隐去] 后参数模式不会再命中同一段。
 */
export function redactSensitive(text: string): string {
  return text
    .replace(PEM_PATTERN, '[已隐去私钥]')
    .replace(URL_QUERY_PATTERN, (_m, base: string) => `${base}?[已隐去]`)
    .replace(ERR_FIELD_PATTERN, (_m, label: string) => `${label}[已隐去]`)
    .replace(SENSITIVE_PARAM_PATTERN, (_m, key: string) => `${key}=[已隐去]`);
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
