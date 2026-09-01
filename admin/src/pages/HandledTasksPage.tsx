import { useCallback, useEffect, useState } from 'react';
import { REPORT_REASON_LABELS, type HandledTaskDto } from '@paws/types';
import { ApiError, UnauthorizedError } from '../api/client';
import { fetchHandledTasks } from '../api/moderation';
import { HistoryDialog } from '../components/HistoryDialog';
import { Pager } from '../components/Pager';

/**
 * 已处理工单的历史。
 *
 * 与待复核页共用不了组件：那边每张卡片有两个操作按钮，这边一个都没有（已经判完了），
 * 而这边要显示的 `result` / `handledBy` / `handledAt` 在那边刻意不下发。
 *
 * 与流水页的分别：这一页看得到**当初判的是什么内容**（举报原因、正文、图片），
 * 流水页只有动作与状态变化。代价是目标被作者删掉后内容为空 —— 那正是流水
 * 不带原文的理由（它要活得更久）。
 */
export function HandledTasksPage({ onExpired }: { onExpired(): void }): JSX.Element {
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<HandledTaskDto[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HandledTaskDto | null>(null);

  const load = useCallback(
    async (target: number): Promise<void> => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchHandledTasks(target);
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
        <h1 className="page__title">已处理工单</h1>
        <button type="button" className="btn" onClick={() => void load(page)} disabled={loading}>
          {loading ? '加载中…' : '刷新'}
        </button>
      </header>

      <p className="page__hint">按处理时间倒序，最近判的在最前。内容被作者删掉后这里的原文会是空的。</p>

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
        <p className="notice">{page > 1 ? '这一页已经空了。' : '还没有处理过任何工单。'}</p>
      )}

      <div className="cards">
        {items.map((task) => (
          <article key={task.id} className="card">
            <header className="card__head">
              {/* 结论是这一页最要紧的信息，放在最前并且用颜色区分。 */}
              <span className={task.result === 'approved' ? 'badge badge--ok' : 'badge badge--reason'}>
                {task.result === 'approved' ? '已保留' : '已撤下'}
              </span>
              <span className="badge badge--muted">
                {task.targetType === 'post' ? '动态' : '图片'}
              </span>
              {task.reason && <span className="badge">{REPORT_REASON_LABELS[task.reason]}</span>}
              <time className="card__time" dateTime={task.handledAt}>
                {formatTime(task.handledAt)}
              </time>
            </header>

            <div className="card__author">
              作者：<strong>{task.authorNickname || '（取不到）'}</strong>
              {' · '}
              {/* handledBy 可空：`ON DELETE SET NULL` —— 账号注销后指针被置空。 */}
              复核：<strong>{handlerLabel(task)}</strong>
            </div>

            {task.content ? (
              <p className="card__content">{task.content}</p>
            ) : (
              <p className="card__content card__content--empty">
                内容已不存在（作者删除了它）—— 审核动作仍记在流水里。
              </p>
            )}

            <footer className="card__actions">
              <button type="button" className="btn" onClick={() => setHistory(task)}>
                查看审核历史
              </button>
            </footer>
          </article>
        ))}
      </div>

      <Pager page={page} hasMore={hasMore} busy={loading} onChange={setPage} />

      {history && (
        <HistoryDialog
          targetType={history.targetType}
          targetId={history.targetId}
          onClose={() => setHistory(null)}
        />
      )}
    </section>
  );
}

/** 复核人：有名字用名字，只有 id 用 id，都没有说明账号已注销。 */
function handlerLabel(task: HandledTaskDto): string {
  if (task.handledByName) return task.handledByName;
  if (task.handledBy) return task.handledBy;
  return '已注销';
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('zh-CN', { hour12: false });
}
