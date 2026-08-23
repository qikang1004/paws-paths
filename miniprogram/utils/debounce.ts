/**
 * 尾部防抖：连续调用只在停手 wait 毫秒后执行一次，用最后一次的参数。
 * 搜索框每敲一个字都发请求会把后端打满，也会让结果闪烁。
 */
export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  wait: number,
): (...args: A) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args: A): void => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, wait);
  };
}
