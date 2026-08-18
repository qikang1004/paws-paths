import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

interface AppJson {
  pages: string[];
  subPackages: { root: string; pages: string[] }[];
  preloadRule: Record<string, { network: string; packages: string[] }>;
  tabBar: { custom: boolean; list: { pagePath: string; text: string }[] };
  requiredPrivateInfos: string[];
  permission: Record<string, { desc: string }>;
  renderer: string;
}

const ROOT = resolve(__dirname, '..');
const app = JSON.parse(readFileSync(join(ROOT, 'app.json'), 'utf8')) as AppJson;
const subPagePaths = app.subPackages.flatMap((pkg) =>
  pkg.pages.map((page) => `${pkg.root}/${page}`),
);
const allPages = [...app.pages, ...subPagePaths];

describe('app.json', () => {
  it('tabBar 的页面全部在主包内', () => {
    for (const item of app.tabBar.list) {
      expect(app.pages).toContain(item.pagePath);
      for (const pkg of app.subPackages) {
        expect(item.pagePath.startsWith(`${pkg.root}/`)).toBe(false);
      }
    }
  });

  it('每个声明的页面都有 4 个配套文件', () => {
    for (const page of allPages) {
      for (const ext of ['.ts', '.wxml', '.wxss', '.json']) {
        expect(existsSync(join(ROOT, page + ext))).toBe(true);
      }
    }
  });

  it('页面路径不重复', () => {
    expect(new Set(allPages).size).toBe(allPages.length);
  });

  it('preloadRule 的触发页与目标分包都已声明', () => {
    const roots = app.subPackages.map((pkg) => pkg.root);
    for (const [trigger, rule] of Object.entries(app.preloadRule)) {
      expect(allPages).toContain(trigger);
      for (const pkg of rule.packages) {
        expect(roots).toContain(pkg);
      }
    }
  });

  it('周边与个人中心分包被预下载', () => {
    const preloaded = Object.values(app.preloadRule).flatMap((rule) => rule.packages);
    expect(preloaded).toContain('packages/venue');
    expect(preloaded).toContain('packages/profile');
  });

  it('定位能力已报备并写了用途说明', () => {
    expect(app.requiredPrivateInfos).toContain('getLocation');
    expect(app.permission['scope.userLocation'].desc.length).toBeGreaterThan(8);
  });

  it('使用 skyline 渲染器且开启自定义 tabBar', () => {
    expect(app.renderer).toBe('skyline');
    expect(app.tabBar.custom).toBe(true);
  });
});
