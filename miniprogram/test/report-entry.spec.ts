import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  REPORT_REASON_OPTIONS,
  reasonAt,
  ACTION_SHEET_MAX_ITEMS,
} from '../utils/report-view';
import { dropImageById, type PostView } from '../utils/post-view';
import { REPORT_REASONS, REPORT_REASON_LABELS } from '../shared/types/index';

const ROOT = resolve(__dirname, '..');
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');
const DIR = 'packages/profile/pages/feed';

/**
 * 举报入口（阶段 3 Task 12）。
 *
 * 原因是**固定白名单的单选**，不做自由文本 —— 自由文本本身是一条新的 UGC 入口，
 * 又要过一遍内容安全，本阶段不引入。
 *
 * 举报成功后那条内容会迁到 `pending_review`，**对举报人自己也不可见了**，
 * 所以列表上那一行必须当场消失（`dropById`）—— 而不是重拉那一页：
 * 服务端那一页已经错位了（少了一条），重拉会跳位置还会带进下一页的内容。
 */
describe('举报原因选项', () => {
  it('逐条来自服务端白名单，顺序一致 —— 客户端不自己排一套', () => {
    expect(REPORT_REASON_OPTIONS.map((o) => o.reason)).toEqual([...REPORT_REASONS]);
  });

  it('文案取 REPORT_REASON_LABELS，不在客户端硬编码第二份', () => {
    for (const option of REPORT_REASON_OPTIONS) {
      expect(option.label).toBe(REPORT_REASON_LABELS[option.reason]);
      expect(option.label.length).toBeGreaterThan(0);
    }
  });

  it('项数不超过 wx.showActionSheet 的 6 项上限', () => {
    // 白名单恰好 6 项。再加一种原因就装不进 action sheet 了，
    // 这条断言会在那一刻变红，提醒改成自定义选择器而不是静默截断。
    expect(ACTION_SHEET_MAX_ITEMS).toBe(6);
    expect(REPORT_REASON_OPTIONS.length).toBeLessThanOrEqual(ACTION_SHEET_MAX_ITEMS);
  });

  it('reasonAt 按下标取原因，越界回 null', () => {
    expect(reasonAt(0)).toBe(REPORT_REASONS[0]);
    expect(reasonAt(REPORT_REASONS.length - 1)).toBe(REPORT_REASONS[REPORT_REASONS.length - 1]);
    // 越界不该猜一个默认原因：报错的原因比报错本身更难查。
    expect(reasonAt(-1)).toBeNull();
    expect(reasonAt(REPORT_REASONS.length)).toBeNull();
    expect(reasonAt(1.5)).toBeNull();
  });
});

describe('feed 页的举报入口', () => {
  it('wxml 每条动态上有举报按钮，带 data-id', () => {
    const wxml = read(`${DIR}/index.wxml`);
    expect(wxml).toContain('bindtap="onReport"');
    expect(wxml).toContain('data-id="{{item.id}}"');
  });

  it('页面 ts 先选原因、再确认、才调 reportPost', () => {
    const ts = read(`${DIR}/index.ts`);
    expect(ts).toContain('onReport');
    expect(ts).toContain('reportPost');
    // 单选原因走 action sheet；确认走 showModal（举报会让内容对所有人消失）。
    expect(ts).toContain('showActionSheet');
    expect(ts).toContain('showModal');
    expect(ts).toContain('REPORT_REASON_OPTIONS');
    expect(ts).toContain('reasonAt');
    expect(ts).not.toContain('wx.request');
  });

  it('成功后把那条从列表里原地删掉，不重拉那一页', () => {
    const ts = read(`${DIR}/index.ts`);
    expect(ts).toContain('dropById');
    // 举报那个方法体里不许出现 loadPage —— 那就是重拉。切到下一个方法为止，
    // 不能切到文件尾：`loadPage` 自己的定义就在后面。
    const body = ts.slice(ts.indexOf('async submitReport'), ts.indexOf('async init'));
    expect(body).toContain('dropById');
    expect(body).not.toContain('loadPage');
  });

  it('提示语说的是「已提交复核」，不是「已删除」', () => {
    const ts = read(`${DIR}/index.ts`);
    // 内容并没有被删掉，只是撤下等运营复核 —— 说「已删除」是在向用户撒谎，
    // 而复核通过后它还会回来。断言的是**真的 toast 调用**，不是「源码里没有
    // 已删除这三个字」：后者会被解释这件事的注释撞红（本轮第四次同款陷阱）。
    expect(ts).toMatch(/showToast\(\{\s*title:\s*'已提交复核'/);
    expect(ts).not.toMatch(/showToast\(\{\s*title:\s*'已删除'/);
  });

  it('进行中标志挡连点，且在 finally 里复位', () => {
    const ts = read(`${DIR}/index.ts`);
    expect(ts).toContain('reportingId');
    expect(ts).toMatch(/if\s*\(this\.data\.reportingId\)\s*return/);
    expect(ts).toMatch(/finally\s*\{\s*(?:\/\/[^\n]*\n\s*)?this\.setData\(\{\s*reportingId:\s*''/);
  });
});

/**
 * 单张图片的举报入口。
 *
 * 与举报整条动态是**两件不同的事**：图片与动态的审核状态独立（`post_images`
 * 有自己的 `audit_status`），撤下一张图不影响文字。所以：
 *   · 走的是 `reportImage`（`targetType: 'post_image'`），传图片自己的 id；
 *   · 成功后摘掉的是**那一张图**，不是整条动态 —— 动态还在，只是少一张图。
 *
 * 交互用长按而不是再加一个按钮：九宫格里每张图都配一个「举报」会把卡片挤满，
 * 而长按是相册类界面里已有的惯例（点开预览、长按出操作）。
 */
describe('feed 页的图片举报入口', () => {
  it('wxml 图片上挂长按，带图片自己的 id', () => {
    const wxml = read(`${DIR}/index.wxml`);
    expect(wxml).toContain('bindlongpress="onReportImage"');
    // 点击仍是预览 —— 两个手势各管一件事，不能互相顶替。
    expect(wxml).toContain('bindtap="onImageTap"');
    // 长按要知道是哪一张图（image.id），也要知道它属于哪条动态（摘图时要定位）。
    expect(wxml).toContain('data-image="{{image.id}}"');
  });

  it('页面 ts 调 reportImage，不是 reportPost', () => {
    const ts = read(`${DIR}/index.ts`);
    expect(ts).toContain('reportImage');
    expect(ts).toContain('onReportImage');
  });

  it('成功后只摘掉那一张图，动态本身留在列表里', () => {
    const ts = read(`${DIR}/index.ts`);
    const body = ts.slice(ts.indexOf('async submitImageReport'), ts.indexOf('async init'));
    // 断言**调用形状**，不是「源码里没有 dropById 这几个字」——
    // 后者从一开始就不可能通过：dropImageById 自己就把 dropById 当子串包含，
    // 而解释这件事的注释里也写了那个名字（本轮第五次踩这个坑）。
    expect(body).toMatch(/dropImageById\(this\.data\.posts,\s*postId,\s*imageId\)/);
    // 摘整条动态的那个调用形状不许出现在这里。
    expect(body).not.toMatch(/[^I]dropById\(this\.data\.posts/);
  });

  it('两个确认框的文案不同 —— 长按一张图不该弹「举报这条动态」', () => {
    const ts = read(`${DIR}/index.ts`);
    // 两个 confirm 函数共用一个 showModal 实现（文案由调用方传），所以断言的是
    // **各自函数体里的文案**，而不是「showModal 附近有这几个字」。
    const imageConfirm = ts.slice(
      ts.indexOf('function confirmImageReport'),
      ts.indexOf('function confirm('),
    );
    expect(imageConfirm).toContain('举报这张图片？');
    // 说清只有这张图受影响 —— 用户长按一张图时最担心的正是「整条会不会没」。
    expect(imageConfirm).toMatch(/动态的文字和其他图片不受影响/);

    const postConfirm = ts.slice(
      ts.indexOf('function confirmReport'),
      ts.indexOf('function confirmImageReport'),
    );
    expect(postConfirm).toContain('举报这条动态？');
    // 两个文案确实不同（不是复制粘贴忘了改）。
    expect(imageConfirm).not.toContain('举报这条动态？');
  });

  it('dropImageById 从动态里摘掉一张图并重算 hasImages', () => {
    const post = {
      id: 'po-1',
      hasImages: true,
      images: [
        { id: 'pi-1', url: 'a', width: 1, height: 1 },
        { id: 'pi-2', url: 'b', width: 1, height: 1 },
      ],
    } as PostView;
    const once = dropImageById([post], 'po-1', 'pi-1');
    expect(once[0].images.map((i) => i.id)).toEqual(['pi-2']);
    expect(once[0].hasImages).toBe(true);

    // 摘掉最后一张：hasImages 必须翻成 false，否则 wxml 会渲染一个空的图片容器。
    const empty = dropImageById(once, 'po-1', 'pi-2');
    expect(empty[0].images).toEqual([]);
    expect(empty[0].hasImages).toBe(false);
    // 动态本身还在 —— 举报一张图不影响文字。
    expect(empty[0].id).toBe('po-1');
  });

  it('dropImageById 不碰别的动态，也不改原数组', () => {
    const posts = [
      { id: 'po-1', hasImages: true, images: [{ id: 'pi-1', url: 'a', width: 1, height: 1 }] },
      { id: 'po-2', hasImages: true, images: [{ id: 'pi-9', url: 'b', width: 1, height: 1 }] },
    ] as PostView[];
    const next = dropImageById(posts, 'po-1', 'pi-1');
    expect(next[1].images.map((i) => i.id)).toEqual(['pi-9']);
    // setData 认引用：原地改再 setData 同一个引用，渲染层可能不更新。
    expect(next).not.toBe(posts);
    expect(next[0]).not.toBe(posts[0]);
    expect(posts[0].images).toHaveLength(1);
  });

  it('图片 id 对不上时原样返回 —— 不静默清空整条动态的图', () => {
    const posts = [
      { id: 'po-1', hasImages: true, images: [{ id: 'pi-1', url: 'a', width: 1, height: 1 }] },
    ] as PostView[];
    expect(dropImageById(posts, 'po-1', 'pi-zzz')[0].images).toHaveLength(1);
    expect(dropImageById(posts, 'po-zzz', 'pi-1')[0].images).toHaveLength(1);
  });
});
