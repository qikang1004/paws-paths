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
