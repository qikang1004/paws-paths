import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parse } from 'yaml';

const DESIGN_MD = resolve(__dirname, '../../stitch_/paws_paths/DESIGN.md');
const OUTPUT = resolve(__dirname, '../styles/tokens.wxss');

interface TypographyEntry {
  fontFamily?: string;
  fontSize?: string;
  fontWeight?: string;
  lineHeight?: string;
  letterSpacing?: string;
}

export interface DesignFrontmatter {
  colors?: Record<string, string>;
  typography?: Record<string, TypographyEntry>;
  rounded?: Record<string, string>;
  spacing?: Record<string, string>;
}

/** 统一换算：1px = 2rpx，1rem = 16px = 32rpx；其他单位原样保留。 */
export function pxToRpx(value: string): string {
  const raw = String(value).trim();
  const px = /^(-?[\d.]+)px$/.exec(raw);
  if (px) return `${parseFloat(px[1]) * 2}rpx`;
  const rem = /^(-?[\d.]+)rem$/.exec(raw);
  if (rem) return `${parseFloat(rem[1]) * 16 * 2}rpx`;
  return raw;
}

/** Task 15 的图标管线也要读色板，所以这里导出。 */
export function extractFrontmatter(markdown: string): DesignFrontmatter {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown);
  if (!match) throw new Error('DESIGN.md 缺少 frontmatter，无法编译 token');
  return parse(match[1]) as DesignFrontmatter;
}

const HEADER = [
  '/**',
  ' * 本文件由 tools/build-tokens.ts 自动生成，请勿手改。',
  ' * 来源：stitch_/paws_paths/DESIGN.md 的 frontmatter。',
  ' * 改 token 请改 DESIGN.md 后跑 npm run build:tokens -w miniprogram。',
  ' */',
].join('\n');

export function compileTokens(designMarkdown: string): string {
  const fm = extractFrontmatter(designMarkdown);
  const lines: string[] = [];

  for (const [name, value] of Object.entries(fm.colors ?? {})) {
    lines.push(`  --color-${name}: ${value};`);
  }
  for (const [name, value] of Object.entries(fm.spacing ?? {})) {
    lines.push(`  --space-${name}: ${pxToRpx(value)};`);
  }
  for (const [name, value] of Object.entries(fm.rounded ?? {})) {
    const key = name === 'DEFAULT' ? 'default' : name;
    lines.push(`  --radius-${key}: ${pxToRpx(value)};`);
  }
  for (const [level, entry] of Object.entries(fm.typography ?? {})) {
    if (entry.fontFamily) lines.push(`  --font-${level}-family: ${entry.fontFamily};`);
    if (entry.fontSize) lines.push(`  --font-${level}-size: ${pxToRpx(entry.fontSize)};`);
    if (entry.lineHeight) lines.push(`  --font-${level}-line: ${pxToRpx(entry.lineHeight)};`);
    if (entry.fontWeight) lines.push(`  --font-${level}-weight: ${entry.fontWeight};`);
    if (entry.letterSpacing) lines.push(`  --font-${level}-spacing: ${entry.letterSpacing};`);
  }

  return `${HEADER}\n\npage {\n${lines.join('\n')}\n}\n`;
}

/** CLI 入口：读 DESIGN.md，写 styles/tokens.wxss。 */
if ((require as typeof require & { main?: unknown }).main === module) {
  const css = compileTokens(readFileSync(DESIGN_MD, 'utf8'));
  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, css, 'utf8');
  console.log(`tokens.wxss 已生成：${OUTPUT}`);
}
