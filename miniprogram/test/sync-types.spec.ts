import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
});
