import { useCallback, useEffect, useState } from 'react';
import type { ModerationFilter, ModerationTaskDto } from '@paws/types';
import { ApiError, UnauthorizedError } from '../api/client';
import { fetchTasks, resolveTask, type ResolveResult } from '../api/moderation';
import { ImageLightbox } from '../components/ImageLightbox';
import { FilterBar } from '../components/FilterBar';
import { Pager } from '../components/Pager';
import { RejectDialog } from '../components/RejectDialog';
import { TaskCard } from '../components/TaskCard';
import { useToast } from '../components/Toast';

/**
 * 待复核工单列表。
 *
 * **分页而不是无限流**：复核是「清空队列」的活，页码让人知道还剩多少、也能回上一页
 * 复查刚判过的那条。而无限流一刷新就回到顶部，判到一半的位置就丢了。
 *
 * 复核成功后**重新拉当前页**而不是只把那条从本地数组里摘掉：队列在动
 * （其他运营也在判、新举报还在进），摘掉一条会让这一页少显示一条，
 * 而下一条本该从后面补上来。重拉一次是一个 O(1) 的请求，换掉一整类
 * 「本地状态与服务端不一致」的问题。
 */
export function TasksPage({ onExpired }: { onExpired(): void }): JSX.Element {
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<ModerationFilter>({});
  const [items, setItems] = useState<ModerationTaskDto[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** 正在提交的工单 id。按 id 而不是布尔：只禁用那一条的按钮，别把整页锁死。 */
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<ModerationTaskDto | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const toast = useToast();

  const load = useCallback(
    async (target: number, active: ModerationFilter): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchTasks(target, active);
      setItems(data.items);
      setHasMore(data.hasMore);
    } catch (err) {
      // 401：`client.ts` 已经清了本地会话，这里把外壳的内存状态也同步掉 ——
      // 不同步就会停在这一页反复失败。
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
    void load(page, filter);
  }, [load, page, filter]);

  /**
   * 改筛选时**回到第一页**：留在第 3 页而筛完只有一页，会得到一屏空列表加一个
   * 「这一页空了」——那看起来像筛选把什么都滤掉了。
   */
  function applyFilter(next: ModerationFilter): void {
    setFilter(next);
    setPage(1);
  }

  /**
   * 落一次复核。
   *
   * 「这条已被别人处理」（`MODERATION_TASK_HANDLED`）**不当成错误弹红条** ——
   * 那是多人同时清队列时的正常结果，提示应当是中性的，并且照样要刷新列表
   * （那条工单已经不该在这一页了）。
   */
  async function submit(task: ModerationTaskDto, result: ResolveResult, reason?: string): Promise<void> {
    setBusyId(task.id);
    try {
      await resolveTask(task.id, result, reason);
      toast.show('success', result === 'approved' ? '已保留这条内容' : '已撤下这条内容');
      await load(page, filter);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        onExpired();
        return;
      }
      if (err instanceof ApiError) {
        toast.show('error', err.message);
        // 并发败者、或目标已被作者删掉：两者都意味着这一页过期了。
        await load(page, filter);
      } else {
        toast.show('error', '操作失败，请重试');
      }
    } finally {
      setBusyId(null);
    }
  }

  // 空的最后一页：清完了就退回上一页，而不是留一屏「暂无工单」让人自己点。
  const showEmptyBack = !loading && !error && items.length === 0 && page > 1;

  return (
    <section className="page">
      <header className="page__head">
        <h1 className="page__title">待复核工单</h1>
        <button type="button" className="btn" onClick={() => void load(page, filter)} disabled={loading}>
          {loading ? '加载中…' : '刷新'}
        </button>
      </header>

      {/* 待办没有 `result` 可筛（恒为空），也没有 `action`（那是流水的维度）。 */}
      <FilterBar
        dimensions={['targetType', 'reason']}
        value={filter}
        busy={loading}
        onChange={applyFilter}
      />

      {error && (
        <div className="notice notice--error">
          {error}
          <button type="button" className="btn btn--link" onClick={() => void load(page, filter)}>
            重试
          </button>
        </div>
      )}

      {loading && items.length === 0 && <p className="notice">正在加载…</p>}

      {/*
        空列表的三种成因要分开说：翻过头了、筛没命中、队列真的空。
        混成一句「没有数据」会让人以为队列清完了，而实际上是筛选条件太窄。
      */}
      {!loading && !error && items.length === 0 && (
        <p className="notice">
          {page > 1
            ? '这一页已经空了。'
            : Object.keys(filter).length > 0
              ? '没有符合筛选条件的工单 —— 换个条件或清空筛选。'
              : '队列是空的 —— 没有待复核的内容。'}
        </p>
      )}

      <div className="cards">
        {items.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            busy={busyId === task.id}
            onApprove={() => void submit(task, 'approved')}
            onReject={() => setRejecting(task)}
            onPreview={setPreview}
          />
        ))}
      </div>

      {/* `hasMore` 是服务端多取一条判出来的 —— 两页共用同一个组件。 */}
      <Pager page={page} hasMore={hasMore} busy={loading} onChange={setPage} />

      {/* 清完最后一页时给一个显式的回退入口，而不是留一屏「这一页空了」。 */}
      {showEmptyBack && (
        <button type="button" className="btn btn--link" onClick={() => setPage(page - 1)}>
          回到上一页
        </button>
      )}

      {rejecting && (
        <RejectDialog
          taskLabel={rejecting.content ? `内容：${truncate(rejecting.content)}` : '这条工单没有正文（纯图片）。'}
          onCancel={() => setRejecting(null)}
          onConfirm={(reason) => {
            const task = rejecting;
            setRejecting(null);
            void submit(task, 'rejected', reason);
          }}
        />
      )}

      {preview && <ImageLightbox url={preview} onClose={() => setPreview(null)} />}
    </section>
  );
}

/** 对话框里只要一眼能认出是哪条，不要整段正文。 */
function truncate(text: string): string {
  return text.length > 40 ? `${text.slice(0, 40)}…` : text;
}
