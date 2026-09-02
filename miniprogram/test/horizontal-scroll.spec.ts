import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  findHorizontalScrollers,
  hasHeightRule,
  listWxmlFiles,
  stripWxmlComments,
} from '../tools/style-guard';

const ROOT = resolve(__dirname, '..');
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

describe('守卫函数本身', () => {
  it('认出 scroll-x 的两种写法', () => {
    expect(findHorizontalScrollers('<scroll-view class="a" scroll-x>', 'x')).toEqual([
      { file: 'x', className: 'a' },
    ]);
    expect(findHorizontalScrollers('<scroll-view class="b" scroll-x="{{true}}">', 'x')).toEqual([
      { file: 'x', className: 'b' },
    ]);
  });

  /** 纵向那批的高度由 `.page-scroll` 的 flex 分配，不该被这条守卫拦。 */
  it('不把 scroll-y 当横向', () => {
    expect(findHorizontalScrollers('<scroll-view class="a" scroll-y="{{true}}">', 'x')).toEqual([]);
  });

  it('显式关掉的 scroll-x 不算', () => {
    expect(findHorizontalScrollers('<scroll-view class="a" scroll-x="{{false}}">', 'x')).toEqual([]);
  });

  /** 注释里写着示例标签是这次改动的常态 —— 扫标签必须先去注释。 */
  it('注释里的 scroll-view 不算', () => {
    const wxml = '<!-- <scroll-view class="ghost" scroll-x> --><view/>';
    expect(findHorizontalScrollers(wxml, 'x')).toEqual([]);
    expect(stripWxmlComments(wxml)).not.toContain('ghost');
  });

  it('属性顺序不限，class 在后面也认得出', () => {
    expect(findHorizontalScrollers('<scroll-view scroll-x enable-flex class="c">', 'x')).toEqual([
      { file: 'x', className: 'c' },
    ]);
  });

  it('hasHeightRule 认 height / min-height / aspect-ratio', () => {
    expect(hasHeightRule('.a { height: 48rpx; }', 'a')).toBe(true);
    expect(hasHeightRule('.a { min-height: 48rpx; }', 'a')).toBe(true);
    expect(hasHeightRule('.a { aspect-ratio: 1; }', 'a')).toBe(true);
    expect(hasHeightRule('.a { display: flex; }', 'a')).toBe(false);
  });

  it('hasHeightRule 不被注释里的 height 骗过去', () => {
    expect(hasHeightRule('/* height: 48rpx */ .a { display: flex; }', 'a')).toBe(false);
  });

  /** `.me__pet` 与 `.me__pets` 是前缀关系 —— 匹配必须按整个类名，不能子串。 */
  it('hasHeightRule 不把前缀相同的另一个类算进来', () => {
    const css = '.me__pet { height: 10rpx; }\n.me__pets { display: flex; }';
    expect(hasHeightRule(css, 'me__pets')).toBe(false);
    expect(hasHeightRule(css, 'me__pet')).toBe(true);
  });
});

/**
 * 横向 scroll-view 必须有显式高度。
 *
 * Skyline 下 `scroll-view` 是真正的滚动容器，横向滚动时它**不会被子元素顶开** ——
 * 不给高度就算成 0，容器后面的内容按正常流排上来把它盖住。真机上的表现是
 * 「广场页顶部筛选按钮被内容列表遮挡」，而单元测试看不出来（它们只读 markup 文本）。
 *
 * 这份守卫遍历全部 wxml，所以新加的横向 scroll-view 漏了高度会在这里红 ——
 * 那次踩坑之后，纵向那批有 `test/page-scroll.spec.ts` 兜着，横向这批到现在才有。
 */
describe('横向 scroll-view 的高度（Skyline 下不会被子元素顶开）', () => {
  const wxmlFiles = listWxmlFiles(ROOT);
  const scrollers = wxmlFiles.flatMap((file) => findHorizontalScrollers(read(file), file));

  it('确实扫到了横向滚动容器，遍历没有空跑', () => {
    // 万一 listWxmlFiles 或正则写歪，下面的 each 会静默零用例通过。
    expect(scrollers.length).toBeGreaterThan(0);
  });

  it.each(scrollers.map((s) => [s.file, s.className]))(
    '%s 的 .%s 有显式高度',
    (file, className) => {
      // 同一个容器可能挂多个类（`filter-chips__row filter-chips__row--sub`），
      // 只要其中一个给了高度就算 —— 修饰类通常只调间距。
      const wxss = read(String(file).replace(/\.wxml$/, '.wxss'));
      const classes = String(className).split(/\s+/).filter(Boolean);
      expect(classes.length).toBeGreaterThan(0);
      expect(classes.some((cls) => hasHeightRule(wxss, cls))).toBe(true);
    },
  );

  /**
   * 高度值不许写死字面量而要经过 token —— 与 `style-guard.spec.ts` 里那条
   * 「不许裸 px」同源。这里额外要求的是：横向容器的高度应当由它承载的内容
   * 推出来（字号 + 间距），而不是一个凑出来的数。
   */
  it('高度式子引用了 token，不是纯字面量', () => {
    for (const { file, className } of scrollers) {
      const wxss = read(file.replace(/\.wxml$/, '.wxss'));
      const cls = className.split(/\s+/)[0];
      const block = new RegExp(`\\.${cls}\\s*\\{([^}]*)\\}`).exec(wxss);
      expect(block).not.toBeNull();
      const height = /\b(?:min-)?height\s*:\s*([^;]+);/.exec(block?.[1] ?? '')?.[1] ?? '';
      expect(height).toMatch(/var\(--/);
    }
  });
});
