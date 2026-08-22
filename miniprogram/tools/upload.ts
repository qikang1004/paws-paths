import { resolve } from 'node:path';
import ci from 'miniprogram-ci';
import { hasErrField, redactSensitive, requireEnv, resolveDesc, resolveVersion } from './upload-args';

type LogFn = (...args: unknown[]) => void;
type Sink = Record<string, LogFn | undefined>;

/** 进度类通道：脱敏后放行，排查上传卡在哪一步全靠它。 */
const REDACTED_CHANNELS = ['log', 'info'];
/**
 * 失败类通道：默认同样「脱敏后放行」，保住可诊断性——该库 error 通道以工具链输出为主
 * （postcss/WXML 编译失败带文件路径、worker 崩溃重试、子进程 stderr 透传、"params …
 * is invalid" 这类校验），整条压制会把编译失败也吞掉，ci.upload() 先编译再上传，
 * 结果编译错误反复只剩一行 notice、还被 UploadFailedError 误导到 IP 白名单去。
 *
 * 唯一例外：检测到 errcode/errmsg 字段特征时整条压制（fail-closed）。因为真正的
 * 接口错误里 errmsg 的值可能落在与标签相邻的另一个位置参数（CodeError 打的是
 * log.error(code, message)，request 打的是 `${url} ${err}`，warn 可能分成
 * ('errCode: -1', 'invalid ip …') 两段），逐参数脱敏会放过无标签那半段的正文，
 * 所以一旦嗅到字段特征就把整条（含全部位置参数）压掉。
 */
const FAILCLOSE_CHANNELS = ['warn', 'error'];

const SUPPRESSED_NOTICE = '[已隐去微信接口错误详情]';

/** 对象不转文本就等于原样透传给 console，脱敏白做。Error 单独处理：JSON.stringify 对它只给 {}。 */
function toRedactableText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value); // 循环引用
  }
}

function patchSink(sink: Sink, restore: Array<() => void>): void {
  const install = (name: string, wrap: (orig: LogFn) => LogFn): void => {
    const original = sink[name];
    if (typeof original !== 'function') return;
    sink[name] = wrap(original);
    restore.push(() => {
      sink[name] = original;
    });
  };

  for (const name of REDACTED_CHANNELS) {
    install(name, (orig) => (...args: unknown[]) => {
      orig(...args.map((a) => redactSensitive(toRedactableText(a))));
    });
  }
  for (const name of FAILCLOSE_CHANNELS) {
    install(name, (orig) => (...args: unknown[]) => {
      const texts = args.map(toRedactableText);
      // 任一位置参数带 errcode/errmsg 字段特征 → 整条压掉，跨参数的裸值也一起丢。
      if (texts.some(hasErrField)) {
        orig(SUPPRESSED_NOTICE);
        return;
      }
      // 其余（编译/worker/校验类诊断）脱敏后照常可见。
      orig(...texts.map(redactSensitive));
    });
  }
}

/**
 * dist/utils/log.js 在模块加载时就按引用抓走了 console.*
 * （exports.default={info:console.info,...}），而本文件顶层 import miniprogram-ci
 * 已让它缓存原始函数——之后再替换 console.* 对它完全无效，实测拦到 0 行。
 * 所以必须改写这个对象的属性本身。实测其属性 writable/configurable 均为 true、
 * 对象未冻结，退出时能还原（不像「require 前打 console 补丁」那样被永久冻住，
 * 也不依赖 import 顺序）。
 */
function loadLibLogSink(): Sink | undefined {
  try {
    const req = require as unknown as (id: string) => { default: Sink };
    return req('miniprogram-ci/dist/utils/log').default;
  } catch {
    return undefined; // 库结构变了就降级为只补 console，别让脱敏失败把上传搞挂
  }
}

/**
 * 库内 77 处经 log.default.* 输出（含 CodeError、request url、响应体转储等
 * 全部 errCode/errMsg 泄漏点），另有 74 处绕开门面直接 console.*，
 * 两条路都得堵，所以两个 sink 都打补丁。
 */
export async function withRedactedLogging<T>(fn: () => Promise<T>): Promise<T> {
  const restore: Array<() => void> = [];
  const sink = loadLibLogSink();
  if (sink) patchSink(sink, restore);
  patchSink(console as unknown as Sink, restore);
  try {
    return await fn();
  } finally {
    for (const undo of restore.reverse()) undo();
  }
}

/** project.config.json 在仓库根，不在 miniprogram/ 里。 */
const PROJECT_PATH = resolve(__dirname, '../..');

/**
 * 微信接口的报错原文常带 errcode/errmsg，还可能回显私钥路径，
 * 一旦进了 CI 日志就等于公开。所以这里不透传接口原文，只留排查清单。
 *
 * 注意：ci.upload() 先编译后上传。编译期错误（postcss/WXML/worker/校验）现在会
 * 经 error 通道脱敏后如实打印在本提示上方——遇到失败请先看上方日志判断是「编译失败」
 * 还是「上传/接口失败」，别一上来就照下面的接口清单排查。下面几项只针对接口失败。
 */
const UPLOAD_FAILED_HINT = [
  '上传流程失败（接口返回原文已隐去，避免密钥与错误码进日志）。',
  '请先看上方日志：若是 postcss / WXML / 依赖等编译报错，按其中的文件路径直接修源码即可。',
  '若上方无编译错误、确属上传/接口失败，再按这几项自查：',
  '  1. 上传密钥是否与 WX_APPID 对应，是否已在小程序后台重置过；',
  '  2. GitHub Actions 出口 IP 是否加进了后台的 IP 白名单；',
  '  3. robot 编号（WX_CI_ROBOT）是否被其他流水线占用；',
  '  4. tag 是否是 vX.Y.Z，且该版本号未被上传过。',
  '完整接口报错请到小程序后台「版本管理」查看，不要把接口原文贴进日志或 issue。',
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
    await withRedactedLogging(async () => {
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
