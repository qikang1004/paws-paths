import { hasErrField, redactSensitive, requireEnv, resolveDesc, resolveVersion } from '../tools/upload-args';
// 故意从 upload.ts 导入：它顶层 import miniprogram-ci，
// 这样测试复现的就是真实加载顺序（原来的 bug 正是加载顺序导致的）。
import { withRedactedLogging } from '../tools/upload';

describe('resolveVersion', () => {
  it('从 tag v1.2.3 取出 1.2.3', () => {
    expect(resolveVersion({ GITHUB_REF_NAME: 'v1.2.3' })).toBe('1.2.3');
  });

  it('UPLOAD_VERSION 优先于 tag', () => {
    expect(resolveVersion({ GITHUB_REF_NAME: 'v1.2.3', UPLOAD_VERSION: '9.9.9' })).toBe('9.9.9');
  });

  it('tag 不符合 vX.Y.Z 时抛错并说明格式', () => {
    expect(() => resolveVersion({ GITHUB_REF_NAME: 'release-1' })).toThrow('vX.Y.Z');
  });

  it('两者都没有时抛错', () => {
    expect(() => resolveVersion({})).toThrow('UPLOAD_VERSION');
  });
});

describe('requireEnv', () => {
  it('一次列出所有缺失变量', () => {
    expect(() => requireEnv({ WX_APPID: 'wx1' }, ['WX_APPID', 'WX_PRIVATE_KEY_PATH', 'FOO'])).toThrow(
      'WX_PRIVATE_KEY_PATH, FOO',
    );
  });

  it('齐全时不抛错', () => {
    expect(() => requireEnv({ A: '1', B: '2' }, ['A', 'B'])).not.toThrow();
  });
});

describe('redactSensitive', () => {
  it('隐去 miniprogram-ci 自己打出的 errCode / errMsg', () => {
    const out = redactSensitive('Error: errCode: -1; errMsg: empty content');
    expect(out).not.toContain('-1');
    expect(out).not.toContain('empty content');
    expect(out).toContain('[已隐去]');
  });

  it('隐去 JSON 形态的 errcode / errmsg', () => {
    const out = redactSensitive('{"errcode":80051,"errmsg":"invalid ip 1.2.3.4"}');
    expect(out).not.toContain('80051');
    expect(out).not.toContain('invalid ip');
  });

  it('隐去 PEM 私钥正文', () => {
    // 头尾拼出来而不是写字面量：仓库里留一段 PEM 头会被密钥扫描器误判。
    const dashes = '-'.repeat(5);
    const fakeBody = 'FAKE-KEY-BODY-NOT-A-REAL-KEY';
    const pem = `${dashes}BEGIN RSA PRIVATE KEY${dashes}\n${fakeBody}\n${dashes}END RSA PRIVATE KEY${dashes}`;
    const out = redactSensitive(`key is ${pem}`);
    expect(out).not.toContain(fakeBody);
    expect(out).toContain('[已隐去私钥]');
  });

  it('普通文本原样放过，不要把进度日志也吃掉', () => {
    expect(redactSensitive('正在上传 3/10 个文件')).toBe('正在上传 3/10 个文件');
  });

  it('JSON 里的转义引号不该截断匹配，值尾部不能漏出来', () => {
    const out = redactSensitive('{"errmsg":"bad \\"quote\\" invalid ip 1.2.3.4"}');
    expect(out).not.toContain('invalid ip');
    expect(out).not.toContain('1.2.3.4');
  });

  it('隐去 snake_case 的 error_code / error_msg', () => {
    const out = redactSensitive('{"error_code":40013,"error_msg":"invalid appid"}');
    expect(out).not.toContain('40013');
    expect(out).not.toContain('invalid appid');
  });

  it('隐去 base_resp.err_msg 这种嵌套 snake_case', () => {
    const out = redactSensitive('base_resp.err_msg: ip 203.0.113.9 not in whitelist');
    expect(out).not.toContain('203.0.113.9');
    expect(out).not.toContain('not in whitelist');
  });

  it('隐去 request url 的查询串，appid 不能进日志', () => {
    const out = redactSensitive(
      'request url: https://servicewechat.com/wxa-dev-logic/upload?appid=wxabcdef0123456789&robot=1',
    );
    expect(out).not.toContain('wxabcdef0123456789');
  });

  it('url 主体保留，只隐去查询串，日志还能看出打了哪个接口', () => {
    const out = redactSensitive('request url: https://servicewechat.com/wxa-dev-logic/upload?appid=wx1');
    expect(out).toContain('servicewechat.com/wxa-dev-logic/upload');
  });

  it('URL 查询串隐去后，包住它的 ] 不被吃掉（括号仍闭合）', () => {
    const out = redactSensitive('CGI[https://servicewechat.com/x/upload?appid=wx1&robot=1] failed');
    expect(out).not.toContain('wx1');
    // 结尾的 ] 必须保留，否则 CGI[...] 括号不闭合，纯外观 bug。
    expect(out).toContain('?[已隐去]]');
    expect(out).toContain('] failed');
  });

  it('隐去脱离 url 单独出现的 signature=', () => {
    const out = redactSensitive('signature=deadbeefcafe0123 robot=1');
    expect(out).not.toContain('deadbeefcafe0123');
    expect(out).toContain('signature=[已隐去]');
    // 无关参数不受影响。
    expect(out).toContain('robot=1');
  });

  it('隐去 JSON 形态的 "appid":"..." 与 "signature":"..."', () => {
    const out = redactSensitive('{"appid":"wxabcdef0123456789","signature":"sig-secret-xyz"}');
    expect(out).not.toContain('wxabcdef0123456789');
    expect(out).not.toContain('sig-secret-xyz');
    expect(out).toContain('[已隐去]');
  });

  // 下划线是词字符，早先的 \bsecret= 在 client_secret / app_secret 里卡在 _ 与 s 之间的
  // 非边界处，整段值照样漏进日志。放宽成 (?:前缀_)?secret 后这些形态才被兜住。
  it('隐去 key=value 形态的 client_secret / app_secret（下划线前缀不再漏网）', () => {
    const out = redactSensitive('client_secret=abc123def456 app_secret=zzz999 robot=1');
    expect(out).not.toContain('abc123def456');
    expect(out).not.toContain('zzz999');
    expect(out).toContain('client_secret=[已隐去]');
    expect(out).toContain('app_secret=[已隐去]');
    // 无关参数不受影响。
    expect(out).toContain('robot=1');
  });

  it('隐去 JSON 形态的 "client_secret":"..." / "app_secret":"..."', () => {
    const out = redactSensitive('{"client_secret":"cs-abc-123","app_secret":"as-xyz-789"}');
    expect(out).not.toContain('cs-abc-123');
    expect(out).not.toContain('as-xyz-789');
    expect(out).toContain('[已隐去]');
  });

  // 反向证明：修复前的 \bsecret 正则对 client_secret= 平凡放行（\b 卡在下划线处），
  // 若守卫失效这一条必然失败——不是对空值 not.toContain 的恒真断言。
  it('反向证明：老式 \\bsecret 正则确实漏掉 client_secret（对照修复后的收窄）', () => {
    const payload = 'client_secret=leaked-value-123';
    // 复刻修复前的裸 \bsecret= 规则：\b 在 t 与 _ 之间成立、但要求其后紧跟 secret=，
    // client_secret 里 secret 前是下划线（词字符），无词边界，故整段不被替换。
    const OLD = /\b(appid|access_token|secret|signature)=([^&\s]*)/gi;
    expect(payload.replace(OLD, (_m, k: string) => `${k}=[已隐去]`)).toContain('leaked-value-123');
    // 修复后的实现必须把它隐去。
    expect(redactSensitive(payload)).not.toContain('leaked-value-123');
  });
});

describe('hasErrField（error/warn 通道的 fail-closed 判定）', () => {
  it('识别带标签的接口错误（触发整条压制）', () => {
    expect(hasErrField('errCode: -1; errMsg: bad')).toBe(true);
    expect(hasErrField('{"errcode":80051,"errmsg":"x"}')).toBe(true);
    expect(hasErrField('base_resp.err_msg: ip not allowed')).toBe(true);
    expect(hasErrField('{"error_code":40013,"error_msg":"y"}')).toBe(true);
  });

  it('不误伤编译/worker/校验类诊断（保留可见）', () => {
    expect(hasErrField('postcss error @ pages/index/index.wxss')).toBe(false);
    expect(hasErrField('minifywxml error @ pages/list/list.wxml')).toBe(false);
    expect(hasErrField('worker thread: 3 exit with code: 7 when it is busy, retry 1 times')).toBe(false);
    expect(hasErrField('params robot is invalid')).toBe(false);
    // 正文里出现 error 一词但不构成「字段:」形态，不该误判。
    expect(hasErrField('Unexpected error at line 3')).toBe(false);
  });

  it('无 g 标志，可安全反复 test 不受 lastIndex 影响', () => {
    const s = 'errCode: -1';
    expect(hasErrField(s)).toBe(true);
    expect(hasErrField(s)).toBe(true);
  });
});

// 这组测试必须用真包。之前只把 redactSensitive 当纯函数测，
// 结果守卫实际拦到 0 行也能全绿——miniprogram-ci 的 dist/utils/log.js
// 在加载时就按引用抓走了 console.*，替换 console 对它无效。
describe('守卫对真包的实际拦截效果', () => {
  const req = require as unknown as (id: string) => any;

  /**
   * 不劫持 process.stderr：jest 把 console 换成了自己的 CustomConsole，
   * 写进 jest 缓冲区而不是真 stderr，劫持 stderr 抓到的是空串——
   * 而空串会让 not.toContain 平凡通过，正是这种假绿放过了失效的守卫。
   * 改为在库日志出口的下游装记录器：守卫包在记录器外面，
   * 记录到的就是「即将交给真 console 的文本」。
   */
  async function captureAtSink(
    guarded: boolean,
    emit: () => void,
  ): Promise<string> {
    const log = req('miniprogram-ci/dist/utils/log').default;
    const saved = ['log', 'info', 'warn', 'error'].map((n) => [n, log[n]] as const);
    const seen: string[] = [];
    for (const [n] of saved) {
      log[n] = (...args: unknown[]): void => {
        seen.push(args.map((a) => String(a)).join(' '));
      };
    }
    try {
      if (guarded) {
        await withRedactedLogging(async () => emit());
      } else {
        emit();
      }
    } finally {
      for (const [n, orig] of saved) log[n] = orig;
    }
    return seen.join('\n');
  }

  // CodeError 的构造函数里就有 log_1.default.error(code, message)，
  // 光是 new 一下就会把 errCode/errMsg 打出去。真实上传路径里 message 来自
  // `new Error(rawBody).toString()`——rawBody 是带 errcode/errmsg 标签的响应体
  // （见 dist/ci/upload.js: 校验失败 throw new Error(l) 后包成 CodeError(e.toString())），
  // 所以这里如实还原成「带标签」的形态。
  const RAW_RESP_BODY = '{"errcode":80051,"errmsg":"invalid ip 203.0.113.9 not in whitelist"}';
  const emitCodeError = (): void => {
    const { CodeError } = req('miniprogram-ci/dist/utils/error');
    new CodeError(`Error: ${RAW_RESP_BODY}`, 20003);
  };

  it('对照组：不装守卫时，真包确实会把 errMsg 打出来', async () => {
    const out = await captureAtSink(false, emitCodeError);
    // 这条断言保证测试真的踩在泄漏路径上，守卫失效时下一条必然失败。
    expect(out).toContain('invalid ip 203.0.113.9');
  });

  // error/warn 通道默认「脱敏后放行」保住可诊断性，唯一例外是嗅到 errcode/errmsg
  // 字段特征时整条 fail-closed 压掉。CodeError 的 message 带标签（真实路径来自
  // 响应体原文），命中特征 → 连同数字 code 一起整条压掉。
  it('装上守卫后，带 errcode/errmsg 特征的 CodeError 整条被压掉', async () => {
    const out = await captureAtSink(true, emitCodeError);
    expect(out).not.toContain('invalid ip 203.0.113.9');
    expect(out).not.toContain('not in whitelist');
    expect(out).not.toContain('80051');
    expect(out).not.toContain('20003');
    expect(out).toContain('[已隐去微信接口错误详情]');
  });

  it('warn 通道：errcode/errmsg 特征分散在多个位置参数也整条压掉', async () => {
    const out = await captureAtSink(true, () => {
      const log = req('miniprogram-ci/dist/utils/log').default;
      // 标签在 arg0，正文在 arg1——逐参数脱敏会漏掉 arg1，所以必须整条压。
      log.warn('errCode: -1', 'invalid ip 203.0.113.9');
    });
    expect(out).not.toContain('203.0.113.9');
    expect(out).toContain('[已隐去微信接口错误详情]');
  });

  // 以下几组是本轮修复的核心：编译/worker/校验类诊断必须在 error 通道可见，
  // 不能再被整条压制——否则 ci.upload() 先编译，编译失败只剩一行 notice，排查无从下手。
  it('postcss 编译失败在 error 通道可见（带文件路径，未被压制）', async () => {
    const out = await captureAtSink(true, () => {
      const log = req('miniprogram-ci/dist/utils/log').default;
      // 复刻 dist/core/worker_thread/task/compilewxss.js 的真实调用形态。
      log.error('postcss error @ ' + 'pages/index/index.wxss');
      log.error(new Error('Unexpected } at line 3:5'));
    });
    expect(out).toContain('postcss error @ pages/index/index.wxss');
    expect(out).toContain('Unexpected } at line 3:5');
    expect(out).not.toContain('[已隐去微信接口错误详情]');
  });

  it('WXML 压缩失败在 error 通道可见（带文件路径，未被压制）', async () => {
    const out = await captureAtSink(true, () => {
      const log = req('miniprogram-ci/dist/utils/log').default;
      // 复刻 dist/core/worker_thread/task/minifywxml.js 的真实调用形态。
      log.error('minifywxml error @ ' + 'pages/list/list.wxml');
      log.error('unexpected end tag </view>');
    });
    expect(out).toContain('minifywxml error @ pages/list/list.wxml');
    expect(out).toContain('unexpected end tag');
    expect(out).not.toContain('[已隐去微信接口错误详情]');
  });

  it('worker 崩溃重试行在 error 通道可见（"exit with code" 不算 errcode 特征）', async () => {
    const out = await captureAtSink(true, () => {
      const log = req('miniprogram-ci/dist/utils/log').default;
      // 复刻 dist/core/worker_thread/worker_manager.js 的真实调用形态。
      log.error('worker thread: 3 exit with code: 7 when it is busy, retry 1 times');
    });
    expect(out).toContain('exit with code: 7');
    expect(out).toContain('retry 1 times');
    expect(out).not.toContain('[已隐去微信接口错误详情]');
  });

  it('普通校验/诊断文案在 error 通道可见（不含 errcode/errmsg 特征）', async () => {
    const out = await captureAtSink(true, () => {
      const log = req('miniprogram-ci/dist/utils/log').default;
      log.error('params robot is invalid');
    });
    expect(out).toContain('params robot is invalid');
    expect(out).not.toContain('[已隐去微信接口错误详情]');
  });

  it('直接以 errCode:/errMsg: 标签打出的接口错误仍被压掉（projectattr 形态）', async () => {
    const out = await captureAtSink(true, () => {
      const log = req('miniprogram-ci/dist/utils/log').default;
      // 复刻 dist/ci/projectattr.js 的真实调用形态。
      log.error('get wxSOMEID project attr fail errCode: 40013, errMsg: invalid appid 1.2.3.4');
    });
    expect(out).not.toContain('40013');
    expect(out).not.toContain('invalid appid');
    expect(out).not.toContain('1.2.3.4');
    expect(out).toContain('[已隐去微信接口错误详情]');
  });

  it('info 通道保留进度信息，只脱敏敏感片段', async () => {
    const out = await captureAtSink(true, () => {
      const log = req('miniprogram-ci/dist/utils/log').default;
      log.info('正在上传 3/10 个文件');
    });
    // 进度日志是排查上传卡在哪一步的唯一线索，不能一起压掉。
    expect(out).toContain('正在上传 3/10 个文件');
  });

  it('info 通道转储响应体时，带标签的 errcode/errmsg 仍被脱敏', async () => {
    const out = await captureAtSink(true, () => {
      const log = req('miniprogram-ci/dist/utils/log').default;
      log.info(`CGI[upload] response parse error, response body: {"errcode":80051,"errmsg":"invalid ip"}`);
    });
    expect(out).not.toContain('80051');
    expect(out).not.toContain('invalid ip');
  });

  it('库经 log.default 打出的 request url 也被拦住', async () => {
    const out = await captureAtSink(true, () => {
      const log = req('miniprogram-ci/dist/utils/log').default;
      log.info('request url:', 'https://servicewechat.com/x?appid=wxabcdef0123456789&robot=1');
    });
    expect(out).not.toContain('wxabcdef0123456789');
    expect(out).toContain('[已隐去]');
  });

  it('守卫退出后必须还原，不能永久占着库的 log', async () => {
    const log = req('miniprogram-ci/dist/utils/log').default;
    const before = log.error;
    await withRedactedLogging(async () => {
      expect(log.error).not.toBe(before);
    });
    expect(log.error).toBe(before);
  });
});

describe('resolveDesc', () => {
  it('默认带版本号与短 sha', () => {
    expect(resolveDesc({ GITHUB_SHA: 'abcdef1234567890' }, '1.2.3')).toBe('体验版 1.2.3 · abcdef1');
  });

  it('UPLOAD_DESC 覆盖默认文案', () => {
    expect(resolveDesc({ UPLOAD_DESC: '手动补包' }, '1.2.3')).toBe('手动补包');
  });
});
