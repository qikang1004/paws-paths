import { useEffect, useRef, useState } from 'react';

/**
 * 驳回原因的输入框。替掉 `prompt()`。
 *
 * 为什么非要一个组件：`prompt()` 返回的字符串**无法校验后再让人改** ——
 * 服务端要求驳回必须带原因（`parseResolve` 里那条 422），而 `prompt` 一旦点掉，
 * 输入的内容就没了，人得重新敲一遍。这里在提交前就把空值挡住。
 *
 * 驳回原因会**展示给作者**（他能在「我的动态」里看到），所以占位符提示要写清
 * 这一点 —— 运营容易把它当成内部备注。
 */
export function RejectDialog({
  taskLabel,
  onCancel,
  onConfirm,
}: {
  taskLabel: string;
  onCancel(): void;
  onConfirm(reason: string): void;
}): JSX.Element {
  const [reason, setReason] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const trimmed = reason.trim();

  // 打开即聚焦：复核是键盘活，多一次点击就是每条工单多一次。
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Esc 关闭。`keydown` 挂在 window 上而不是对话框内 —— 焦点可能在遮罩上。
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onCancel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="overlay" onClick={onCancel}>
      {/* 点内容区不该关掉对话框 —— 里面有正在敲的文字。 */}
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reject-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="reject-title" className="dialog__title">
          撤下这条内容
        </h2>
        <p className="dialog__hint">
          {taskLabel}
          <br />
          驳回后内容<strong>永久撤下</strong>，作者能在「我的动态」里看到下面这段原因。
        </p>
        <textarea
          ref={inputRef}
          className="dialog__input"
          rows={3}
          value={reason}
          maxLength={200}
          placeholder="例如：包含辱骂他人的内容（这段话作者会看到）"
          onChange={(e) => setReason(e.target.value)}
        />
        <div className="dialog__actions">
          <button type="button" className="btn" onClick={onCancel}>
            取消
          </button>
          {/* 空原因时禁用而不是提交后报错：服务端那条 422 在这里是可以提前避免的。 */}
          <button
            type="button"
            className="btn btn--danger"
            disabled={!trimmed}
            onClick={() => onConfirm(trimmed)}
          >
            确认撤下
          </button>
        </div>
      </div>
    </div>
  );
}
