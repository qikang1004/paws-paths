import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  REPORT_REASON_OPTIONS,
  reasonAt,
  ACTION_SHEET_MAX_ITEMS,
} from '../utils/report-view';
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
