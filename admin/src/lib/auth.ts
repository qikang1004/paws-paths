const TOKEN_KEY = 'paws_admin_token';
const USER_KEY = 'paws_admin_user';

export interface AuthUser {
  userId: string;
  username: string;
  role: 'moderator' | 'admin';
}

export interface LoginResponse {
  token: string;
  userId: string;
  role: 'moderator' | 'admin';
}

export const auth = {
  getToken(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  },

  setToken(token: string): void {
    localStorage.setItem(TOKEN_KEY, token);
  },

  getUser(): AuthUser | null {
    const json = localStorage.getItem(USER_KEY);
    return json ? JSON.parse(json) : null;
  },

  setUser(user: AuthUser): void {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  },

  clear(): void {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  },

  isAuthenticated(): boolean {
    return !!this.getToken();
  },
};
