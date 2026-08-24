import { resolveBaseUrl, LOCAL_API_BASE_URL, PROD_API_BASE_URL } from '../config';

/**
 * API_BASE_URL 的环境切换。
 *
 * 本地联调要打本机 server，体验版/正式版必须打已备案域名。之前是一个硬编码常量，
 * 换环境得改源码、还容易把 localhost 误提交上线，所以按 envVersion 选。
 */
describe('resolveBaseUrl', () => {
  it('开发者工具（develop）走本机 server', () => {
    expect(resolveBaseUrl('develop')).toBe(LOCAL_API_BASE_URL);
  });

  it('体验版与正式版一律走线上域名', () => {
    expect(resolveBaseUrl('trial')).toBe(PROD_API_BASE_URL);
    expect(resolveBaseUrl('release')).toBe(PROD_API_BASE_URL);
  });

  it('拿不到 envVersion 时按线上处理，避免把 localhost 发上线', () => {
    expect(resolveBaseUrl(undefined)).toBe(PROD_API_BASE_URL);
  });

  it('线上域名必须是 https 且不含内网地址', () => {
    expect(PROD_API_BASE_URL.startsWith('https://')).toBe(true);
    expect(PROD_API_BASE_URL).not.toMatch(/localhost|127\.0\.0\.1|192\.168\./);
  });

  it('本机地址不带结尾斜杠，否则拼出来会是双斜杠', () => {
    for (const url of [LOCAL_API_BASE_URL, PROD_API_BASE_URL]) {
      expect(url.endsWith('/')).toBe(false);
    }
  });
});
