import { readdirSync } from 'node:fs';
import { join } from 'node:path';

/** 去掉行注释与块注释：注释里提到 wx.request 不算违规（client.ts 就有这么一句）。 */
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/**
 * 直呼全局 wx.request / wx.getLocation 视为违规：这两个出口只能经 api/wx-promise.ts 收口。
 * 只认「全局 wx」——前面不能紧跟 . 或标识符字符，于是 this.wx.request、adapter.wx.getLocation
 * 这类经封装的调用不会被误判为违规。返回命中的调用文本，供上层报出违规位置。
 */
export function findDirectWxCalls(source: string): string[] {
  return stripComments(source).match(/(?<![\w.$])wx\s*\.\s*(?:request|getLocation)\b/g) ?? [];
}

/**
 * 递归列出 rootDir 下所有 .ts 文件，返回相对 rootDir 的 POSIX 风格路径（已排序）。
 * 真的走文件系统 readdir，不硬编码文件清单——新增页面能自动纳入扫描范围。
 * excludeRel 里的相对目录（如 test、tools、shared/types）与 node_modules 一律跳过。
 */
export function listTsFiles(rootDir: string, excludeRel: string[]): string[] {
  const excluded = new Set(excludeRel.map((p) => p.replace(/\\/g, '/')));
  const out: string[] = [];
  const walk = (absDir: string, rel: string): void => {
    for (const entry of readdirSync(absDir, { withFileTypes: true })) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue;
        if (excluded.has(childRel)) continue;
        walk(join(absDir, entry.name), childRel);
      } else if (entry.name.endsWith('.ts')) {
        out.push(childRel);
      }
    }
  };
  walk(rootDir, '');
  return out.sort();
}
