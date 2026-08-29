import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { findBarePx, findHexLiterals, findUndefinedVars } from '../tools/style-guard';
import { buildDetailView } from '../pages/pet-detail/detail-model';
import { formatPetAge, type PetDetail } from '../shared/types/index';

const ROOT = resolve(__dirname, '..');
const TOKENS = readFileSync(join(ROOT, 'styles/tokens.wxss'), 'utf8');
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');
const NOW = new Date('2026-08-16T00:00:00Z');

const detail = (over: Partial<PetDetail> = {}): PetDetail => ({
  id: 'p-1',
  name: '布丁',
  species: 'cat',
  breed: '布偶',
  gender: 'female',
  birthDate: '2024-02-16',
  bio: '爱睡懒觉，喜欢晒太阳。',
  personalityTags: ['粘人', '爱睡'],
  distanceMeters: 1200,
  owner: { nickname: '小鱼', avatarUrl: null, ownerVerified: true },
  photos: [
    { id: 'ph-1', url: 'https://picsum.photos/id/237/600/800', width: 600, height: 800 },
    { id: 'ph-2', url: 'https://picsum.photos/id/238/800/600', width: 800, height: 600 },
  ],
  isFollowing: false,
  isFavorite: false,
  isOwn: false,
  ...over,
});

describe('buildDetailView', () => {
  it('拼出「品种 · 性别 · 年龄」一行', () => {
    const view = buildDetailView(detail(), NOW);
    const ageText = formatPetAge('2024-02-16', NOW).text;
    expect(view.name).toBe('布丁');
    expect(view.ageText).toBe(ageText);
    expect(view.metaText).toBe(`布偶 · 雌 · ${ageText}`);
  });

  it('性别未知时不在 meta 里留空段', () => {
    const view = buildDetailView(detail({ gender: 'unknown' }), NOW);
    expect(view.metaText).not.toContain('·  ·');
    expect(view.metaText.startsWith('布偶 · ')).toBe(true);
  });

  it('bio 为空则不渲染那一行', () => {
    expect(buildDetailView(detail({ bio: '' }), NOW).bioShown).toBe(false);
    expect(buildDetailView(detail({ bio: '   ' }), NOW).bioShown).toBe(false);
    expect(buildDetailView(detail(), NOW).bioShown).toBe(true);
  });

  it('相册每项带 ratio 与递增 index', () => {
    const { album } = buildDetailView(detail(), NOW);
    expect(album).toHaveLength(2);
    expect(album[0].index).toBe(0);
    expect(album[1].index).toBe(1);
    expect(album[0].ratio).toBeCloseTo(800 / 600);
    expect(album[1].ratio).toBeCloseTo(600 / 800);
    expect(album[0].id).toBe('ph-1');
  });

  it('相册给出 previewImage 需要的 urls，顺序与 index 一致', () => {
    const view = buildDetailView(detail(), NOW);
    expect(view.urls).toEqual([
      'https://picsum.photos/id/237/600/800',
      'https://picsum.photos/id/238/800/600',
    ]);
  });

  it('距离缺失时不显示距离', () => {
    expect(buildDetailView(detail({ distanceMeters: null }), NOW).distanceText).toBe('');
    expect(buildDetailView(detail(), NOW).distanceText).toBe('1.2km');
  });

  it('没有照片时轮播与相册都为空，不崩', () => {
    const view = buildDetailView(detail({ photos: [] }), NOW);
    expect(view.album).toEqual([]);
    expect(view.urls).toEqual([]);
  });
});

describe('buildDetailView 的关注态（阶段 3 Task 11）', () => {
  it('透出 isFollowing —— 服务端必填，页面不兜 ?? false', () => {
    expect(buildDetailView(detail({ isFollowing: true }), NOW).isFollowing).toBe(true);
    expect(buildDetailView(detail({ isFollowing: false }), NOW).isFollowing).toBe(false);
  });

  it('透出 isOwn，并据此决定关注按钮显不显示', () => {
    // 自己的宠物不出关注按钮：服务端 `FOLLOW_SELF:42203` 会挡下来，
    // 但让按钮出现再报错，等于把一个必然失败的动作摆在用户面前。
    expect(buildDetailView(detail({ isOwn: true }), NOW).showFollow).toBe(false);
    expect(buildDetailView(detail({ isOwn: false }), NOW).showFollow).toBe(true);
  });

  it('按钮文案随 isFollowing 切换', () => {
    expect(buildDetailView(detail({ isFollowing: false }), NOW).followText).toBe('关注');
    expect(buildDetailView(detail({ isFollowing: true }), NOW).followText).toBe('已关注');
  });
});

describe('宠物详情页配置与结构', () => {
  it('json 声明 wf-list 与 empty-state', () => {
    const json = JSON.parse(read('pages/pet-detail/index.json')) as {
      usingComponents?: Record<string, string>;
    };
    const used = json.usingComponents ?? {};
    expect(used['wf-list']).toBe('/components/wf-list/index');
    expect(used['empty-state']).toBe('/components/empty-state/index');
  });

  it('wxml 有轮播、标签、主人卡与相册', () => {
    const wxml = read('pages/pet-detail/index.wxml');
    expect(wxml).toContain('<swiper');
    expect(wxml).toContain('indicator-dots');
    expect(wxml).toContain('circular');
    expect(wxml).toContain('chip--sm');
    expect(wxml).toContain('itemTemplate="photo-tpl"');
    expect(wxml).toContain('bind:photo-tap="onPhotoTap"');
    expect(wxml).toContain('{{view.metaText}}');
    expect(wxml).toContain('wx:if="{{view.bioShown}}"');
  });

  it('页面 ts 拉详情、预览大图、支持分享与错误重试', () => {
    const ts = read('pages/pet-detail/index.ts');
    expect(ts).toContain('fetchPetDetail');
    expect(ts).toContain('buildDetailView');
    expect(ts).toContain('previewImage');
    expect(ts).toContain('onShareAppMessage');
    expect(ts).toContain('onRetry');
    // 定位只能经 store，页面不得自己要坐标。
    expect(ts).toContain('locationStore');
  });

  it('wxss 不出现色值字面量、裸 px、未定义 token', () => {
    const css = read('pages/pet-detail/index.wxss');
    expect(findHexLiterals(css)).toEqual([]);
    expect(findBarePx(css)).toEqual([]);
    expect(findUndefinedVars(css, TOKENS)).toEqual([]);
  });
});

/**
 * 关注开关（阶段 3 Task 11）。
 *
 * 这一组是本轮唯一的计划外新增任务：`followPet` / `unfollowPet` 在 `api/follows.ts`
 * 里齐备、服务端端点也在，但**没有任何页面调用它们** —— 没有这一步，谁也关注不了
 * 任何宠物，Task 10 的 feed 页永远是空列表。
 */
describe('宠物详情页的关注开关', () => {
  it('json 声明 sq-button（关注按钮用它）', () => {
    const json = JSON.parse(read('pages/pet-detail/index.json')) as {
      usingComponents?: Record<string, string>;
    };
    expect((json.usingComponents ?? {})['sq-button']).toBe('/components/sq-button/index');
  });

  it('wxml 有关注按钮，文案与禁用态都来自 view', () => {
    const wxml = read('pages/pet-detail/index.wxml');
    expect(wxml).toContain('bind:tap="onToggleFollow"');
    expect(wxml).toContain('{{view.followText}}');
    // 自己的宠物不出这个按钮。
    expect(wxml).toContain('wx:if="{{view.showFollow}}"');
    // 进行中禁用，挡连点。
    expect(wxml).toContain('disabled="{{following}}"');
  });

  it('页面 ts 按当前态分别调 followPet / unfollowPet', () => {
    const ts = read('pages/pet-detail/index.ts');
    expect(ts).toContain('followPet');
    expect(ts).toContain('unfollowPet');
    expect(ts).toContain('onToggleFollow');
    // 进行中标志挡连点：关注/取关不满足「点两次等于点一次」的直觉 ——
    // 连点会打出两个反向请求，最终态取决于哪个先回。
    expect(ts).toContain('following');
    expect(ts).toMatch(/if\s*\(this\.data\.following\)\s*return/);
  });

  it('成功后就地翻转 isFollowing，不重拉详情', () => {
    const ts = read('pages/pet-detail/index.ts');
    // 重拉整页会把相册与滚动位置一起重置。
    expect(ts).toMatch(/setData\(\{[^}]*'view\.isFollowing'/);
    expect(ts).toMatch(/setData\(\{[^}]*'view\.followText'/);
    // onToggleFollow 里不许出现 this.load() —— 那就是重拉详情。
    const body = ts.slice(ts.indexOf('onToggleFollow'), ts.indexOf('onShareAppMessage'));
    expect(body).not.toContain('this.load()');
  });

  it('失败弹 toast 且不翻转 —— 乐观更新在这里不合适', () => {
    const ts = read('pages/pet-detail/index.ts');
    // 关注态是 feed 的入口条件：显示成功而实际没写进去，用户会以为 feed 该有内容。
    // 所以先等服务端回，再改本地态。
    const body = ts.slice(ts.indexOf('onToggleFollow'), ts.indexOf('onShareAppMessage'));
    expect(body).toContain('wx.showToast');
    // 翻转必须在 await 之后（try 块里），不是在发请求之前。
    expect(body).toMatch(/await\s+(?:followPet|unfollowPet|toggle)[\s\S]*?setData/);
    // 进行中标志一律在 finally 里复位，否则失败一次按钮就永久禁用了。
    // 正则容一行注释：那句复位旁边正需要写明「为什么一律复位」。
    expect(body).toMatch(/finally\s*\{\s*(?:\/\/[^\n]*\n\s*)?this\.setData\(\{\s*following:\s*false/);
  });
});
