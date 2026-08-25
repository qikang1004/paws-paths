import type {
  AuditStatus,
  FollowDto,
  PetSummary,
  PostDto,
  PostImageDto,
  ViewHistoryItemDto,
} from '../src';

// 这些 DTO 是纯类型，运行时没东西可断言。所以这里用 ts-jest 的编译当断言：
// 少一个必填字段、多一个不认识的字段、类型写错，都会让本文件编译失败进而测试失败。
// `@ts-expect-error` 是反向断言 —— 那一行必须报错，不报错反而算失败。

describe('FollowDto', () => {
  const petCard: PetSummary = {
    id: 'p-2',
    name: '奶昔',
    species: 'cat',
    breed: '布偶',
    gender: 'female',
    birthDate: '2024-02-14',
    coverUrl: 'https://cdn.example.com/p2.jpg',
    coverWidth: 800,
    coverHeight: 600,
    personalityTags: ['温柔'],
    distanceMeters: null,
    ownerNickname: '阿喵',
    ownerAvatarUrl: null,
    ownerVerified: true,
  };

  it('是宠物卡的扁平扩展 —— 小程序的卡片组件能原样复用', () => {
    const follow: FollowDto = {
      ...petCard,
      followId: 'f-1',
      followedAt: '2026-08-01T10:00:00.000Z',
    };
    // 关注对象是宠物：id 就是宠物 id
    expect(follow.id).toBe('p-2');
    expect(follow.coverWidth).toBe(800);
  });

  it('PetSummary 的必填字段一个都不能少', () => {
    // @ts-expect-error 缺 coverWidth/coverHeight 等宠物卡字段
    const bad: FollowDto = { id: 'p-2', followId: 'f-1', followedAt: '2026-08-01T10:00:00.000Z' };
    expect(bad.followId).toBe('f-1');
  });

  it('没有 targetUserId 这种字段', () => {
    const follow: FollowDto = {
      ...petCard,
      followId: 'f-1',
      followedAt: '2026-08-01T10:00:00.000Z',
      // @ts-expect-error 关注的是宠物，不存在 targetUserId
      targetUserId: 'u-2',
    };
    expect(follow.followId).toBe('f-1');
  });
});

describe('ViewHistoryItemDto', () => {
  it('可以是宠物也可以是场所', () => {
    const pet: ViewHistoryItemDto = {
      targetType: 'pet',
      targetId: 'p-1',
      title: '奶糖',
      coverUrl: 'https://cdn.example.com/p1.jpg',
      viewedAt: '2026-08-15T09:00:00.000Z',
    };
    const venue: ViewHistoryItemDto = {
      targetType: 'venue',
      targetId: 'gh-abc',
      title: '爱心宠物医院',
      coverUrl: null,
      viewedAt: '2026-08-15T10:00:00.000Z',
    };
    expect([pet.targetType, venue.targetType]).toEqual(['pet', 'venue']);
  });

  it('targetType 只有 pet 和 venue', () => {
    const bad: ViewHistoryItemDto = {
      // @ts-expect-error 本阶段浏览历史只记宠物与场所
      targetType: 'post',
      targetId: 'po-1',
      title: '动态',
      coverUrl: null,
      viewedAt: '2026-08-15T10:00:00.000Z',
    };
    expect(bad.targetId).toBe('po-1');
  });
});

describe('PostImageDto', () => {
  it('宽高必填 —— 瀑布流要靠它算占位高度，缺了会跳版', () => {
    const image: PostImageDto = {
      id: 'pi-1',
      url: 'https://cdn.example.com/pi1.jpg',
      width: 1080,
      height: 1440,
      auditStatus: 'approved',
    };
    expect(image.width / image.height).toBeCloseTo(0.75);
  });

  it('宽高不是可选的', () => {
    // @ts-expect-error 缺 width/height
    const image: PostImageDto = {
      id: 'pi-2',
      url: 'https://cdn.example.com/pi2.jpg',
      auditStatus: 'pending',
    };
    expect(image.id).toBe('pi-2');
  });

  it('图片有独立审核状态 —— 动态过审不代表每张图都过审', () => {
    const statuses: AuditStatus[] = ['pending', 'approved', 'pending_review', 'rejected'];
    const images = statuses.map<PostImageDto>((auditStatus, i) => ({
      id: `pi-${i}`,
      url: `https://cdn.example.com/${i}.jpg`,
      width: 800,
      height: 800,
      auditStatus,
    }));
    expect(images.map((img) => img.auditStatus)).toEqual(statuses);
  });
});

describe('PostDto', () => {
  it('带审核状态与图片列表', () => {
    const post: PostDto = {
      id: 'po-1',
      petId: 'p-1',
      petName: '奶糖',
      content: '今天去公园玩了',
      auditStatus: 'approved',
      rejectReason: null,
      publishedAt: '2026-08-10T08:00:00.000Z',
      images: [
        {
          id: 'pi-1',
          url: 'https://cdn.example.com/pi1.jpg',
          width: 1080,
          height: 1440,
          auditStatus: 'approved',
        },
      ],
    };
    expect(post.images).toHaveLength(1);
    expect(post.auditStatus).toBe('approved');
  });

  it('驳回原因只在 rejected 时有值，但类型上始终存在（可为 null）', () => {
    const rejected: PostDto = {
      id: 'po-5',
      petId: 'p-1',
      petName: '奶糖',
      content: '违规内容',
      auditStatus: 'rejected',
      rejectReason: '包含敏感词',
      publishedAt: '2026-08-11T08:00:00.000Z',
      images: [],
    };
    expect(rejected.rejectReason).toBe('包含敏感词');
  });

  it('auditStatus 复用 AuditStatus，不允许自定义字符串', () => {
    const post: PostDto = {
      id: 'po-9',
      petId: 'p-1',
      petName: '奶糖',
      content: '内容',
      // @ts-expect-error 必须用 AuditStatus 的四个取值
      auditStatus: 'reviewing',
      rejectReason: null,
      publishedAt: '2026-08-11T08:00:00.000Z',
      images: [],
    };
    expect(post.id).toBe('po-9');
  });
});
