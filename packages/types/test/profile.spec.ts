import type { PetUpsertDto, ProfileDto } from '../src';

// 同 social.spec.ts：纯类型的断言靠编译，`@ts-expect-error` 是反向断言。

describe('ProfileDto', () => {
  it('带三个聚合计数 —— 个人中心一次请求要能画完', () => {
    const profile: ProfileDto = {
      nickname: '微信用户',
      avatarUrl: null,
      isVerifiedOwner: false,
      petCount: 2,
      followingCount: 3,
      favoriteCount: 5,
    };
    expect(profile.petCount + profile.followingCount + profile.favoriteCount).toBe(10);
  });

  it('昵称占位值「微信用户」是合法值 —— 阶段 1 建号时落的就是它', () => {
    const profile: ProfileDto = {
      nickname: '微信用户',
      avatarUrl: null,
      isVerifiedOwner: false,
      petCount: 0,
      followingCount: 0,
      favoriteCount: 0,
    };
    expect(profile.nickname).toBe('微信用户');
  });

  it('不含 openid / phone 等敏感字段', () => {
    const profile: ProfileDto = {
      nickname: '阿花',
      avatarUrl: 'https://cdn.example.com/a.jpg',
      isVerifiedOwner: true,
      petCount: 1,
      followingCount: 0,
      favoriteCount: 0,
      // @ts-expect-error openid 绝不下发到客户端
      openid: 'ox-123',
    };
    expect(profile.isVerifiedOwner).toBe(true);
  });
});

describe('PetUpsertDto', () => {
  it('创建时必填名字与物种，其余可省', () => {
    const minimal: PetUpsertDto = {
      name: '奶糖',
      species: 'cat',
    };
    expect(minimal.name).toBe('奶糖');
  });

  it('可带全量可选字段', () => {
    const full: PetUpsertDto = {
      name: '布丁',
      species: 'dog',
      breed: '柯基',
      gender: 'female',
      birthDate: '2023-05-01',
      bio: '爱吃红薯',
      personalityTags: ['粘人', '话多'],
      lat: 31.23,
      lng: 121.47,
    };
    expect(full.personalityTags).toEqual(['粘人', '话多']);
  });

  it('缺名字编译不过', () => {
    // @ts-expect-error name 必填
    const bad: PetUpsertDto = { species: 'cat' };
    expect(bad.species).toBe('cat');
  });

  it('物种复用 PetSpecies 白名单', () => {
    const bad: PetUpsertDto = {
      name: '小龙',
      // @ts-expect-error 只允许 dog / cat / other
      species: 'lizard',
    };
    expect(bad.name).toBe('小龙');
  });

  it('不含 id —— 更新的目标由路径参数决定，避免客户端改到别人的宠物', () => {
    const dto: PetUpsertDto = {
      name: '奶糖',
      species: 'cat',
      // @ts-expect-error id 走 PATCH /pets/:id 的路径参数
      id: 'p-1',
    };
    expect(dto.name).toBe('奶糖');
  });
});
