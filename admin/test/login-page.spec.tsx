import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ERROR_CODES } from '@paws/types';
import { LoginPage } from '../src/pages/LoginPage';
import { loadSession } from '../src/api/session';
import { bodyOf, envelope, stubFetch } from './helpers';

afterEach(() => {
  vi.unstubAllGlobals();
});

async function submit(username = 'ops-alice', password = 'a-very-long-password'): Promise<void> {
  await userEvent.type(screen.getByLabelText('用户名'), username);
  await userEvent.type(screen.getByLabelText('密码'), password);
  await userEvent.click(screen.getByRole('button', { name: '登录' }));
}

describe('登录页', () => {
  it('成功后把会话存下来', async () => {
    stubFetch([envelope({ token: 'tok-1', userId: 'u-1', role: 'moderator' })]);
    render(<LoginPage onLoggedIn={() => undefined} />);
    await submit();
    await waitFor(() => {
      expect(loadSession()).toEqual({ token: 'tok-1', username: 'ops-alice', role: 'moderator' });
    });
  });

  it('成功后回调带上会话', async () => {
    stubFetch([envelope({ token: 'tok-1', userId: 'u-1', role: 'admin' })]);
    const onLoggedIn = vi.fn();
    render(<LoginPage onLoggedIn={onLoggedIn} />);
    await submit();
    await waitFor(() => {
      expect(onLoggedIn).toHaveBeenCalledWith({
        token: 'tok-1',
        username: 'ops-alice',
        role: 'admin',
      });
    });
  });

  it('用户名两端的空白会被去掉', async () => {
    const calls = stubFetch([envelope({ token: 't', userId: 'u', role: 'admin' })]);
    render(<LoginPage onLoggedIn={() => undefined} />);
    await submit('  ops-alice  ');
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(bodyOf(calls[0]).username).toBe('ops-alice');
  });

  /**
   * **失败文案必须原样用服务端那句。** 服务端刻意让「用户名不存在」与「密码错误」
   * 收敛成同一句（防枚举），前端按码分支写自己的文案就会把那道收敛拆开。
   */
  it('401 时显示服务端给的那句话', async () => {
    stubFetch([envelope(null, ERROR_CODES.UNAUTHORIZED, '用户名或密码不正确')], 401);
    render(<LoginPage onLoggedIn={() => undefined} />);
    await submit();
    expect(await screen.findByRole('alert')).toHaveTextContent('用户名或密码不正确');
  });

  it('登录失败后不写会话', async () => {
    stubFetch([envelope(null, ERROR_CODES.UNAUTHORIZED, '用户名或密码不正确')], 401);
    render(<LoginPage onLoggedIn={() => undefined} />);
    await submit();
    await screen.findByRole('alert');
    expect(loadSession()).toBeNull();
  });

  /** 429 补一句限流量级 —— 否则运营会以为服务挂了，继续重试把配额烧光。 */
  it('429 时补充说明限流的量级', async () => {
    stubFetch([envelope(null, ERROR_CODES.RATE_LIMITED, '操作太频繁，请稍后再试')], 429);
    render(<LoginPage onLoggedIn={() => undefined} />);
    await submit();
    expect(await screen.findByRole('alert')).toHaveTextContent('10 次');
  });

  it('密码框是 password 类型，不会明文显示', () => {
    render(<LoginPage onLoggedIn={() => undefined} />);
    expect(screen.getByLabelText('密码')).toHaveAttribute('type', 'password');
  });

  /** 后台没有注册入口（服务端刻意没这个端点）—— 页面上不该出现注册按钮。 */
  it('页面上没有注册入口', () => {
    render(<LoginPage onLoggedIn={() => undefined} />);
    expect(screen.queryByRole('button', { name: /注册/ })).toBeNull();
  });
});
