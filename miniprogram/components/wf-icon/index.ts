import { ICONS, type IconKey } from './icons';

Component({
  properties: {
    name: { type: String, value: '' },
    role: { type: String, value: 'on-surface' },
    size: { type: String, value: '48rpx' },
  },
  data: { src: '' },
  observers: {
    'name, role': function (name: string, role: string) {
      const key = `${name}:${role}` as IconKey;
      const src = ICONS[key];
      if (!src) {
        // 静默显示空白最难查，宁可在控制台吼一声。
        console.error(`wf-icon 找不到 ${key}，检查 assets/icons 与 build-icons 的 ROLES`);
      }
      this.setData({ src: src ?? '' });
    },
  },
});
