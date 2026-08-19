import { redactSensitive, requireEnv, resolveDesc, resolveVersion } from '../tools/upload-args';

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
});

describe('resolveDesc', () => {
  it('默认带版本号与短 sha', () => {
    expect(resolveDesc({ GITHUB_SHA: 'abcdef1234567890' }, '1.2.3')).toBe('体验版 1.2.3 · abcdef1');
  });

  it('UPLOAD_DESC 覆盖默认文案', () => {
    expect(resolveDesc({ UPLOAD_DESC: '手动补包' }, '1.2.3')).toBe('手动补包');
  });
});
