import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

const SRC = resolve(__dirname, '../../packages/types/dist');
const DEST = resolve(__dirname, '../shared/types');
const SYNCED_EXT = ['.js', '.d.ts'];

const BANNER =
  '// 由 packages/types 同步而来，禁止手改。\n' +
  '// 改动请改 packages/types，然后跑 npm run sync:types。\n';

export function syncTypes(srcDir: string, destDir: string): string[] {
  if (!existsSync(srcDir)) {
    throw new Error(`未找到 ${srcDir}，先跑 npm run build -w @paws/types`);
  }
  rmSync(destDir, { recursive: true, force: true });
  mkdirSync(destDir, { recursive: true });
  const names = readdirSync(srcDir)
    .filter((f) => SYNCED_EXT.some((ext) => f.endsWith(ext)))
    .sort();
  for (const name of names) {
    writeFileSync(join(destDir, name), BANNER + readFileSync(join(srcDir, name), 'utf8'), 'utf8');
  }
  return names;
}

if (process.argv[1] === __filename) {
  const written = syncTypes(SRC, DEST);
  console.log(`已同步 ${written.length} 个文件：${written.join(', ')}`);
}
