import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { findBarePx, findHexLiterals, findUndefinedVars } from '../tools/style-guard';
import {
  NICKNAME_MAX_LENGTH,
  PROFILE_ENTRIES,
  buildPetTile,
  buildProfileView,
} from '../pages/profile/profile-model';
import type { PetSummary, ProfileDto } from '../shared/types/index';

const ROOT = resolve(__dirname, '..');
const TOKENS = readFileSync(join(ROOT, 'styles/tokens.wxss'), 'utf8');
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');
const BASE = 'https://api.example.com';

const profile = (over: Partial<ProfileDto> = {}): ProfileDto => ({
  nickname: '铲屎官小王',
  avatarUrl: '/uploads/u-1/avatar.jpg',
  isVerifiedOwner: false,
  petCount: 2,
  followingCount: 7,
  favoriteCount: 3,
  ...over,
});

const pet = (over: Partial<PetSummary> = {}): PetSummary => ({
  id: 'p-1',
  name: '大黄',
  species: 'dog',
  breed: '柴犬',
  gender: 'male',
  birthDate: '2024-03-01',
  coverUrl: '/uploads/u-1/a.jpg',
  coverWidth: 1200,
  coverHeight: 900,
  personalityTags: ['粘人'],
  distanceMeters: null,
  ownerNickname: '铲屎官小王',
  ownerAvatarUrl: null,
  ownerVerified: false,
  isFollowing: false,
  ...over,
});

describe('buildProfileView', () => {
  it('三个计数按固定顺序摊平给模板', () => {
    const view = buildProfileView(profile(), BASE);
    expect(view.counts).toEqual([
      { key: 'pets', label: '宠物', value: 2 },
      { key: 'following', label: '关注', value: 7 },
      { key: 'favorites', label: '收藏', value: 3 },
    ]);
  });

  it('头像相对路径补成绝对地址', () => {
    expect(buildProfileView(profile(), BASE).avatarUrl).toBe(`${BASE}/uploads/u-1/avatar.jpg`);
  });

  it('没有头像时回空串，模板用它决定画不画默认图', () => {
    expect(buildProfileView(profile({ avatarUrl: null }), BASE).avatarUrl).toBe('');
  });

  it('认证角标只在服务端说了 isVerifiedOwner 时显示', () => {
    expect(buildProfileView(profile(), BASE).showVerified).toBe(false);
    expect(buildProfileView(profile({ isVerifiedOwner: true }), BASE).showVerified).toBe(true);
  });

  it('资料还没到（null）也能渲染：昵称占位、计数全 0', () => {
    const view = buildProfileView(null, BASE);
    expect(view.nickname).toBe('');
    expect(view.avatarUrl).toBe('');
    expect(view.showVerified).toBe(false);
    expect(view.counts.map((c) => c.value)).toEqual([0, 0, 0]);
  });
});

describe('PROFILE_ENTRIES', () => {
  it('五个入口指向 profile 分包里真实声明过的页面', () => {
    const app = JSON.parse(read('app.json')) as {
      subPackages: { root: string; pages: string[] }[];
    };
    const declared = app.subPackages.flatMap((pkg) => pkg.pages.map((p) => `/${pkg.root}/${p}`));
    // 顺序也钉住：`feed` 紧跟在 `following` 后面，两者是关注这件事的两面
    // （关注了谁 / 他们发了什么）。阶段 3 Task 10 加的就是那一项。
    expect(PROFILE_ENTRIES.map((e) => e.key)).toEqual([
      'posts',
      'following',
      'feed',
      'favorites',
      'history',
    ]);
    for (const entry of PROFILE_ENTRIES) {
      expect(declared).toContain(entry.url);
      expect(entry.label.length).toBeGreaterThan(0);
    }
  });
});

describe('buildPetTile', () => {
  it('点进宠物编辑页，带上 id', () => {
    const tile = buildPetTile(pet(), BASE);
    expect(tile.url).toBe('/packages/profile/pages/pet-edit/index?id=p-1');
    expect(tile.name).toBe('大黄');
    expect(tile.coverUrl).toBe(`${BASE}/uploads/u-1/a.jpg`);
  });

  it('还没传照片的宠物（封面空串）也能出现在清单里', () => {
    // GET /me/pets 刻意不筛封面：不然主人没有入口进去传第一张照片。
    expect(buildPetTile(pet({ coverUrl: '' }), BASE).coverUrl).toBe('');
  });
});

describe('个人中心页配置与结构', () => {
  it('json 声明了 tabBar 页需要的组件', () => {
    const json = JSON.parse(read('pages/profile/index.json')) as {
      navigationBarTitleText?: string;
      usingComponents?: Record<string, string>;
    };
    expect(json.navigationBarTitleText).toBe('我的');
    // 只声明真的用到的：lazyCodeLoading 按声明裁剪，多余的声明只会误导下一个人。
    expect(json.usingComponents).toEqual({ 'wf-icon': '/components/wf-icon/index' });
  });

  it('wxml 有资料头、计数、宠物条与入口列表', () => {
    const wxml = read('pages/profile/index.wxml');
    expect(wxml).toContain('{{view.nickname}}');
    expect(wxml).toContain('wx:for="{{view.counts}}"');
    expect(wxml).toContain('wx:for="{{pets}}"');
    expect(wxml).toContain('wx:for="{{entries}}"');
    expect(wxml).toContain('bindtap="onEntryTap"');
    expect(wxml).toContain('bindtap="onEditNickname"');
    expect(wxml).toContain('bindtap="onChangeAvatar"');
    expect(wxml).toContain('bindtap="onCreatePet"');
  });

  it('页面 ts 经 api 层取数、onShow 同步 tabBar 与最新计数', () => {
    const ts = read('pages/profile/index.ts');
    expect(ts).toContain('fetchProfile');
    expect(ts).toContain('fetchMyPets');
    expect(ts).toContain('updateProfile');
    expect(ts).toContain('syncTabBar');
    // 从宠物编辑页返回时计数会变，必须在 onShow 里重取。
    expect(ts).toMatch(/onShow\(\)[\s\S]{0,200}syncTabBar/);
    expect(ts).not.toContain('wx.request');
  });

  it('换头像走 pickAndUploadImages，不在页面里直接调 chooseMedia', () => {
    const ts = read('pages/profile/index.ts');
    expect(ts).toContain('pickAndUploadImages');
    expect(ts).not.toContain('wx.chooseMedia');
  });

  it('昵称长度上限与服务端一致（20 字）', () => {
    expect(NICKNAME_MAX_LENGTH).toBe(20);
    expect(read('pages/profile/index.ts')).toContain('NICKNAME_MAX_LENGTH');
  });

  it('wxss 不出现色值字面量、裸 px、未定义 token', () => {
    const css = read('pages/profile/index.wxss');
    expect(findHexLiterals(css)).toEqual([]);
    expect(findBarePx(css)).toEqual([]);
    expect(findUndefinedVars(css, TOKENS)).toEqual([]);
  });
});
