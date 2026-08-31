import { Outlet, Link, useNavigate, useLocation } from 'react-router-dom';
import { auth } from '../lib/auth';
import './Layout.css';

export function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const user = auth.getUser();

  function handleLogout() {
    auth.clear();
    navigate('/login');
  }

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-header">
          <h2>Paws Paths</h2>
          <div className="user-info">
            <div className="username">{user?.username}</div>
            <div className="role">{user?.role === 'admin' ? '管理员' : '审核员'}</div>
          </div>
        </div>
        <nav className="sidebar-nav">
          <Link
            to="/"
            className={location.pathname === '/' ? 'active' : ''}
          >
            📋 待审核工单
          </Link>
          {user?.role === 'admin' && (
            <Link
              to="/audit-logs"
              className={location.pathname === '/audit-logs' ? 'active' : ''}
            >
              📜 审计日志
            </Link>
          )}
        </nav>
        <div className="sidebar-footer">
          <button onClick={handleLogout} className="logout-btn">
            退出登录
          </button>
        </div>
      </aside>
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
