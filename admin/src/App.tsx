import { useCallback, useState } from 'react';
import { clearSession, loadSession, type Session } from './api/session';
import { ToastProvider } from './components/Toast';
import { LoginPage } from './pages/LoginPage';
import { TasksPage } from './pages/TasksPage';

/**
 * 只有两个视图（登录 / 工单），所以**不引路由库**：一个 `session` 状态就够了。
 * 引 react-router 是为了「地址栏能表达位置」，而这个后台目前没有第二个能深链的页面 ——
 * 等审计日志页进来再引，那时才有真正的路由需求。
 *
 * 会话从 `localStorage` 初始化，所以刷新页面不会掉登录态。
 */
export function App(): JSX.Element {
  const [session, setSession] = useState<Session | null>(() => loadSession());

  /**
   * 令牌失效时把人送回登录页。
   *
   * `client.ts` 收到 401 已经清了 `localStorage`，但**内存里的 `session` 还在** ——
   * 不同步一下的话界面会停在工单页反复失败。这里读一次本地会话：若已被清掉，
   * 就把内存状态也归零。
   */
  const syncSession = useCallback(() => {
    setSession(loadSession());
  }, []);

  function logout(): void {
    clearSession();
    setSession(null);
  }

  if (!session) return <LoginPage onLoggedIn={setSession} />;

  return (
    <ToastProvider>
      <div className="shell">
        <header className="shell__bar">
          <span className="shell__brand">Paws Paths 运营后台</span>
          <span className="shell__spacer" />
          <span className="shell__user">
            {session.username}
            <span className="badge badge--muted">{ROLE_LABELS[session.role] ?? session.role}</span>
          </span>
          <button type="button" className="btn btn--link" onClick={logout}>
            退出
          </button>
        </header>
        {/* `onExpired` 由工单页在 401 之后调用（client 已清了本地会话）。 */}
        <TasksPage key={session.token} onExpired={syncSession} />
      </div>
    </ToastProvider>
  );
}

/** 角色文案。只影响显示 —— 权限判定在服务端每次请求都查库。 */
const ROLE_LABELS: Record<string, string> = {
  admin: '管理员',
  moderator: '审核员',
  user: '普通用户',
};
