import { syncTabBar } from '../../utils/tab-bar';

Page({
  data: {},
  onShow() {
    syncTabBar(this);
  },
});
