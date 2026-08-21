import { redactSensitive, requireEnv, resolveDesc, resolveVersion } from '../tools/upload-args';
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
  // 光是 new 一下就会把 errCode/errMsg 打出去。
  const emitCodeError = (): void => {
    const { CodeError } = req('miniprogram-ci/dist/utils/error');
    new CodeError('invalid ip 203.0.113.9 not in whitelist', -1);
  };

  it('对照组：不装守卫时，真包确实会把 errMsg 打出来', async () => {
    const out = await captureAtSink(false, emitCodeError);
    // 这条断言保证测试真的踩在泄漏路径上，守卫失效时下一条必然失败。
    expect(out).toContain('invalid ip 203.0.113.9');
  });

  // CodeError 走的是 log.error(code, message)：两个无标签位置参数，
  // 裸消息用正则区分不了敏感与无害，所以 error/warn 通道整体压掉（fail-closed）。
  it('装上守卫后，CodeError 的 errCode/errMsg 整条被压掉', async () => {
    const out = await captureAtSink(true, emitCodeError);
    expect(out).not.toContain('invalid ip 203.0.113.9');
    expect(out).not.toContain('not in whitelist');
    expect(out).not.toContain('-1');
    expect(out).toContain('[已隐去微信接口错误详情]');
  });

  it('warn 通道同样压掉，它也可能带接口错误', async () => {
    const out = await captureAtSink(true, () => {
      const log = req('miniprogram-ci/dist/utils/log').default;
      log.warn('errCode: -1', 'invalid ip 203.0.113.9');
    });
    expect(out).not.toContain('203.0.113.9');
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
