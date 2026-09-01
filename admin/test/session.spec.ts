import { describe, expect, it } from 'vitest';
import { clearSession, loadSession, saveSession } from '../src/api/session';

describe('会话存储', () => {
  it('存进去能原样读出来', () => {
    saveSession({ token: 'tok', username: 'ops', role: 'moderator' });
    expect(loadSession()).toEqual({ token: 'tok', username: 'ops', role: 'moderator' });
  });

  it('没登录时是 null', () => {
    expect(loadSession()).toBeNull();
  });

  it('清掉之后读回 null', () => {
    saveSession({ token: 'tok', username: 'ops', role: 'admin' });
    clearSession();
    expect(loadSession()).toBeNull();
  });

  /**
   * 这三条是同一件事的三个面：**存坏了的会话必须当成「没登录」，而不是抛异常**。
   * 抛出去会在 `useState` 的初始化里炸掉，整个后台白屏 —— 而白屏没有任何自救路径。
   */
  it('不是 JSON 时当没登录', () => {
    localStorage.setItem('paws.admin.session', '{不是 json');
    expect(loadSession()).toBeNull();
  });

  it('缺 token 时当没登录', () => {
    localStorage.setItem('paws.admin.session', JSON.stringify({ username: 'ops', role: 'admin' }));
    expect(loadSession()).toBeNull();
  });

  it('角色不在白名单里时当没登录', () => {
    localStorage.setItem(
      'paws.admin.session',
      JSON.stringify({ token: 't', username: 'ops', role: 'superuser' }),
    );
    expect(loadSession()).toBeNull();
  });
});
