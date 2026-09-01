import { useState } from 'react';
import type { FormEvent } from 'react';
import { ERROR_CODES } from '@paws/types';
import { ApiError } from '../api/client';
import { adminLogin } from '../api/moderation';
import { saveSession, type Session } from '../api/session';

/**
 * 运营登录页。
 *
 * 失败文案**一律用服务端给的那句** —— 服务端刻意让「用户名不存在」与「密码错误」
 * 收敛成同一句（见 `AuthService.badCredentials`），前端再按 code 分支写文案
 * 就会把那道防枚举的收敛拆开。
 *
 * 唯一的例外是 429：那句「操作太频繁」对运营来说信息不足，补一句说明限流的量级
 * （一小时 10 次，见 `ADMIN_LOGIN_RATE_LIMIT`），否则他会以为是服务挂了、
 * 继续重试，把配额烧光。
 */
export function LoginPage({ onLoggedIn }: { onLoggedIn(session: Session): void }): JSX.Element {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await adminLogin(username.trim(), password);
      const session: Session = { token: result.token, username: username.trim(), role: result.role };
      saveSession(session);
      onLoggedIn(session);
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <form className="login__box" onSubmit={(e) => void onSubmit(e)}>
        <h1 className="login__title">Paws Paths 运营后台</h1>

        <label className="field">
          <span className="field__label">用户名</span>
          <input
            className="field__input"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
            disabled={busy}
          />
        </label>

        <label className="field">
          <span className="field__label">密码</span>
          <input
            className="field__input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            disabled={busy}
          />
        </label>

        {/* `role="alert"` 让读屏软件立刻念出来 —— 登录失败是必须知道的事。 */}
        {error && (
          <p className="notice notice--error" role="alert">
            {error}
          </p>
        )}

        <button type="submit" className="btn btn--primary btn--block" disabled={busy}>
          {busy ? '正在登录…' : '登录'}
        </button>

        {/* 后台**没有注册入口**（服务端刻意没这个端点），说清加人要走哪条路。 */}
        <p className="login__hint">账号由管理员在服务器上用 CLI 创建，本页没有注册入口。</p>
      </form>
    </main>
  );
}

/** 429 补一句量级；其余一律用服务端文案。 */
function messageFor(err: unknown): string {
  if (!(err instanceof ApiError)) return '登录失败，请重试';
  if (err.code === ERROR_CODES.RATE_LIMITED) return `${err.message}（运营登录一小时最多 10 次，请稍后再试）`;
  return err.message;
}
