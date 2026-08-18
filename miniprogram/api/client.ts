import { API_BASE_URL } from '../config';
import { SessionStore } from '../store/session';
import { ApiClient } from './request';
import { wxAdapter } from './wx-promise';

/** 全局单例。页面一律 `import { api } from '../../api/client'`，禁止直接调 wx.request。 */
export const session = new SessionStore(wxAdapter, API_BASE_URL);
export const api = new ApiClient(wxAdapter, session, API_BASE_URL);
