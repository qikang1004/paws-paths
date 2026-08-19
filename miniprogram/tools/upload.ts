import { resolve } from 'node:path';
import ci from 'miniprogram-ci';
import { redactSensitive, requireEnv, resolveDesc, resolveVersion } from './upload-args';

type ConsoleMethod = 'log' | 'info' | 'warn' | 'error';
const GUARDED: ConsoleMethod[] = ['log', 'info', 'warn', 'error'];

/**
 * miniprogram-ci 内部直接往 console 打日志，里面会带 errCode/errMsg，
 * 我们的 try/catch 管不到。所以上传期间接管 console，全部过一遍脱敏。
 */
async function withRedactedConsole<T>(fn: () => Promise<T>): Promise<T> {
  const saved = GUARDED.map((name) => [name, console[name]] as const);
  for (const [name, original] of saved) {
    console[name] = (...args: unknown[]): void => {
      original(...args.map((a) => redactSensitive(typeof a === 'string' ? a : String(a))));
    };
  }
  try {
    return await fn();
  } finally {
    for (const [name, original] of saved) console[name] = original;
  }
}

/** project.config.json 在仓库根，不在 miniprogram/ 里。 */
const PROJECT_PATH = resolve(__dirname, '../..');

/**
 * 微信接口的报错原文常带 errcode/errmsg，还可能回显私钥路径，
 * 一旦进了 CI 日志就等于公开。所以这里把原文整体丢掉，只留排查清单。
 */
const UPLOAD_FAILED_HINT = [
  '体验版上传失败（已隐去微信接口返回原文，避免密钥与错误码进日志）。',
  '按这几项自查：',
  '  1. 上传密钥是否与 WX_APPID 对应，是否已在小程序后台重置过；',
  '  2. GitHub Actions 出口 IP 是否加进了后台的 IP 白名单；',
  '  3. robot 编号（WX_CI_ROBOT）是否被其他流水线占用；',
  '  4. tag 是否是 vX.Y.Z，且该版本号未被上传过。',
  '完整报错请到小程序后台「版本管理」查看，不要把接口原文贴进日志或 issue。',
].join('\n');

class UploadFailedError extends Error {
  constructor() {
    super(UPLOAD_FAILED_HINT);
    this.name = 'UploadFailedError';
  }
}

async function main(): Promise<void> {
  const env = process.env;
  requireEnv(env, ['WX_APPID', 'WX_PRIVATE_KEY_PATH']);
  const version = resolveVersion(env);
  const desc = resolveDesc(env, version);

  try {
    await withRedactedConsole(async () => {
      const project = new ci.Project({
        appid: env.WX_APPID as string,
        type: 'miniProgram',
        projectPath: PROJECT_PATH,
        privateKeyPath: resolve(env.WX_PRIVATE_KEY_PATH as string),
        ignores: ['node_modules/**/*'],
      });

      await ci.upload({
        project,
        version,
        desc,
        // es6 关掉：源码已由 tsc/开发者工具编译，重复转换只会拖慢构建。
        setting: { es6: false, minify: true },
        robot: Number(env.WX_CI_ROBOT ?? 1),
      });
    });
  } catch {
    // 故意不透传原始 error：它的 message 里可能有 errcode/errmsg 与密钥路径。
    throw new UploadFailedError();
  }

  // 只报版本号。上传结果对象整体不打印，避免把接口返回原文写进日志。
  console.log(`已上传体验版 ${version}`);
}

// 与 sync-types.ts 同一写法：miniprogram 的 tsconfig 下 require 不是 NodeRequire，
// 直接写 require.main 会报 TS2339。
const mainModule = (require as unknown as { main?: unknown }).main;

if (mainModule === module) {
  main().catch((err: Error) => {
    console.error(err.message);
    process.exit(1);
  });
}
