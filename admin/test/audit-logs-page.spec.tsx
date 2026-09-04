import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ERROR_CODES } from '@paws/types';
import { AuditLogsPage } from '../src/pages/AuditLogsPage';
import { auditLog, envelope, stubFetch } from './helpers';

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderPage(onExpired = vi.fn()): { onExpired: ReturnType<typeof vi.fn> } {
  render(<AuditLogsPage onExpired={onExpired} />);
  return { onExpired };
}

function page(items: unknown[], hasMore = false, p = 1): string {
  return envelope({ items, hasMore, page: p });
}

describe('审核流水页', () => {
  it('动作显示成中文文案，不是枚举值', async () => {
    stubFetch([page([auditLog({ action: 'review_reject' })])]);
    renderPage();
    expect(await screen.findByText('复核撤下')).toBeInTheDocument();
    expect(screen.queryByText('review_reject')).toBeNull();
  });

  it('显示操作人、目标 id 与状态变化', async () => {
    stubFetch([page([auditLog({ actorName: 'ops-alice', targetId: 'p-42' })])]);
    renderPage();
    expect(await screen.findByText('ops-alice')).toBeInTheDocument();
    expect(screen.getByText('p-42')).toBeInTheDocument();
    expect(screen.getByText('pending_review → rejected')).toBeInTheDocument();
  });

  /**
   * 三种操作人必须分得开。混成一个「-」会让读流水的人分不清「机器做的」
   * 与「这个人注销了」—— 而合规审查恰恰要问这个。
   */
  it('机审的流水标成系统，不显示空白', async () => {
    stubFetch([page([auditLog({ actorId: null, actorName: null, action: 'auto_reject' })])]);
    renderPage();
    expect(await screen.findByText(/系统（机审）/)).toBeInTheDocument();
  });

  it('操作人已注销时显示「已注销」并带上 id', async () => {
    stubFetch([page([auditLog({ actorId: 'u-gone', actorName: null })])]);
    renderPage();
    expect(await screen.findByText(/已注销（u-gone）/)).toBeInTheDocument();
  });

  it('有名字时显示名字，不显示 id', async () => {
    stubFetch([page([auditLog({ actorId: 'u-mod', actorName: '审核员甲' })])]);
    renderPage();
    expect(await screen.findByText('审核员甲')).toBeInTheDocument();
    expect(screen.queryByText(/已注销/)).toBeNull();
  });

  it('首屏按第一页拉取，页大小与工单页一致', async () => {
    const calls = stubFetch([page([])]);
    renderPage();
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(calls[0].url).toBe('/api/moderation/audit-logs?page=1&pageSize=20');
  });

  it('点「下一页」按第二页重新拉取', async () => {
    const calls = stubFetch([page([auditLog()], true), page([auditLog({ id: 'al-2' })])]);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: '下一页' }));
    await waitFor(() => expect(calls.some((c) => c.url.includes('page=2'))).toBe(true));
  });

  it('没有下一页时按钮禁用', async () => {
    stubFetch([page([auditLog()], false)]);
    renderPage();
    expect(await screen.findByRole('button', { name: '下一页' })).toBeDisabled();
  });

  it('空列表时说清还没有审核动作', async () => {
    stubFetch([page([])]);
    renderPage();
    expect(await screen.findByText(/还没有任何审核动作/)).toBeInTheDocument();
  });

  it('加载失败时给出重试入口', async () => {
    stubFetch([envelope(null, ERROR_CODES.INTERNAL, '服务异常')], 500);
    renderPage();
    expect(await screen.findByText('服务异常')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
  });

  it('令牌失效时通知外壳', async () => {
    stubFetch([envelope(null, ERROR_CODES.UNAUTHORIZED, '登录已过期')], 401);
    const onExpired = vi.fn();
    renderPage(onExpired);
    await waitFor(() => expect(onExpired).toHaveBeenCalled());
  });

  /**
   * 这一页**只读**。流水不可变（服务端仓储接口上压根没有 update / delete），
   * 界面上出现任何改动入口都是错的信号。
   */
  it('没有任何修改或删除按钮', async () => {
    stubFetch([page([auditLog()])]);
    renderPage();
    await screen.findByText('复核撤下');
    for (const name of [/删除/, /修改/, /编辑/, /撤回/]) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
  });

  /** 目标 id 是攻击者可控的字符串（它来自被举报的内容）—— 不能当 HTML 解析。 */
  it('目标 id 里的 HTML 当文本显示', async () => {
    stubFetch([page([auditLog({ targetId: '<img src=x onerror=alert(1)>' })])]);
    renderPage();
    expect(await screen.findByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(document.querySelector('img[src="x"]')).toBeNull();
  });
});

describe('流水页的筛选', () => {
  it('可以按动作筛', async () => {
    const calls = stubFetch([page([auditLog()]), page([auditLog()])]);
    renderPage();
    await screen.findByText('复核撤下');
    await userEvent.selectOptions(screen.getByLabelText('动作'), 'auto_reject');
    await waitFor(() => expect(calls.some((c) => c.url.includes('action=auto_reject'))).toBe(true));
  });

  /** 流水没有 reason 那一列 —— 那个下拉不该出现。 */
  it('流水页没有「举报原因」筛选', async () => {
    stubFetch([page([auditLog()])]);
    renderPage();
    await screen.findByText('复核撤下');
    expect(screen.queryByLabelText('举报原因')).toBeNull();
  });
});
