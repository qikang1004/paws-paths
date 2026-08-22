import { encodeGeohash } from '../src/common/geohash';

describe('encodeGeohash', () => {
  it('维基百科标准示例：encodeGeohash(57.64911, 10.40744, 11) === u4pruydqqvj', () => {
    expect(encodeGeohash(57.64911, 10.40744, 11)).toBe('u4pruydqqvj');
  });

  it('原点：encodeGeohash(0, 0, 6) === s00000', () => {
    expect(encodeGeohash(0, 0, 6)).toBe('s00000');
  });

  it('前缀性质：低精度是同一位置高精度的前缀', () => {
    const p4 = encodeGeohash(39.9042, 116.4074, 4);
    const p6 = encodeGeohash(39.9042, 116.4074, 6);
    expect(p4).toBe(p6.slice(0, 4));
  });

  it('长度：precision 决定长度', () => {
    expect(encodeGeohash(31.2304, 121.4737, 6).length).toBe(6);
    expect(encodeGeohash(31.2304, 121.4737, 4).length).toBe(4);
  });

  it('演示中心：encodeGeohash(39.9042, 116.4074, 6) === wx4g0b（POI 缓存 key 依赖此值）', () => {
    expect(encodeGeohash(39.9042, 116.4074, 6)).toBe('wx4g0b');
  });
});
