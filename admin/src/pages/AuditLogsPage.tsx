import { useCallback, useEffect, useState } from 'react';
import { AUDIT_ACTION_LABELS, type AuditLogDto } from '@paws/types';
import { ApiError, UnauthorizedError } from '../api/client';
import { fetchAuditLogs } from '../api/moderation';
import { Pager } from '../components/Pager';

/**
 * 审核流水（合规视图）。
 *
 * 与工单页的分别是**职责**：工单是待办队列（处理完就不在列表里），流水是只追加的
 * 记录 —— 「谁在什么时候把哪条内容怎么了」要能一直查得到，包括那条内容后来被
 * 作者删掉的情况。所以这里没有任何操作按钮：这一页只读。
 *
 * 表格而不是卡片：流水的每一行字段固定、要横向比对（同一个人连续做了什么、
 * 某条内容被反复举报），而卡片适合「一条一条读」。
 */
export function AuditLogsPage({ onExpired }: { onExpired(): void }): JSX.Element {
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<AuditLogDto[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (target: number): Promise<void> => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchAuditLogs(target);
        setItems(data.items);
        setHasMore(data.hasMore);
      } catch (err) {
        if (err instanceof UnauthorizedError) {
          onExpired();
          return;
        }
        setError(err instanceof ApiError ? err.message : '加载失败，请重试');
      } finally {
        setLoading(false);
      }
    },
    [onExpired],
  );

  useEffect(() => {
    void load(page);
  }, [load, page]);

  return (
    <section className="page">
      <header className="page__head">
        <h1 className="page__title">审核流水</h1>
        <button type="button" className="btn" onClick={() => void load(page)} disabled={loading}>
          {loading ? '加载中…' : '刷新'}
        </button>
      </header>

      <p className="page__hint">
        只追加的合规记录，不可修改。这里不显示被审内容的原文 —— 流水要比它记录的内容活得久。
      </p>

      {error && (
        <div className="notice notice--error">
          {error}
          <button type="button" className="btn btn--link" onClick={() => void load(page)}>
            重试
          </button>
        </div>
      )}

      {loading && items.length === 0 && <p className="notice">正在加载…</p>}

      {!loading && !error && items.length === 0 && (
        <p className="notice">{page > 1 ? '这一页已经空了。' : '还没有任何审核动作。'}</p>
      )}

      {items.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>时间</th>
              <th>动作</th>
              <th>操作人</th>
              <th>目标</th>
              <th>状态变化</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr key={row.id}>
                <td className="table__time">{formatTime(row.createdAt)}</td>
                <td>{AUDIT_ACTION_LABELS[row.action]}</td>
                <td>{actorLabel(row)}</td>
                <td className="table__id">
                  {row.targetType === 'post' ? '动态' : '图片'}
                  <br />
                  <span className="table__mono">{row.targetId}</span>
                </td>
                <td className="table__mono">
                  {row.statusBefore} → {row.statusAfter}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <Pager page={page} hasMore={hasMore} busy={loading} onChange={setPage} />
    </section>
  );
}

/**
 * 操作人的显示。三种情况要分得开，混成一个「-」会让读流水的人分不清
 * 「这是机器做的」还是「这个人注销了」：
 *
 * · `actorId` 为 null —— 机审，那不是人做的动作；
 * · 有 id 但没有名字 —— 账号已不在 `users` 表里（`actor_id` 不挂外键，
 *   流水必须比主体活得久），显示「已注销」并带上 id；
 * · 都有 —— 显示名字。
 */
function actorLabel(row: AuditLogDto): string {
  if (row.actorId === null) return '系统（机审）';
  return row.actorName ?? `已注销（${row.actorId}）`;
}

/** ISO → 本地时间。服务端下发 UTC，运营看自己机器的时区。 */
function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('zh-CN', { hour12: false });
}
