import { statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { stripComments } from './wx-guard';

/**
 * 提取源码里的相对导入说明符（import/export ... from './x' 与 require('./x')）。
 * 只认 ./ 或 ../ 开头的说明符；裸包名（'dayjs'）不归运行时相对解析管。
 * 先剔注释：client.ts 的文档注释里就写着 import 示例，不能让它误报。
 */
export function relativeImportSpecifiers(source: string): string[] {
  return [
    ...stripComments(source).matchAll(/(?:from\s+|require\(\s*)['"](\.\.?\/[^'"]+)['"]/g),
  ].map((m) => m[1]);
}

/**
 * 小程序运行时的 require 只把说明符当字面文件路径（补上 .js 查模块表），
 * 不做 Node 式目录/index 解析：require('../shared/types') 只找 shared/types.js，
 * 不会落到 shared/types/index.js——devtools 实测报
 * "module 'shared/types.js' is not defined, require args is '../shared/types'"，
 * app.js 启动即崩，首屏 routeTo 等不到 routeDone 十秒超时。
 * jest 与 tsc 都按 Node 语义解析目录 index，测试全绿也拦不住这个错。
 *
 * 返回「解析后落在真实目录」的违规说明符：指向具体文件的导入（'./tabs' → tabs.ts）
 * 合规，运行时补 .js 即命中；只有指向目录的必须改写成 …/index。
 */
export function directoryImports(source: string, fromFile: string): string[] {
  return relativeImportSpecifiers(source).filter((spec) => {
    const target = resolve(dirname(fromFile), spec);
    return statSync(target, { throwIfNoEntry: false })?.isDirectory() === true;
  });
}
