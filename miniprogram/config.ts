/**
 * 接口基址。按小程序运行环境切换，不要手改这里的值去联调。
 *
 * 线上域名必须是已 ICP 备案、并登记进小程序后台 request 白名单的合法域名（spec §3.2）。
 * 开发者工具里勾「不校验合法域名」才能打 127.0.0.1；真机预览打不通本机，
 * 需要内网穿透或把服务部署到测试域名。
 */

/** 本机 server（server/ 里 npm start 默认监听 3000）。 */
export const LOCAL_API_BASE_URL = 'http://127.0.0.1:3000';

/** 线上域名。上线前替换成真实备案域名，别留 example.com。 */
export const PROD_API_BASE_URL = 'https://api.paws-paths.example.com';

export type EnvVersion = 'develop' | 'trial' | 'release';

/**
 * 只有开发者工具（develop）打本机，体验版和正式版一律走线上。
 * 拿不到 envVersion 时按线上处理：宁可本地联调多报一次错，
 * 也不能把 localhost 混进体验版包里。
 */
export function resolveBaseUrl(env: EnvVersion | undefined): string {
  return env === 'develop' ? LOCAL_API_BASE_URL : PROD_API_BASE_URL;
}

function currentEnv(): EnvVersion | undefined {
  // 单元测试跑在 node 里没有 wx；真机上 getAccountInfoSync 从基础库 2.2.2 起可用。
  if (typeof wx === 'undefined' || typeof wx.getAccountInfoSync !== 'function') {
    return undefined;
  }
  try {
    return wx.getAccountInfoSync().miniProgram.envVersion;
  } catch {
    return undefined;
  }
}

export const API_BASE_URL = resolveBaseUrl(currentEnv());
