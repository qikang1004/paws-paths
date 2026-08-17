import { compileTokens, pxToRpx } from '../tools/build-tokens';

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
