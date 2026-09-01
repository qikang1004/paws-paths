import { useEffect, useState } from 'react';
import { AUDIT_ACTION_LABELS, type AuditLogDto, type ModerationTargetType } from '@paws/types';
import { ApiError } from '../api/client';
import { fetchTargetHistory } from '../api/moderation';

/**
 * 某条内容的审核历史。
 *
 * 做成对话框而不是独立页面：它总是从某一行点开的（工单、历史、流水三处），
 * 独立页面要么丢掉「我从哪来」的上下文，要么得给每处都记一个返回目标。
 *
 * **操作人只显示 id，不显示名字** —— 服务端这条路径下发的 `actorName` 恒为 null
 * （`listByTarget` 不 JOIN users，它的主调用点在复核流程里）。写成「显示名字，
 * 没有就退到 id」会让人以为名字取不到是个 bug，而它是这条路径的既定行为。
 */
export function HistoryDialog({
  targetType,
  targetId,
  onClose,
}: {
  targetType: ModerationTargetType;
  targetId: string;
  onClose(): void;
}): JSX.Element {
  const [items, setItems] = useState<AuditLogDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchTargetHistory(targetType, targetId)
      .then((data) => {
        // 组件在请求飞行中被关掉时不要 setState —— 那会在已卸载的树上更新。
        if (alive) setItems(data.items);
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof ApiError ? err.message : '加载失败');
      });
    return () => {
      alive = false;
    };
  }, [targetType, targetId]);

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="dialog dialog--wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="history-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="history-title" className="dialog__title">
          这条内容的审核历史
        </h2>
        <p className="dialog__hint">
          {targetType === 'post' ? '动态' : '图片'} <code>{targetId}</code>
        </p>

        {error && <p className="notice notice--error">{error}</p>}
        {!error && items === null && <p className="notice">正在加载…</p>}
        {items?.length === 0 && <p className="notice">这条内容还没有任何审核动作。</p>}

        {items && items.length > 0 && (
          <ol className="timeline">
            {items.map((row) => (
              <li key={row.id} className="timeline__item">
                <div className="timeline__head">
                  <strong>{AUDIT_ACTION_LABELS[row.action]}</strong>
                  <time dateTime={row.createdAt}>{formatTime(row.createdAt)}</time>
                </div>
                <div className="timeline__meta">
                  {/* 机审没有操作人 —— 与「有 id」分开显示。 */}
                  {row.actorId === null ? '系统（机审）' : `操作人 ${row.actorId}`}
                  {' · '}
                  <span className="table__mono">
                    {row.statusBefore} → {row.statusAfter}
                  </span>
                </div>
              </li>
            ))}
          </ol>
        )}

        <div className="dialog__actions">
          <button type="button" className="btn" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('zh-CN', { hour12: false });
}
