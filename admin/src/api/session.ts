import type { UserRole } from '@paws/types';

/**
 * 登录态：令牌 + 用户名 + 角色，存 `localStorage`。
 *
 * 为什么不是 `sessionStorage`：运营复核是会反复来回的活，每开一个标签页都要重登
 * 只会让人把密码记在便签上。为什么不是 Cookie：服务端的 CORS 配的是
 * `credentials: false`（见 `server/src/common/cors.ts`），Bearer 头这条路
 * 压根不产生 CSRF 面 —— 换成 Cookie 就得再补一套 CSRF 令牌。
 *
 * 代价是 XSS 能读到令牌。这一侧的对策是「后台不渲染任何用户可控的 HTML」：
 * 被举报的正文一律走 React 的文本插值（自动转义），图片只当 `src` 用。
 *
 * `role` 存下来只为**决定显示哪些菜单**。它不是权限判据 —— 每个运营端点都会
 * 用 `ModeratorGuard` 从库里查一次（Global Constraint 28），改这里的值
 * 骗不到任何数据。
 */
export interface Session {
  token: string;
  username: string;
  role: UserRole;
}

const STORAGE_KEY = 'paws.admin.session';

/** 角色白名单。存坏了的会话按「没登录」处理，而不是把 undefined 传下去。 */
const ROLES: readonly string[] = ['user', 'moderator', 'admin'];

export function loadSession(): Session | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { token, username, role } = parsed as Record<string, unknown>;
    if (typeof token !== 'string' || !token) return null;
    if (typeof username !== 'string') return null;
    if (typeof role !== 'string' || !ROLES.includes(role)) return null;
    return { token, username, role: role as UserRole };
  } catch {
    // 存坏了（手改过、或旧版本的形状）——当没登录，别让整个后台白屏。
    return null;
  }
}

export function saveSession(session: Session): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function clearSession(): void {
  localStorage.removeItem(STORAGE_KEY);
}
