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
