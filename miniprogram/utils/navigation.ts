/**
 * 拉起微信内置地图做导航。封在这里而不是页面里直接调：
 * 参数名（latitude/longitude）和默认缩放只在一处定义，页面只管传坐标与名称。
 */
export function openMapNavigation(lat: number, lng: number, name: string): void {
  wx.openLocation({ latitude: lat, longitude: lng, name, scale: 18 });
}
