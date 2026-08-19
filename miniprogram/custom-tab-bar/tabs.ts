export interface TabItem {
  pagePath: string;
  text: string;
  icon: string;
}

/** 顺序、pagePath、text 必须与 app.json 的 tabBar.list 一致，测试会逐项比对。 */
export const TABS: TabItem[] = [
  { pagePath: 'pages/plaza/index', text: '广场', icon: 'paw' },
  { pagePath: 'pages/venue-list/index', text: '周边', icon: 'place' },
  { pagePath: 'pages/profile/index', text: '我的', icon: 'person' },
];

/** getCurrentPages 给的 route 不带前导斜杠，switchTab 的 url 要带，这里统一成不带。 */
export function activeIndexFor(route: string): number {
  const normalized = route.replace(/^\//, '');
  if (!normalized) return -1;
  return TABS.findIndex((t) => t.pagePath === normalized);
}
