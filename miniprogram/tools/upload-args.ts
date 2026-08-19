const TAG_PATTERN = /^v(\d+\.\d+\.\d+)$/;

const PEM_PATTERN = /-----BEGIN[\s\S]*?-----END[^-]*-----/g;
// errCode: -1 / "errcode":80051 / errmsg: xxx —— 冒号后取到分隔符为止。
const ERR_FIELD_PATTERN = /(["']?err(?:code|msg)["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^,;}\n]*)/gi;

/**
 * miniprogram-ci 会自己往 stdout 打 errCode/errMsg，我们的 try/catch 拦不住，
 * 所以上传期间把 console 过一遍这个函数。私钥正文同理，绝不能落进日志。
 */
export function redactSensitive(text: string): string {
  return text
    .replace(PEM_PATTERN, '[已隐去私钥]')
    .replace(ERR_FIELD_PATTERN, (_m, label: string) => `${label}[已隐去]`);
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
