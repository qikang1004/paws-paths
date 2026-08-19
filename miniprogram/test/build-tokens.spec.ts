import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { compileTokens, hexToRgb, pxToRpx } from '../tools/build-tokens';

const SAMPLE = `---
name: Paws & Paths
colors:
  primary: '#944a07'
  surface-container-lowest: '#ffffff'
typography:
  headline-lg:
    fontFamily: Quicksand
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 32px
  headline-xl:
    fontFamily: Quicksand
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.02em
rounded:
  DEFAULT: 1rem
  lg: 2rem
spacing:
  md: 16px
  margin-mobile: 20px
---

## Brand & Style
正文内容不参与编译。
`;

describe('pxToRpx', () => {
  it('px 按 1:2 换算', () => {
    expect(pxToRpx('16px')).toBe('32rpx');
    expect(pxToRpx('20px')).toBe('40rpx');
  });

  it('rem 先按 16px 折算再翻倍', () => {
    expect(pxToRpx('1rem')).toBe('32rpx');
    expect(pxToRpx('2rem')).toBe('64rpx');
  });

  it('em 与无单位值原样保留', () => {
    expect(pxToRpx('-0.02em')).toBe('-0.02em');
    expect(pxToRpx('700')).toBe('700');
  });
});

describe('compileTokens', () => {
  const css = compileTokens(SAMPLE);

  it('产出 page 选择器包裹的变量块', () => {
    expect(css).toContain('page {');
  });

  it('色值原样输出为 --color-* 变量', () => {
    expect(css).toContain('--color-primary: #944a07;');
    expect(css).toContain('--color-surface-container-lowest: #ffffff;');
  });

  it('间距换算为 rpx', () => {
    expect(css).toContain('--space-md: 32rpx;');
    expect(css).toContain('--space-margin-mobile: 40rpx;');
  });

  it('圆角 rem 换算为 rpx，DEFAULT 归一化为 default', () => {
    expect(css).toContain('--radius-default: 32rpx;');
    expect(css).toContain('--radius-lg: 64rpx;');
  });

  it('字号、行高换算，字重与字距原样保留', () => {
    expect(css).toContain('--font-headline-lg-size: 48rpx;');
    expect(css).toContain('--font-headline-lg-line: 64rpx;');
    expect(css).toContain('--font-headline-lg-weight: 700;');
    expect(css).toContain('--font-headline-xl-spacing: -0.02em;');
  });

  it('没有 letterSpacing 的层级不产出 spacing 变量', () => {
    expect(css).not.toContain('--font-headline-lg-spacing');
  });

  it('带生成物警示注释，避免有人手改', () => {
    expect(css).toContain('自动生成');
  });

  it('正文内容不会泄漏进产物', () => {
    expect(css).not.toContain('Brand & Style');
  });
});

const SAMPLE_DARK_TEXT = SAMPLE.replace(
  "  primary: '#944a07'",
  "  primary: '#944a07'\n  on-surface: '#221a15'",
);

describe('hexToRgb', () => {
  it('六位十六进制转 rgb 三元组', () => {
    expect(hexToRgb('#221a15')).toBe('34, 26, 21');
    expect(hexToRgb('#ffffff')).toBe('255, 255, 255');
  });

  it('三位缩写先展开再转', () => {
    expect(hexToRgb('#fff')).toBe('255, 255, 255');
  });

  it('非法色值直接报错，不静默产出坏 token', () => {
    expect(() => hexToRgb('rgb(1,2,3)')).toThrow(/无法解析色值/);
  });
});

describe('阴影 token', () => {
  it('由 on-surface 派生，透明度落在 5%-8% 区间', () => {
    const css = compileTokens(SAMPLE_DARK_TEXT);
    expect(css).toContain('--shadow-ambient: 0 8rpx 40rpx rgba(34, 26, 21, 0.06);');
    expect(css).toContain('--shadow-pressed: 0 4rpx 16rpx rgba(34, 26, 21, 0.05);');
  });

  it('派生出朝上的阴影，供自定义 tabBar 用', () => {
    const css = compileTokens(SAMPLE_DARK_TEXT);
    expect(css).toContain('--shadow-raised: 0 -8rpx 40rpx rgba(34, 26, 21, 0.06);');
  });

  it('缺 on-surface 时不产出阴影 token，也不抛错', () => {
    expect(compileTokens(SAMPLE)).not.toContain('--shadow-ambient');
  });
});

// 改了 DESIGN.md 却忘记重跑构建脚本时，陈旧的 tokens.wxss 会被发布，这里兜住。
describe('产物新鲜度', () => {
  const DESIGN = resolve(__dirname, '../../stitch_/paws_paths/DESIGN.md');
  const OUTPUT = resolve(__dirname, '../styles/tokens.wxss');
  /** 构建脚本写的是纯 LF；Windows 检出可能是 CRLF，统一后再严格比对。 */
  const lf = (s: string) => s.replace(/\r\n/g, '\n');

  it('已提交的 tokens.wxss 与 DESIGN.md frontmatter 重算结果严格一致', () => {
    const regenerated = compileTokens(lf(readFileSync(DESIGN, 'utf8')));
    try {
      expect(lf(readFileSync(OUTPUT, 'utf8'))).toBe(regenerated);
    } catch (err) {
      throw new Error(
        `styles/tokens.wxss 已过期，请跑 npm run build:tokens -w miniprogram\n${(err as Error).message}`,
      );
    }
  });
});
