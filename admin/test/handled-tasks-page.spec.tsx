import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ERROR_CODES } from '@paws/types';
import { HandledTasksPage } from '../src/pages/HandledTasksPage';
import { auditLog, envelope, handled, stubFetch } from './helpers';

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderPage(onExpired = vi.fn()): { onExpired: ReturnType<typeof vi.fn> } {
  render(<HandledTasksPage onExpired={onExpired} />);
  return { onExpired };
}

const page = (items: unknown[], hasMore = false): string =>
  envelope({ items, hasMore, page: 1 });

describe('已处理工单页', () => {
  it('结论显示成「已撤下」/「已保留」，不是枚举值', async () => {
    stubFetch([page([handled({ result: 'rejected' })])]);
    renderPage();
    expect(await screen.findByText('已撤下')).toBeInTheDocument();
    expect(screen.queryByText('rejected')).toBeNull();
  });

  it('放行的工单显示「已保留」', async () => {
    stubFetch([page([handled({ result: 'approved' })])]);
    renderPage();
    expect(await screen.findByText('已保留')).toBeInTheDocument();
  });

  it('显示复核人、作者与当初判的内容', async () => {
    stubFetch([
      page([handled({ handledByName: '审核员甲', authorNickname: '小红', content: '判过的正文' })]),
    ]);
    renderPage();
    expect(await screen.findByText('审核员甲')).toBeInTheDocument();
    expect(screen.getByText('小红')).toBeInTheDocument();
    expect(screen.getByText('判过的正文')).toBeInTheDocument();
  });

  /** `handled_by` 挂 `ON DELETE SET NULL` —— 账号注销后指针为空，不是缺字段。 */
  it('复核人已注销时显示「已注销」', async () => {
    stubFetch([page([handled({ handledBy: null, handledByName: null })])]);
    renderPage();
    expect(await screen.findByText('已注销')).toBeInTheDocument();
  });

  it('只有 id 没有名字时显示 id', async () => {
    stubFetch([page([handled({ handledBy: 'u-gone', handledByName: null })])]);
    renderPage();
    expect(await screen.findByText('u-gone')).toBeInTheDocument();
  });

  /**
   * 目标被作者删掉后内容为空。**不能留一个空白区** —— 那看起来像加载失败，
   * 而这是正常状态（也正是流水刻意不带原文的理由）。
   */
  it('内容已被删除时给出说明，不留空白', async () => {
    stubFetch([page([handled({ content: '' })])]);
    renderPage();
    expect(await screen.findByText(/内容已不存在/)).toBeInTheDocument();
  });

  /** 这一页没有操作按钮 —— 工单已经判完了，不该有第二次机会改结论。 */
  it('没有放行/撤下按钮', async () => {
    stubFetch([page([handled()])]);
    renderPage();
    await screen.findByText('已撤下');
    expect(screen.queryByRole('button', { name: /保留/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /撤下/ })).toBeNull();
  });

  it('举报人不在页面上（服务端不下发，界面也不该拼出来）', async () => {
    stubFetch([page([handled()])]);
    renderPage();
    await screen.findByText('已撤下');
    expect(screen.queryByText(/举报人/)).toBeNull();
  });

  it('首屏按第一页拉取', async () => {
    const calls = stubFetch([page([])]);
    renderPage();
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(calls[0].url).toBe('/api/moderation/tasks/handled?page=1&pageSize=20');
  });

  it('空列表时说清还没处理过工单', async () => {
    stubFetch([page([])]);
    renderPage();
    expect(await screen.findByText(/还没有处理过任何工单/)).toBeInTheDocument();
  });

  it('点「查看审核历史」打开对话框并按目标拉流水', async () => {
    const calls = stubFetch([
      page([handled({ targetType: 'post', targetId: 'p-42' })]),
      envelope({ items: [auditLog({ targetId: 'p-42' })] }),
    ]);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: '查看审核历史' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await waitFor(() =>
      expect(calls.some((c) => c.url.includes('by-target') && c.url.includes('p-42'))).toBe(true),
    );
  });

  it('令牌失效时通知外壳', async () => {
    stubFetch([envelope(null, ERROR_CODES.UNAUTHORIZED, '登录已过期')], 401);
    const onExpired = vi.fn();
    renderPage(onExpired);
    await waitFor(() => expect(onExpired).toHaveBeenCalled());
  });

  it('UGC 正文当文本显示，不解析成 HTML', async () => {
    stubFetch([page([handled({ content: '<img src=x onerror=alert(1)>' })])]);
    renderPage();
    expect(await screen.findByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(document.querySelector('img[src="x"]')).toBeNull();
  });
});
