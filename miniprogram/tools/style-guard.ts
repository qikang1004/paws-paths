import { readdirSync } from 'node:fs';
import { join } from 'node:path';

/** 去掉 CSS 注释，避免注释里的示例值触发误报。 */
export function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * 递归列出 rootDir 下所有 .wxss 文件，返回相对 rootDir 的 POSIX 风格路径（已排序）。
 * 真的走文件系统 readdir，不硬编码文件清单——新增页面 / 组件的 wxss 能自动纳入网内，
 * 不会像手挑清单那样把 components/wf-icon/index.wxss 之类漏在网外。跳过 node_modules。
 */
export function listWxssFiles(rootDir: string): string[] {
  const out: string[] = [];
  const walk = (absDir: string, rel: string): void => {
    for (const entry of readdirSync(absDir, { withFileTypes: true })) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue;
        walk(join(absDir, entry.name), childRel);
      } else if (entry.name.endsWith('.wxss')) {
        out.push(childRel);
      }
    }
  };
  walk(rootDir, '');
  return out.sort();
}

/** 十六进制色值一律视为违规：色值只能来自 tokens.wxss。 */
export function findHexLiterals(css: string): string[] {
  return stripComments(css).match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
}

/** 裸 px 一律视为违规：长度只能用 rpx 或 var()。 */
export function findBarePx(css: string): string[] {
  return stripComments(css).match(/(?<![\w-])-?[\d.]+px\b/g) ?? [];
}

/** 引用了 tokens.wxss 未定义的变量，说明 token 名漂移了。 */
export function findUndefinedVars(consumerCss: string, tokensCss: string): string[] {
  const defined = new Set(
    Array.from(stripComments(tokensCss).matchAll(/(--[\w-]+)\s*:/g), (m) => m[1]),
  );
  const used = Array.from(
    stripComments(consumerCss).matchAll(/var\(\s*(--[\w-]+)/g),
    (m) => m[1],
  );
  return [...new Set(used.filter((name) => !defined.has(name)))];
}

export interface TokenScope {
  selector: string;
  tokens: string[];
}

/**
 * 把「选择器组 → 自定义属性」拆成独立作用域。只处理 tokens.wxss 的扁平声明块
 * （生成物，无嵌套），不引入完整 CSS 引擎。注释先剔除，tokens.wxss 顶部有说明注释。
 */
export function parseTokenScopes(tokensCss: string): TokenScope[] {
  const out: TokenScope[] = [];
  for (const [, selectors, body] of stripComments(tokensCss).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const tokens = [...new Set(Array.from(body.matchAll(/(--[\w-]+)\s*:/g), (m) => m[1]))];
    if (tokens.length === 0) continue;
    for (const selector of selectors
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)) {
      out.push({ selector, tokens });
    }
  }
  return out;
}

/** page 作为元素选择器才算 page 作用域；.page-gutter 这类类名不算。 */
function isPageScoped(selector: string): boolean {
  return /(?<![\w.#_-])page(?![\w.-])/.test(selector);
}

/**
 * 选择器感知的 token 可达性检查：consumerCss 引用的每个变量，若在所有定义它的作用域里
 * 都只挂在 page 下，page 子树外的组件（custom-tab-bar / 自定义导航栏）就拿不到值。
 * 自定义属性靠继承送达，page 外节点不在 page 子树上，唯一出路是 .token-scope 这类
 * 非 page 作用域的全局规则。findUndefinedVars 只查名字存在性，看不见这一层。
 */
export function findTokensInaccessibleOutsidePage(tokensCss: string, consumerCss: string): string[] {
  const coveredOutsidePage = new Set<string>();
  for (const scope of parseTokenScopes(tokensCss)) {
    if (isPageScoped(scope.selector)) continue;
    for (const token of scope.tokens) coveredOutsidePage.add(token);
  }
  const used = Array.from(
    stripComments(consumerCss).matchAll(/var\(\s*(--[\w-]+)/g),
    (m) => m[1],
  );
  return [...new Set(used.filter((name) => !coveredOutsidePage.has(name)))];
}

/** 渲染在 page 子树之外的框架组件槽位：自定义 tabBar 与自定义导航栏。 */
export const OUTSIDE_PAGE_SLOTS = ['custom-tab-bar', 'custom-navigation-bar'];

/**
 * 递归列出 rootDir 下所有 .wxml 文件（相对路径、POSIX 风格、已排序）。
 *
 * 与 `listWxssFiles` 同一套走法。分开两个函数而不加参数：调用方一眼看得出
 * 自己拿的是哪种文件，而扩展名过滤是这两个函数唯一的差别。
 */
export function listWxmlFiles(rootDir: string): string[] {
  const out: string[] = [];
  const walk = (absDir: string, rel: string): void => {
    for (const entry of readdirSync(absDir, { withFileTypes: true })) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue;
        walk(join(absDir, entry.name), childRel);
      } else if (entry.name.endsWith('.wxml')) {
        out.push(childRel);
      }
    }
  };
  walk(rootDir, '');
  return out.sort();
}

/** 一个横向滚动容器：它在哪个文件、用的 class 是什么。 */
export interface HorizontalScroller {
  file: string;
  className: string;
}

/**
 * 找出 wxml 里所有**横向**滚动的 `scroll-view`，以及它们的 class。
 *
 * 为什么要找它们：Skyline 下 `scroll-view` 是真正的滚动容器，横向滚动时它**不会
 * 被子元素顶开** —— 不给高度就算成 0，容器后面的内容会按正常流排上来盖住它
 * （真机上表现为「筛选按钮被列表遮挡」，见 `components/filter-chips/index.wxss`）。
 *
 * 只认 `scroll-x`（`scroll-x` 或 `scroll-x="{{true}}"`），不认 `scroll-y`：
 * 纵向那批的高度由 `.page-scroll` 的 flex 分配，不需要显式给。
 */
export function findHorizontalScrollers(wxml: string, file: string): HorizontalScroller[] {
  const out: HorizontalScroller[] = [];
  // 逐个 <scroll-view ...> 开标签地看，属性顺序不限。
  for (const match of stripWxmlComments(wxml).matchAll(/<scroll-view\b([^>]*)>/g)) {
    const attrs = match[1];
    // `scroll-x="{{false}}"` 不算横向 —— 那是显式关掉的。
    if (!/\bscroll-x\b(?!\s*=\s*"\{\{false\}\}")/.test(attrs)) continue;
    const className = /class="([^"]*)"/.exec(attrs)?.[1] ?? '';
    out.push({ file, className });
  }
  return out;
}

/** 去掉 wxml 注释。注释里常写着示例标签，扫标签时会误报。 */
export function stripWxmlComments(wxml: string): string {
  return wxml.replace(/<!--[\s\S]*?-->/g, '');
}

/**
 * 某个 class 在这份 wxss 里有没有拿到高度。
 *
 * 认三种写法：`height`、`min-height`、以及 `aspect-ratio`（配合 width 也能定高）。
 * 简单的文本匹配就够 —— 这份守卫要拦的是「整条规则忘了写」，不是算出最终高度。
 */
export function hasHeightRule(wxss: string, className: string): boolean {
  const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // 匹配 `.cls { ... }` 这一整块（不含嵌套，wxss 里没有嵌套语法）。
  const block = new RegExp(`\\.${escaped}\\s*\\{([^}]*)\\}`, 'g');
  for (const match of stripComments(wxss).matchAll(block)) {
    if (/\b(height|min-height|aspect-ratio)\s*:/.test(match[1])) return true;
  }
  return false;
}
