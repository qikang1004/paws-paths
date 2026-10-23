import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { findBarePx, findHexLiterals, findUndefinedVars } from '../tools/style-guard';
import {
  GENDER_OPTIONS,
  PET_BIO_MAX_LENGTH,
  PET_NAME_MAX_LENGTH,
  PET_TAGS_MAX_COUNT,
  PET_TAG_MAX_LENGTH,
  SPECIES_OPTIONS,
  buildPhotoTiles,
  emptyPetForm,
  formFromDetail,
  parseTags,
  toPetUpsert,
  validatePetForm,
} from '../packages/profile/pages/pet-edit/pet-edit-model';
import type { PetDetail } from '../shared/types/index';

const ROOT = resolve(__dirname, '..');
const TOKENS = readFileSync(join(ROOT, 'styles/tokens.wxss'), 'utf8');
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');
const BASE = 'https://api.example.com';

const detail = (over: Partial<PetDetail> = {}): PetDetail => ({
  id: 'p-1',
  name: '大黄',
  species: 'dog',
  breed: '柴犬',
  gender: 'male',
  birthDate: '2024-03-01',
  bio: '爱吃红薯',
  personalityTags: ['粘人', '话多'],
  distanceMeters: null,
  owner: { nickname: '小王', avatarUrl: null, ownerVerified: false },
  photos: [
    { id: 'ph-1', url: '/uploads/u-1/a.jpg', width: 1200, height: 900, auditStatus: 'approved' },
    { id: 'ph-2', url: 'https://picsum.photos/id/2/600/400', width: 600, height: 400, auditStatus: 'approved' },
  ],
  isFollowing: false,
  isFavorite: false,
  // 编辑页只会打开自己的宠物 —— 这个夹具因此恒为 true。
  isOwn: true,
  ...over,
});

/**
 * 表单的校验口径必须与服务端逐条对齐：这里放过去的东西服务端会 422，
 * 而 422 的文案对用户没有指导性（它说的是字段名）。
 */
describe('validatePetForm', () => {
  it('名字与物种是必填', () => {
    expect(validatePetForm({ ...emptyPetForm(), name: '  ' }).message).toBe('给它起个名字吧');
    expect(validatePetForm({ ...emptyPetForm(), name: '大黄' }).ok).toBe(true);
  });

  it('名字按码点数卡上限（一个 emoji 算一字）', () => {
    const form = { ...emptyPetForm(), name: '🐶'.repeat(PET_NAME_MAX_LENGTH + 1) };
    expect(validatePetForm(form).ok).toBe(false);
    expect(validatePetForm({ ...emptyPetForm(), name: '🐶'.repeat(PET_NAME_MAX_LENGTH) }).ok).toBe(
      true,
    );
  });

  it('简介超长、标签超数、单个标签超长都拦下来', () => {
    const base = { ...emptyPetForm(), name: '大黄' };
    expect(validatePetForm({ ...base, bio: '汪'.repeat(PET_BIO_MAX_LENGTH + 1) }).ok).toBe(false);
    expect(
      validatePetForm({
        ...base,
        personalityTags: Array.from({ length: PET_TAGS_MAX_COUNT + 1 }, (_, i) => `t${i}`),
      }).ok,
    ).toBe(false);
    expect(
      validatePetForm({ ...base, personalityTags: ['好'.repeat(PET_TAG_MAX_LENGTH + 1)] }).ok,
    ).toBe(false);
  });

  it('生日可以不填，填了必须是 YYYY-MM-DD 的真实日期', () => {
    const base = { ...emptyPetForm(), name: '大黄' };
    expect(validatePetForm({ ...base, birthDate: '' }).ok).toBe(true);
    expect(validatePetForm({ ...base, birthDate: '2024-03-01' }).ok).toBe(true);
    expect(validatePetForm({ ...base, birthDate: '2024-02-31' }).ok).toBe(false);
    expect(validatePetForm({ ...base, birthDate: '2024/03/01' }).ok).toBe(false);
  });
});

describe('parseTags', () => {
  it('中英文逗号与空格都当分隔符，去空白去重', () => {
    expect(parseTags('粘人, 话多，粘人  贪吃')).toEqual(['粘人', '话多', '贪吃']);
  });

  it('全是分隔符时得到空数组，而不是一串空标签', () => {
    expect(parseTags(' , ，  ')).toEqual([]);
  });
});

describe('formFromDetail / toPetUpsert', () => {
  it('把详情摊回表单，标签拼成一行文本供输入框编辑', () => {
    const form = formFromDetail(detail());
    expect(form).toEqual({
      name: '大黄',
      species: 'dog',
      gender: 'male',
      breed: '柴犬',
      birthDate: '2024-03-01',
      bio: '爱吃红薯',
      personalityTags: ['粘人', '话多'],
    });
  });

  it('提交体裁掉首尾空白，生日空串不发（服务端会当格式错）', () => {
    const dto = toPetUpsert({ ...emptyPetForm(), name: ' 大黄 ', breed: ' 柴犬 ' });
    expect(dto).toEqual({
      name: '大黄',
      species: 'dog',
      gender: 'unknown',
      breed: '柴犬',
      bio: '',
      personalityTags: [],
    });
    expect('birthDate' in dto).toBe(false);
  });

  it('填了生日就带上', () => {
    expect(toPetUpsert({ ...emptyPetForm(), name: '大黄', birthDate: '2024-03-01' })).toMatchObject({
      birthDate: '2024-03-01',
    });
  });
});

describe('SPECIES_OPTIONS / GENDER_OPTIONS', () => {
  it('物种没有「全部」——建号必须选一个具体物种', () => {
    expect(SPECIES_OPTIONS.map((o) => o.value)).toEqual(['dog', 'cat', 'other']);
  });

  it('性别三档，默认那档是「不确定」', () => {
    expect(GENDER_OPTIONS.map((o) => o.value)).toEqual(['unknown', 'male', 'female']);
    expect(emptyPetForm().gender).toBe('unknown');
  });
});

describe('buildPhotoTiles', () => {
  it('相册地址补全，封面是第一张（服务端按 sort_order 给）', () => {
    const tiles = buildPhotoTiles(detail().photos, BASE);
    expect(tiles.map((t) => t.url)).toEqual([
      `${BASE}/uploads/u-1/a.jpg`,
      'https://picsum.photos/id/2/600/400',
    ]);
    expect(tiles[0].isCover).toBe(true);
    expect(tiles[1].isCover).toBe(false);
    expect(tiles[0].id).toBe('ph-1');
  });

  it('待审 / 未通过的照片带角标文案，过审的不带（主人在编辑页看得到自己的待审照片）', () => {
    const base = detail().photos[0];
    const tiles = buildPhotoTiles(
      [
        { ...base, id: 'ok', auditStatus: 'approved' },
        { ...base, id: 'wait', auditStatus: 'pending' },
        { ...base, id: 'review', auditStatus: 'pending_review' },
        { ...base, id: 'no', auditStatus: 'rejected' },
      ],
      BASE,
    );
    expect(tiles.map((t) => t.badgeText)).toEqual(['', '审核中', '审核中', '未通过']);
  });
});

describe('宠物编辑页配置与结构', () => {
  it('json 声明表单要用的组件', () => {
    const json = JSON.parse(read('packages/profile/pages/pet-edit/index.json')) as {
      navigationBarTitleText?: string;
      usingComponents?: Record<string, string>;
    };
    expect(json.navigationBarTitleText).toBe('宠物资料');
    const used = json.usingComponents ?? {};
    expect(used['sq-button']).toBe('/components/sq-button/index');
    expect(used['media-picker']).toBe('/components/media-picker/index');
  });

  it('wxml 有各字段输入、物种/性别选择、生日 picker 与保存删除', () => {
    const wxml = read('packages/profile/pages/pet-edit/index.wxml');
    expect(wxml).toContain('bindinput="onNameInput"');
    expect(wxml).toContain('bindinput="onBreedInput"');
    expect(wxml).toContain('bindinput="onBioInput"');
    expect(wxml).toContain('bindinput="onTagsInput"');
    expect(wxml).toContain('bindtap="onSpeciesTap"');
    expect(wxml).toContain('bindtap="onGenderTap"');
    expect(wxml).toContain('mode="date"');
    expect(wxml).toContain('bindchange="onBirthDateChange"');
    expect(wxml).toContain('bind:tap="onSave"');
    expect(wxml).toContain('bind:tap="onDelete"');
  });

  it('照片区：已有照片可删，新增走 media-picker 的 pick 事件', () => {
    const wxml = read('packages/profile/pages/pet-edit/index.wxml');
    expect(wxml).toContain('<media-picker');
    expect(wxml).toContain('bind:pick="onPickPhotos"');
    expect(wxml).toContain('bind:remove="onRemovePhoto"');
  });

  it('页面 ts 经 api 层读写，新建与编辑共用一套表单', () => {
    const ts = read('packages/profile/pages/pet-edit/index.ts');
    expect(ts).toContain('createPet');
    expect(ts).toContain('updatePet');
    expect(ts).toContain('deletePet');
    expect(ts).toContain('addPetPhoto');
    expect(ts).toContain('removePetPhoto');
    expect(ts).toContain('fetchPetDetail');
    expect(ts).not.toContain('wx.request');
  });

  it('照片上传走 pickAndUploadImages（真实宽高原样传给 addPetPhoto）', () => {
    const ts = read('packages/profile/pages/pet-edit/index.ts');
    expect(ts).toContain('pickAndUploadImages');
    expect(ts).not.toContain('wx.chooseMedia');
    // 宽高来自上传回执，不是页面估的。
    expect(ts).toMatch(/width: image\.width/);
    expect(ts).toMatch(/height: image\.height/);
  });

  it('建号时带上定位（有精确坐标才带），且只经 locationStore', () => {
    const ts = read('packages/profile/pages/pet-edit/index.ts');
    expect(ts).toContain('locationStore');
    expect(ts).not.toContain('wx.getLocation');
  });

  it('删除前二次确认', () => {
    expect(read('packages/profile/pages/pet-edit/index.ts')).toContain('wx.showModal');
  });

  it('wxss 不出现色值字面量、裸 px、未定义 token', () => {
    const css = read('packages/profile/pages/pet-edit/index.wxss');
    expect(findHexLiterals(css)).toEqual([]);
    expect(findBarePx(css)).toEqual([]);
    expect(findUndefinedVars(css, TOKENS)).toEqual([]);
  });
});
