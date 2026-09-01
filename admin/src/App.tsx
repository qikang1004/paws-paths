import { useCallback, useState } from 'react';
import { clearSession, loadSession, type Session } from './api/session';
import { ToastProvider } from './components/Toast';
import { AuditLogsPage } from './pages/AuditLogsPage';
import { HandledTasksPage } from './pages/HandledTasksPage';
import { LoginPage } from './pages/LoginPage';
import { TasksPage } from './pages/TasksPage';

/**
 * 三个视图之间切换，**仍然不引路由库**。
 *
 * 之前记的判断是「等『某条内容的审核历史』进来就引」——那个端点现在有了，
 * 但它做成了**对话框**而不是页面：它总是从某一行点开的（工单、已处理、流水三处），
 * 独立页面要么丢掉「我从哪来」的上下文，要么得给每处都记一个返回目标。
 * 对话框没有自己的地址，所以路由需求还是没出现。
 *
 * 真会让我引路由的是「把某条内容的历史链接发给同事」这个需求 —— 那时对话框
 * 才需要变成可深链的页面。目前三页都是队列式工作面（进来就从第一页开始清）。
 */
type View = 'tasks' | 'handled' | 'audit-logs';

/** 顺序就是运营的工作顺序：先清队列，再回看判过的，最后查流水。 */
const VIEWS: readonly { id: View; label: string }[] = [
  { id: 'tasks', label: '待复核工单' },
  { id: 'handled', label: '已处理' },
  { id: 'audit-logs', label: '审核流水' },
];

export function App(): JSX.Element {
  const [session, setSession] = useState<Session | null>(() => loadSession());
  const [view, setView] = useState<View>('tasks');

  /**
   * 令牌失效时把人送回登录页。
   *
   * `client.ts` 收到 401 已经清了 `localStorage`，但**内存里的 `session` 还在** ——
   * 不同步一下的话界面会停在当前页反复失败。这里读一次本地会话：若已被清掉，
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
          {/*
            两个视图都对 moderator 与 admin 开放 —— 服务端那两条端点挂的是同一个
            `ModeratorGuard`。**不按角色藏菜单**：藏了会让人以为自己没权限，
            而实际上点进去是能用的。真要分权得先在服务端分。
          */}
          <nav className="shell__nav">
            {VIEWS.map((v) => (
              <button
                key={v.id}
                type="button"
                className={v.id === view ? 'shell__tab shell__tab--active' : 'shell__tab'}
                onClick={() => setView(v.id)}
                aria-current={v.id === view ? 'page' : undefined}
              >
                {v.label}
              </button>
            ))}
          </nav>
          <span className="shell__spacer" />
          <span className="shell__user">
            {session.username}
            <span className="badge badge--muted">{ROLE_LABELS[session.role] ?? session.role}</span>
          </span>
          <button type="button" className="btn btn--link" onClick={logout}>
            退出
          </button>
        </header>
        {/*
          `key` 挂 token：换账号登进来时两页的分页状态都要重置。
          `onExpired` 由页面在 401 之后调用（client 已清了本地会话）。
        */}
        {view === 'tasks' && <TasksPage key={`tasks-${session.token}`} onExpired={syncSession} />}
        {view === 'handled' && (
          <HandledTasksPage key={`handled-${session.token}`} onExpired={syncSession} />
        )}
        {view === 'audit-logs' && (
          <AuditLogsPage key={`logs-${session.token}`} onExpired={syncSession} />
        )}
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
