import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ERROR_CODES } from '@paws/types';
import { App } from '../src/App';
import { loadSession, saveSession } from '../src/api/session';
import { auditLog, envelope, stubFetch, task } from './helpers';

afterEach(() => {
  vi.unstubAllGlobals();
});

const page = (items: unknown[]): string => envelope({ items, hasMore: false, page: 1 });

describe('外壳与视图切换', () => {
  it('没有会话时显示登录页', () => {
    render(<App />);
    expect(screen.getByLabelText('用户名')).toBeInTheDocument();
  });

  /**
   * 会话从 localStorage 初始化 —— 刷新页面不该掉登录态。
   *
   * 按 role 找标题而不是找文本：「待复核工单」同时是导航按钮的文字，
   * `findByText` 会撞上两个节点。
   */
  it('有会话时直接进工单页', async () => {
    saveSession({ token: 'tok', username: 'ops', role: 'moderator' });
    stubFetch([page([task()])]);
    render(<App />);
    expect(await screen.findByRole('heading', { name: '待复核工单' })).toBeInTheDocument();
  });

  it('点「审核流水」切到流水页', async () => {
    saveSession({ token: 'tok', username: 'ops', role: 'moderator' });
    stubFetch([page([task()]), page([auditLog()])]);
    render(<App />);
    await screen.findByRole('heading', { name: '待复核工单' });
    await userEvent.click(screen.getByRole('button', { name: '审核流水' }));
    expect(await screen.findByRole('heading', { name: '审核流水' })).toBeInTheDocument();
  });

  /**
   * 两个视图都对 moderator 开放 —— 服务端那两条端点挂的是同一个 `ModeratorGuard`。
   * 按角色藏菜单会让人以为自己没权限，而实际上点进去能用。
   */
  it('moderator 也看得到流水入口，不只 admin', () => {
    saveSession({ token: 'tok', username: 'ops', role: 'moderator' });
    stubFetch([page([])]);
    render(<App />);
    expect(screen.getByRole('button', { name: '审核流水' })).toBeInTheDocument();
  });

  it('显示当前用户名与角色文案', () => {
    saveSession({ token: 'tok', username: 'ops-alice', role: 'admin' });
    stubFetch([page([])]);
    render(<App />);
    expect(screen.getByText('ops-alice')).toBeInTheDocument();
    expect(screen.getByText('管理员')).toBeInTheDocument();
  });

  it('退出后清掉会话并回到登录页', async () => {
    saveSession({ token: 'tok', username: 'ops', role: 'moderator' });
    stubFetch([page([])]);
    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: '退出' }));
    expect(loadSession()).toBeNull();
    expect(screen.getByLabelText('用户名')).toBeInTheDocument();
  });

  /**
   * 401 之后要回到登录页。`client.ts` 已经清了 localStorage，但内存里的 session
   * 还在 —— 不同步的话界面会停在当前页反复失败。
   */
  it('令牌失效时自动回到登录页', async () => {
    saveSession({ token: 'tok', username: 'ops', role: 'moderator' });
    stubFetch([envelope(null, ERROR_CODES.UNAUTHORIZED, '登录已过期')], 401);
    render(<App />);
    await waitFor(() => expect(screen.getByLabelText('用户名')).toBeInTheDocument());
  });

  it('登录成功后进工单页', async () => {
    stubFetch([
      envelope({ token: 'tok-new', userId: 'u-1', role: 'moderator' }),
      page([task()]),
    ]);
    render(<App />);
    await userEvent.type(screen.getByLabelText('用户名'), 'ops');
    await userEvent.type(screen.getByLabelText('密码'), 'a-long-enough-password');
    await userEvent.click(screen.getByRole('button', { name: '登录' }));
    expect(await screen.findByRole('heading', { name: '待复核工单' })).toBeInTheDocument();
  });
});
