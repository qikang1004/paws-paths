import { API_BASE_URL } from '../config';
import { AUDIT_STATUSES, type PostDto } from '../shared/types/index';
import { resolveImageUrl } from '../utils/image-url';
import { buildAuditBadge, buildPostView } from '../utils/post-view';

const BASE = 'https://api.example.com';
const NOW = new Date('2026-08-25T12:00:00Z').getTime();

const post = (over: Partial<PostDto> = {}): PostDto => ({
  id: 'po-1',
  petId: 'p-1',
  petName: '大黄',
  content: '今天去了公园',
  auditStatus: 'approved',
  rejectReason: null,
  publishedAt: '2026-08-25T11:30:00Z',
  images: [],
  ...over,
});

/**
 * 角标与图片地址的口径。这两件事都必须只有一份实现：
 *
 * - 角标：`showBadge` 从 `isPubliclyVisible` 派生，文案查表。页面里手写
 *   `status === 'approved'` 就是 spec §4.5 要禁的那种散落字面量 —— 服务端有
 *   `audit-literal-guard` 拦，小程序侧靠这层收口。
 * - 图片地址：本阶段服务端返的是相对路径 `/uploads/<key>`，阶段 4 换对象存储后
 *   会变成绝对 URL，所以从现在起两种形态都要能认。
 */
describe('buildAuditBadge', () => {
  it('approved 不显示角标', () => {
    const badge = buildAuditBadge('approved', null);
    expect(badge.visible).toBe(false);
    expect(badge.text).toBe('');
  });

  it('pending 显示「审核中」', () => {
    const badge = buildAuditBadge('pending', null);
    expect(badge.visible).toBe(true);
    expect(badge.text).toBe('审核中');
    expect(badge.tone).toBe('pending');
    expect(badge.showReason).toBe(false);
  });

  it('pending_review 也是「审核中」—— 被举报撤下同样对他人不可见', () => {
    const badge = buildAuditBadge('pending_review', null);
    expect(badge.visible).toBe(true);
    expect(badge.text).toBe('审核中');
    expect(badge.tone).toBe('pending');
  });

  it('rejected 显示「未通过」加驳回原因', () => {
    const badge = buildAuditBadge('rejected', '包含疑似违规信息');
    expect(badge.visible).toBe(true);
    expect(badge.text).toBe('未通过');
    expect(badge.tone).toBe('rejected');
    expect(badge.showReason).toBe(true);
    expect(badge.reasonText).toBe('包含疑似违规信息');
  });

  it('rejected 但服务端没给原因时不渲染空原因行', () => {
    const badge = buildAuditBadge('rejected', null);
    expect(badge.visible).toBe(true);
    expect(badge.showReason).toBe(false);
    expect(badge.reasonText).toBe('');
  });

  it('原因只有空白字符时同样不渲染', () => {
    expect(buildAuditBadge('rejected', '   ').showReason).toBe(false);
  });

  // 将来往状态机加一种状态时，这条会红 —— 逼着人回来补文案，
  // 而不是让页面渲染出一个 undefined 角标。
  it('每个状态都在文案表里有定义（新状态不会漏）', () => {
    for (const status of AUDIT_STATUSES) {
      const badge = buildAuditBadge(status, null);
      // 显示就必须有文案，不显示就必须是空串 —— 两边都卡住，
      // 新状态既不会渲染出 undefined，也不会悄悄带着文案却不显示。
      expect([status, badge.visible ? badge.text !== '' : badge.text === '']).toEqual([status, true]);
    }
  });

  it('可见性与状态机一致：只有 approved 不显示角标', () => {
    const hidden = AUDIT_STATUSES.filter((s) => !buildAuditBadge(s, null).visible);
    expect(hidden).toEqual(['approved']);
  });
});

describe('buildPostView', () => {
  it('approved 的动态没有角标，正文与宠物名原样带过', () => {
    const view = buildPostView(post(), { baseUrl: BASE, now: NOW });
    expect(view.badge.visible).toBe(false);
    expect(view.petName).toBe('大黄');
    expect(view.content).toBe('今天去了公园');
    expect(view.auditStatus).toBe('approved');
  });

  it('pending 的动态带「审核中」角标', () => {
    const view = buildPostView(post({ auditStatus: 'pending' }), { baseUrl: BASE, now: NOW });
    expect(view.badge.visible).toBe(true);
    expect(view.badge.text).toBe('审核中');
  });

  it('rejected 的动态带「未通过」与原因', () => {
    const view = buildPostView(
      post({ auditStatus: 'rejected', rejectReason: '内容包含疑似违规信息' }),
      { baseUrl: BASE, now: NOW },
    );
    expect(view.badge.text).toBe('未通过');
    expect(view.badge.showReason).toBe(true);
    expect(view.badge.reasonText).toBe('内容包含疑似违规信息');
  });

  it('图片地址补全，宽高原样留给瀑布流算占位高度', () => {
    const view = buildPostView(
      post({
        images: [
          { id: 'pi-1', url: '/uploads/u-1/a.jpg', width: 600, height: 800, auditStatus: 'approved' },
          {
            id: 'pi-2',
            url: 'https://cdn.example.com/b.jpg',
            width: 800,
            height: 600,
            auditStatus: 'approved',
          },
        ],
      }),
      { baseUrl: BASE, now: NOW },
    );
    expect(view.images).toEqual([
      { id: 'pi-1', url: `${BASE}/uploads/u-1/a.jpg`, width: 600, height: 800 },
      { id: 'pi-2', url: 'https://cdn.example.com/b.jpg', width: 800, height: 600 },
    ]);
    expect(view.hasImages).toBe(true);
  });

  // 服务端已经把他人看不到的图筛掉了（`toDto` 里按 isVisibleTo 过滤），
  // 客户端不再判一次：两处判定迟早分叉，而服务端那份才是安全边界。
  it('没有图片时 hasImages 为 false，images 是空数组', () => {
    const view = buildPostView(post(), { baseUrl: BASE, now: NOW });
    expect(view.hasImages).toBe(false);
    expect(view.images).toEqual([]);
  });

  it('时间显示成相对文案', () => {
    const view = buildPostView(post({ publishedAt: '2026-08-25T11:30:00Z' }), {
      baseUrl: BASE,
      now: NOW,
    });
    expect(view.timeText).toBe('30分钟前');
  });

  it('不传选项时用接口 base 补图片地址', () => {
    const view = buildPostView(
      post({
        images: [
          { id: 'pi-1', url: '/uploads/u-1/a.jpg', width: 1, height: 1, auditStatus: 'approved' },
        ],
      }),
    );
    expect(view.images[0].url).toBe(`${API_BASE_URL}/uploads/u-1/a.jpg`);
  });
});

describe('resolveImageUrl', () => {
  it('相对路径拼在接口 base 上（本阶段服务端返的就是这种）', () => {
    expect(resolveImageUrl('/uploads/u-1/a.jpg', BASE)).toBe(`${BASE}/uploads/u-1/a.jpg`);
  });

  it('绝对 URL 原样返回（阶段 4 换对象存储后是这种）', () => {
    expect(resolveImageUrl('https://cdn.example.com/a.jpg', BASE)).toBe(
      'https://cdn.example.com/a.jpg',
    );
    expect(resolveImageUrl('http://cdn.example.com/a.jpg', BASE)).toBe(
      'http://cdn.example.com/a.jpg',
    );
  });

  it('本地临时文件原样返回 —— 发布页要在上传前先预览', () => {
    expect(resolveImageUrl('wxfile://tmp/1.jpg', BASE)).toBe('wxfile://tmp/1.jpg');
    expect(resolveImageUrl('http://tmp/x.jpg'.replace('http://', 'wxfile://'), BASE)).toContain(
      'wxfile://',
    );
  });

  it('空串与 null 返回空串，让 wxml 整个 image 不渲染', () => {
    expect(resolveImageUrl('', BASE)).toBe('');
    expect(resolveImageUrl(null, BASE)).toBe('');
  });

  it('base 末尾有斜杠时不拼出双斜杠', () => {
    expect(resolveImageUrl('/uploads/a.jpg', 'https://x.example.com/')).toBe(
      'https://x.example.com/uploads/a.jpg',
    );
  });

  it('默认用 config 里的接口 base', () => {
    expect(resolveImageUrl('/uploads/a.jpg')).toBe(`${API_BASE_URL}/uploads/a.jpg`);
  });
});
