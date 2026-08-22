import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { syncTypes } from '../tools/sync-types';

function makeDist(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'paws-dist-'));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content, 'utf8');
  }
  return dir;
}

describe('syncTypes', () => {
  let src: string;
  let dest: string;

  beforeEach(() => {
    src = makeDist({
      'index.js': 'exports.a = 1;',
      'index.d.ts': 'export declare const a: number;',
      'index.js.map': '{}',
    });
    dest = mkdtempSync(join(tmpdir(), 'paws-dest-'));
  });

  afterEach(() => {
    rmSync(src, { recursive: true, force: true });
    rmSync(dest, { recursive: true, force: true });
  });

  it('只同步 .js 与 .d.ts，跳过 sourcemap', () => {
    expect(syncTypes(src, dest)).toEqual(['index.d.ts', 'index.js']);
    expect(readdirSync(dest)).not.toContain('index.js.map');
  });

  it('每个产物顶部加上禁止手改的注释', () => {
    syncTypes(src, dest);
    expect(readFileSync(join(dest, 'index.js'), 'utf8')).toContain('禁止手改');
  });

  it('dist 里删掉的文件同步后不残留', () => {
    syncTypes(src, dest);
    writeFileSync(join(dest, 'ghost.d.ts'), 'export {};', 'utf8');
    syncTypes(src, dest);
    expect(readdirSync(dest)).not.toContain('ghost.d.ts');
  });

  it('重复执行产物完全一致', () => {
    syncTypes(src, dest);
    const first = readFileSync(join(dest, 'index.js'), 'utf8');
    syncTypes(src, dest);
    expect(readFileSync(join(dest, 'index.js'), 'utf8')).toBe(first);
  });

  it('dist 不存在时报错并给出补救命令', () => {
    expect(() => syncTypes(join(src, 'nope'), dest)).toThrow(/npm run build -w @paws\/types/);
  });

  it('通过相对路径执行编译后的 CLI 时同步产物', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'paws-sync-cli-'));
    const fixtureMiniprogram = join(fixture, 'miniprogram');
    const fixtureDist = join(fixture, 'packages/types/dist');
    const compiledTools = join(fixtureMiniprogram, 'tools');

    try {
      mkdirSync(fixtureDist, { recursive: true });
      writeFileSync(join(fixtureDist, 'index.js'), 'exports.a = 1;', 'utf8');
      writeFileSync(join(fixtureDist, 'index.d.ts'), 'export declare const a: number;', 'utf8');
      execFileSync(
        process.execPath,
        [
          resolve(__dirname, '../../node_modules/typescript/bin/tsc'),
          '--module',
          'commonjs',
          '--target',
          'ES2022',
          '--moduleResolution',
          'node',
          '--outDir',
          compiledTools,
          resolve(__dirname, '../tools/sync-types.ts'),
        ],
        { encoding: 'utf8' },
      );

      const output = execFileSync(
        process.execPath,
        [
          '-e',
          `
            const Module = require('node:module');
            const path = require('node:path');
            const target = path.resolve('tools/sync-types.js');
            const entry = new Module(target, null);
            entry.filename = target;
            entry.paths = Module._nodeModulePaths(path.dirname(target));
            require.main = entry;
            process.mainModule = entry;
            process.argv[1] = 'tools/sync-types.js';
            entry.load(target);
          `,
        ],
        { cwd: fixtureMiniprogram, encoding: 'utf8' },
      );

      expect(output).toContain('已同步 2 个文件');
      expect(readdirSync(join(fixtureMiniprogram, 'shared/types')).sort()).toEqual([
        'index.d.ts',
        'index.js',
      ]);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});

// icons.ts / tokens.wxss 都有本地新鲜度守卫，shared/types 却只在 CI 查漂移，本地 npm test
// 看不出改了 packages/types 忘记重新 sync。照 icons.spec.ts / build-tokens.spec.ts 的写法补上：
// 从提交在库的源 packages/types/src 现场重新编译并同步，与已提交产物严格比对（LF 归一化）。
describe('产物新鲜度', () => {
  const TYPES_TSCONFIG = resolve(__dirname, '../../packages/types/tsconfig.json');
  const TSC = resolve(__dirname, '../../node_modules/typescript/bin/tsc');
  const COMMITTED = resolve(__dirname, '../shared/types');
  /** 构建脚本写的是纯 LF；Windows 检出可能是 CRLF，统一后再严格比对。 */
  const lf = (s: string) => s.replace(/\r\n/g, '\n');
  const snapshot = (dir: string): Record<string, string> =>
    Object.fromEntries(
      readdirSync(dir)
        .sort()
        .map((name) => [name, lf(readFileSync(join(dir, name), 'utf8'))]),
    );

  it('已提交的 shared/types 与 packages/types/src 现场重编译+同步的结果严格一致', () => {
    const freshDist = mkdtempSync(join(tmpdir(), 'paws-fresh-dist-'));
    const freshDest = mkdtempSync(join(tmpdir(), 'paws-fresh-dest-'));
    try {
      // 现场把 packages/types 编译进临时 dist：等价于 npm run build -w @paws/types，
      // 不依赖工作树里 dist 是否已存在，测试自足。
      execFileSync(process.execPath, [TSC, '-p', TYPES_TSCONFIG, '--outDir', freshDist], {
        encoding: 'utf8',
      });
      syncTypes(freshDist, freshDest);
      const regenerated = snapshot(freshDest);
      const committed = snapshot(COMMITTED);
      try {
        expect(committed).toEqual(regenerated);
      } catch (err) {
        throw new Error(
          `miniprogram/shared/types 已过期，请跑 npm run sync:types（先 npm run build -w @paws/types）\n${(err as Error).message}`,
        );
      }
    } finally {
      rmSync(freshDist, { recursive: true, force: true });
      rmSync(freshDest, { recursive: true, force: true });
    }
  });
});
