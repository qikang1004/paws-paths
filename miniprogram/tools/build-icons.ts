import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { extractFrontmatter } from './build-tokens';

const DESIGN_MD = resolve(__dirname, '../../stitch_/paws_paths/DESIGN.md');
const ICON_DIR = resolve(__dirname, '../assets/icons');
const OUTPUT = resolve(__dirname, '../components/wf-icon/icons.ts');

/** 可着色的角色。加角色就在这里加，别在页面里写死颜色。 */
export const ROLES = ['on-surface', 'on-surface-variant', 'primary', 'on-primary'];

/** 编译期占位符：先把 currentColor 抽成它，再按角色逐一注入真实色值。 */
export const COLOR_PLACEHOLDER = '__COLOR__';

const HEADER = [
  '/**',
  ' * 本文件由 tools/build-icons.ts 自动生成，请勿手改。',
  ' * 来源：assets/icons/*.svg + stitch_/paws_paths/DESIGN.md 的色板。',
  ' * 增删图标或改色后跑 npm run build:icons -w miniprogram。',
  ' */',
].join('\n');

/** 压平空白、删注释，并把 currentColor 抽成占位符；fill="none" 必须原样保留。 */
export function normalizeSvg(svg: string): string {
  return svg
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s*\n\s*/g, ' ')
    .replace(/(fill|stroke)="(?!none")[^"]*"/g, `$1="${COLOR_PLACEHOLDER}"`)
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function paint(svg: string, color: string): string {
  return svg.split(COLOR_PLACEHOLDER).join(color);
}

export function toDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}

export function buildIconMap(
  svgs: Record<string, string>,
  colors: Record<string, string>,
  roles: string[],
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const [name, raw] of Object.entries(svgs)) {
    const normalized = normalizeSvg(raw);
    for (const role of roles) {
      const color = colors[role];
      if (!color) throw new Error(`DESIGN.md 色板里没有角色 ${role}`);
      map[`${name}:${role}`] = toDataUri(paint(normalized, color));
    }
  }
  return map;
}

export function renderModule(map: Record<string, string>): string {
  const entries = Object.keys(map)
    .sort()
    .map((key) => `  '${key}': '${map[key]}',`)
    .join('\n');
  return `${HEADER}\n\nexport const ICONS = {\n${entries}\n} as const;\n\nexport type IconKey = keyof typeof ICONS;\n`;
}

/** CLI 入口：扫 assets/icons，按 ROLES 逐一着色，写 components/wf-icon/icons.ts。 */
if ((require as typeof require & { main?: unknown }).main === module) {
  const colors = extractFrontmatter(readFileSync(DESIGN_MD, 'utf8')).colors as Record<
    string,
    string
  >;
  const svgs = Object.fromEntries(
    readdirSync(ICON_DIR)
      .filter((f) => f.endsWith('.svg'))
      .sort()
      .map((f) => [f.replace(/\.svg$/, ''), readFileSync(join(ICON_DIR, f), 'utf8')]),
  );
  const module_ = renderModule(buildIconMap(svgs, colors, ROLES));
  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, module_, 'utf8');
  console.log(`icons.ts 已生成：${Object.keys(svgs).length} 个图标 × ${ROLES.length} 个角色`);
}
