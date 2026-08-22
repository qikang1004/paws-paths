import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { listTsFiles } from '../tools/wx-guard';
import { directoryImports, relativeImportSpecifiers } from '../tools/module-guard';

const ROOT = resolve(__dirname, '..');

/**
 * 扫描时跳过的相对目录（与 wx-guard 同一套约定）：
 * - test：spec 跑在 jest 里，按 Node 语义解析，目录式导入合法；
 * - tools：Node 构建脚本，不进小程序包体（packOptions.ignore 同步排除）；
 * - shared/types：同步产物，里面的 require('./age') 本就是文件形态。
 */
const EXCLUDE_DIRS = ['test', 'tools', 'shared/types'];

describe('relativeImportSpecifiers', () => {
  it('提取相对导入说明符，忽略裸包名', () => {
    expect(
      relativeImportSpecifiers(`
        import { a } from './a';
        import { b } from "../x/b";
        import dayjs from 'dayjs';
        const c = require('../c');
        export * from './d';
      `),
    ).toEqual(['./a', '../x/b', '../c', './d']);
  });

  it('注释里的示例不算导入', () => {
    expect(relativeImportSpecifiers('// import x from "./fake"\nimport y from "./real";')).toEqual([
      './real',
    ]);
  });
});

// 探针文件本身不必存在：directoryImports 只对「导入目标」做 stat，
// 以 test/ 为基准目录即可命中仓库里真实存在的目录与文件。
const PROBE = join(ROOT, 'test', 'probe.ts');

describe('directoryImports（小程序 require 不解析目录 index）', () => {
  it('指向目录的说明符被判违规', () => {
    expect(directoryImports(`import { A } from '../shared/types';`, PROBE)).toEqual([
      '../shared/types',
    ]);
  });

  it('指向具体文件的说明符合规（运行时补 .js 即命中）', () => {
    expect(directoryImports(`import { TABS } from '../custom-tab-bar/tabs';`, PROBE)).toEqual([]);
  });

  it('目标不存在时不抛错也不算违规（缺文件由 tsc 负责）', () => {
    expect(directoryImports(`import { x } from './nope';`, PROBE)).toEqual([]);
  });

  it('反向证明：同一文件里目录导入与文件导入只揪出前者', () => {
    const src = `import { A } from '../shared/types';\nimport { B } from '../utils/tab-bar';`;
    expect(directoryImports(src, PROBE)).toEqual(['../shared/types']);
  });
});

// 与 wx-guard 同型的遍历守卫：真的扫磁盘上的运行时源码，不硬编码文件清单。
describe('遍历守卫：运行时代码禁止目录式相对导入', () => {
  const files = listTsFiles(ROOT, EXCLUDE_DIRS);

  it('扫描踩在真实路径上', () => {
    expect(files).toContain('store/session.ts');
    expect(files).toContain('api/request.ts');
    expect(files).toContain('pages/plaza/index.ts');
  });

  it('没有任何运行时 .ts 文件以目录形式做相对导入', () => {
    const offenders: string[] = [];
    for (const rel of files) {
      const abs = join(ROOT, rel);
      const hits = directoryImports(readFileSync(abs, 'utf8'), abs);
      if (hits.length > 0) offenders.push(`${rel}: ${hits.join(', ')}`);
    }
    if (offenders.length > 0) {
      throw new Error(
        '小程序运行时 require 只按字面路径补 .js 查找模块，不解析目录 index\n' +
          "（devtools 实测：module 'shared/types.js' is not defined, require args is '../shared/types'，\n" +
          'app.js 启动即崩，首屏 routeTo 等不到 routeDone 而超时）。\n' +
          '以下导入必须改写成 …/index 形态：\n' +
          offenders.join('\n'),
      );
    }
  });
});
