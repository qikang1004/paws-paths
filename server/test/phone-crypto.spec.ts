import { randomBytes } from 'node:crypto';
import {
  PHONE_KEY_MIN_LENGTH,
  maskPhone,
  normalizePhone,
  phoneLookupHash,
  readPhoneKeys,
} from '../src/users/phone-crypto';

/** 测试用的一次性随机密钥：每次运行现生成，不是任何环境里的真值。 */
const testKey = (): string => randomBytes(32).toString('hex');

describe('normalizePhone', () => {
  it('收大陆 11 位手机号，去掉空格、短横线与 +86 前缀', () => {
    expect(normalizePhone('13800138000')).toBe('13800138000');
    expect(normalizePhone(' 138-0013-8000 ')).toBe('13800138000');
    expect(normalizePhone('+86 138 0013 8000')).toBe('13800138000');
    expect(normalizePhone('+8613800138000')).toBe('13800138000');
  });

  it('不是手机号的一律 null（调用方报 422，不落库）', () => {
    for (const bad of ['', '1380013800', '138001380001', '23800138000', '12800138000', 'abc', '+1 4155550100']) {
      expect(normalizePhone(bad)).toBeNull();
    }
    expect(normalizePhone(13800138000 as unknown)).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });
});

describe('maskPhone', () => {
  it('前三后四，中间四位打码（spec §4.5：接口一律返回脱敏形式）', () => {
    expect(maskPhone('13800138000')).toBe('138****8000');
  });
});

describe('phoneLookupHash', () => {
  it('同号同钥匙结果稳定，是 64 位小写十六进制（HMAC-SHA256）', () => {
    const key = testKey();
    const a = phoneLookupHash('13800138000', key);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(phoneLookupHash('13800138000', key)).toBe(a);
  });

  it('换号或换钥匙结果都变；结果里不含明文', () => {
    const key = testKey();
    const a = phoneLookupHash('13800138000', key);
    expect(phoneLookupHash('13800138001', key)).not.toBe(a);
    expect(phoneLookupHash('13800138000', testKey())).not.toBe(a);
    expect(a).not.toContain('13800138000');
  });
});

describe('readPhoneKeys', () => {
  it('两把钥匙都在且够长就返回', () => {
    const enc = testKey();
    const hash = testKey();
    expect(readPhoneKeys({ PHONE_ENC_KEY: enc, PHONE_HASH_KEY: hash })).toEqual({
      encKey: enc,
      hashKey: hash,
    });
  });

  it('缺任意一把都报错，报错里点名缺的变量', () => {
    expect(() => readPhoneKeys({ PHONE_HASH_KEY: testKey() })).toThrow(/PHONE_ENC_KEY/);
    expect(() => readPhoneKeys({ PHONE_ENC_KEY: testKey() })).toThrow(/PHONE_HASH_KEY/);
    expect(() => readPhoneKeys({ PHONE_ENC_KEY: '', PHONE_HASH_KEY: testKey() })).toThrow(
      /PHONE_ENC_KEY/,
    );
  });

  it(`短于 ${PHONE_KEY_MIN_LENGTH} 个字符拒绝，且报错里不回显钥匙的值`, () => {
    const short = 'x'.repeat(PHONE_KEY_MIN_LENGTH - 1);
    let message = '';
    try {
      readPhoneKeys({ PHONE_ENC_KEY: short, PHONE_HASH_KEY: testKey() });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/PHONE_ENC_KEY/);
    expect(message).not.toContain(short);
  });

  it('两把钥匙不许相同：加密钥匙与查找钥匙用途不同，一把泄露不该连带另一把', () => {
    const same = testKey();
    expect(() => readPhoneKeys({ PHONE_ENC_KEY: same, PHONE_HASH_KEY: same })).toThrow(
      /PHONE_ENC_KEY.*PHONE_HASH_KEY|PHONE_HASH_KEY.*PHONE_ENC_KEY/,
    );
  });
});
