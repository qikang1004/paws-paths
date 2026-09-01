import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

/**
 * 顶部浮出的提示条，替掉 `alert()`。
 *
 * 换掉 `alert()` 不只是观感：它是**同步阻塞**的，弹着的时候 React 收不到任何事件，
 * 而复核是「点一下、等一下、再点下一条」的节奏 —— 每次都要先点掉一个模态框，
 * 一屏 20 条工单就是 20 次多余的点击。
 */
export type ToastKind = 'success' | 'error';

interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

interface ToastApi {
  show(kind: ToastKind, text: string): void;
}

const ToastContext = createContext<ToastApi | null>(null);

/** 自动消失的时长。错误留久一点 —— 那种提示往往要照着它改操作。 */
const DISMISS_MS: Record<ToastKind, number> = { success: 2500, error: 5000 };

export function ToastProvider({ children }: { children: ReactNode }): JSX.Element {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (kind: ToastKind, text: string) => {
      const id = nextId.current++;
      setToasts((list) => [...list, { id, kind, text }]);
      window.setTimeout(() => dismiss(id), DISMISS_MS[kind]);
    },
    [dismiss],
  );

  // `useMemo` 而不是直接传字面量：provider 的 value 每次渲染换引用会让所有
  // 消费者跟着重渲染，而 `show` 本身是稳定的。
  const api = useMemo<ToastApi>(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/* `aria-live` 让读屏软件念出提示 —— 这条提示是操作唯一的反馈。 */}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast--${t.kind}`}>
            <span>{t.text}</span>
            <button type="button" className="toast__close" onClick={() => dismiss(t.id)} aria-label="关闭提示">
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** 没套 provider 时抛错而不是静默失败：那种漏配会让操作反馈整个消失。 */
export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast 必须在 ToastProvider 内使用');
  return api;
}
