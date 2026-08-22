/** base32 字母表：0-9 与 0-9b-z（去掉 a/i/l/o，避免混淆）。 */
const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

/**
 * Geohash 编码。lng 占偶数位、lat 占奇数位，区间取中点，`>=` 归上。
 * 已知可验证值：encodeGeohash(57.64911, 10.40744, 11) === 'u4pruydqqvj'（维基百科示例），
 * encodeGeohash(0, 0, 6) === 's00000'，encodeGeohash(39.9042, 116.4074, 6) === 'wx4g0f'。
 */
export function encodeGeohash(lat: number, lng: number, precision = 6): string {
  let latMin = -90;
  let latMax = 90;
  let lngMin = -180;
  let lngMax = 180;
  let even = true; // 第一位是经度
  let bit = 0;
  let ch = 0;
  let hash = '';

  while (hash.length < precision) {
    if (even) {
      const mid = (lngMin + lngMax) / 2;
      if (lng >= mid) {
        ch |= 1 << (4 - bit);
        lngMin = mid;
      } else {
        lngMax = mid;
      }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) {
        ch |= 1 << (4 - bit);
        latMin = mid;
      } else {
        latMax = mid;
      }
    }
    even = !even;
    if (bit < 4) {
      bit += 1;
    } else {
      hash += BASE32[ch];
      bit = 0;
      ch = 0;
    }
  }
  return hash;
}
