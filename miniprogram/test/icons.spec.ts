import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { extractFrontmatter } from '../tools/build-tokens';
import {
  COLOR_PLACEHOLDER,
  ROLES,
  buildIconMap,
  normalizeSvg,
  paint,
  renderModule,
  toDataUri,
} from '../tools/build-icons';

const RAW = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">
  <!-- 注释应被删掉 -->
  <circle cx="12" cy="8" r="3" fill="currentColor"/>
  <path d="M5 19h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
</svg>`;

describe('normalizeSvg', () => {
  it('删掉注释并压成一行', () => {
    const out = normalizeSvg(RAW);
    expect(out).not.toContain('<!--');
    expect(out).not.toContain('\n');
  });

  it('把可着色的 fill / stroke 换成占位符', () => {
    const out = normalizeSvg(RAW);
    expect(out).toContain(`fill="${COLOR_PLACEHOLDER}"`);
    expect(out).toContain(`stroke="${COLOR_PLACEHOLDER}"`);
    expect(out).not.toContain('currentColor');
  });

  it('保留 fill="none"', () => {
    expect(normalizeSvg(RAW)).toContain('fill="none"');
  });

  it('不动 stroke-width 与 stroke-linecap', () => {
    const out = normalizeSvg(RAW);
    expect(out).toContain('stroke-width="2"');
    expect(out).toContain('stroke-linecap="round"');
  });
});

describe('paint 与 toDataUri', () => {
  it('paint 把所有占位符换成同一个色值', () => {
    const out = paint(normalizeSvg(RAW), '#944a07');
    expect(out).not.toContain(COLOR_PLACEHOLDER);
    expect(out.match(/#944a07/g)).toHaveLength(2);
  });

  it('toDataUri 产出可解码回原串的 base64 data URI', () => {
    const svg = '<svg/>';
    const uri = toDataUri(svg);
    expect(uri.startsWith('data:image/svg+xml;base64,')).toBe(true);
    expect(Buffer.from(uri.split(',')[1], 'base64').toString('utf8')).toBe(svg);
  });
});

describe('buildIconMap', () => {
  const colors = { primary: '#944a07', 'on-surface': '#221a15' };

  it('为每个「图标 × 角色」组合生成一条 data URI', () => {
    const map = buildIconMap({ paw: RAW }, colors, ['primary', 'on-surface']);
    expect(Object.keys(map).sort()).toEqual(['paw:on-surface', 'paw:primary']);
    for (const uri of Object.values(map)) {
      expect(uri.startsWith('data:image/svg+xml;base64,')).toBe(true);
    }
  });

  it('角色在 DESIGN.md 里没有对应色值时直接抛错', () => {
    expect(() => buildIconMap({ paw: RAW }, colors, ['made-up'])).toThrow('made-up');
  });
});

describe('renderModule', () => {
  it('带禁止手改横幅，并导出 ICONS 与 IconKey', () => {
    const out = renderModule({ 'paw:primary': 'data:image/svg+xml;base64,AAA' });
    expect(out).toContain('请勿手改');
    expect(out).toContain('export const ICONS');
    expect(out).toContain('export type IconKey');
    expect(out).toContain("'paw:primary'");
  });
});

describe('真实资产', () => {
  const DESIGN_MD = resolve(__dirname, '../../stitch_/paws_paths/DESIGN.md');
  const ICON_DIR = resolve(__dirname, '../assets/icons');
  const colors = extractFrontmatter(readFileSync(DESIGN_MD, 'utf8')).colors as Record<
    string,
    string
  >;
  const svgs = Object.fromEntries(
    ['paw', 'place', 'person'].map((n) => [n, readFileSync(resolve(ICON_DIR, `${n}.svg`), 'utf8')]),
  );

  it('三个图标 × 四个角色 = 12 条，且色值来自 DESIGN.md', () => {
    const map = buildIconMap(svgs, colors, [
      'on-surface',
      'on-surface-variant',
      'primary',
      'on-primary',
    ]);
    expect(Object.keys(map)).toHaveLength(12);
    const decoded = Buffer.from(map['paw:primary'].split(',')[1], 'base64').toString('utf8');
    expect(decoded).toContain(colors.primary);
    expect(decoded).not.toContain('currentColor');
  });
});

// 改了 SVG 或色板却忘记重跑构建脚本时，陈旧的 icons.ts 会被发布，这里兜住。
describe('产物新鲜度', () => {
  const DESIGN = resolve(__dirname, '../../stitch_/paws_paths/DESIGN.md');
  const ICONS = resolve(__dirname, '../assets/icons');
  const OUTPUT = resolve(__dirname, '../components/wf-icon/icons.ts');
  /** 构建脚本写的是纯 LF；Windows 检出可能是 CRLF，统一后再严格比对。 */
  const lf = (s: string) => s.replace(/\r\n/g, '\n');

  it('已提交的 icons.ts 与 SVG 资产、DESIGN.md 色板重算结果严格一致', () => {
    const palette = extractFrontmatter(lf(readFileSync(DESIGN, 'utf8'))).colors as Record<
      string,
      string
    >;
    const all = Object.fromEntries(
      readdirSync(ICONS)
        .filter((f) => f.endsWith('.svg'))
        .sort()
        .map((f) => [f.replace(/\.svg$/, ''), lf(readFileSync(join(ICONS, f), 'utf8'))]),
    );
    const regenerated = renderModule(buildIconMap(all, palette, ROLES));
    try {
      expect(lf(readFileSync(OUTPUT, 'utf8'))).toBe(regenerated);
    } catch (err) {
      throw new Error(
        `components/wf-icon/icons.ts 已过期，请跑 npm run build:icons -w miniprogram\n${(err as Error).message}`,
      );
    }
  });
});
