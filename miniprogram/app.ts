import { session } from './api/client';

App({
  onLaunch() {
    // 冷启动就换登录态，首页请求不用再等一次 wx.login 往返。
    // 失败不阻断启动：请求层遇 401 会自己重登重放。
    void session.refresh().catch(() => undefined);
  },
});
