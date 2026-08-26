import type { PetSummary } from '../shared/types/index';
import { buildPetOptions, resolvePetId } from '../utils/my-pets-view';

const pet = (over: Partial<PetSummary> = {}): PetSummary => ({
  id: 'p-1',
  name: '大黄',
  species: 'dog',
  breed: '柴犬',
  gender: 'male',
  birthDate: '2023-01-01',
  coverUrl: '',
  coverWidth: 0,
  coverHeight: 0,
  personalityTags: [],
  distanceMeters: null,
  ownerNickname: '我',
  ownerAvatarUrl: null,
  ownerVerified: false,
  isFollowing: false,
  ...over,
});

/**
 * 「选一只自己的宠物」是发布页与「我的动态」共用的一步：
 * `GET /posts` 的 `petId` 必填，没有全局信息流，所以两处都得先有个选中的宠物。
 * 选项与「保留选中项」的规则放在一处，免得两个页面各写一套、行为对不上。
 */
describe('我的宠物选项', () => {
  it('只留下选宠物用得上的 id 与名字', () => {
    const options = buildPetOptions([
      pet({ id: 'p-1', name: '大黄' }),
      pet({ id: 'p-2', name: '二花' }),
    ]);
    expect(options).toEqual([
      { id: 'p-1', name: '大黄' },
      { id: 'p-2', name: '二花' },
    ]);
  });

  it('还在清单里的选中项原样保留 —— 刷新列表不该把人选的宠物换掉', () => {
    const options = buildPetOptions([pet({ id: 'p-1' }), pet({ id: 'p-2' })]);
    expect(resolvePetId(options, 'p-2')).toBe('p-2');
  });

  it('选中项已被删掉、或压根没选过，退回第一只', () => {
    const options = buildPetOptions([pet({ id: 'p-1' }), pet({ id: 'p-2' })]);
    expect(resolvePetId(options, 'p-9')).toBe('p-1');
    expect(resolvePetId(options, '')).toBe('p-1');
  });

  it('一只宠物都没有时回空串 —— 页面据此走「先建一只」的空态而不是发请求', () => {
    expect(buildPetOptions([])).toEqual([]);
    expect(resolvePetId([], 'p-1')).toBe('');
  });
});
