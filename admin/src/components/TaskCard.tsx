import { useState } from 'react';
import { REPORT_REASON_LABELS, type ModerationTaskDto } from '@paws/types';

/** 目标类型的展示文案。服务端的两个值（`post` / `post_image`）各对一条。 */
const TARGET_LABELS: Record<ModerationTaskDto['targetType'], string> = {
  post: '动态',
  post_image: '动态里的一张图',
};

/** 工单来源。`user_report` 是本阶段唯一会入队的来源，另两个是预留。 */
const SOURCE_LABELS: Record<ModerationTaskDto['source'], string> = {
  user_report: '用户举报',
  wx_auto: '机器审核',
  manual: '运营发起',
};

/**
 * 一条工单。
 *
 * 正文一律走 React 的文本插值 —— **绝不用 `dangerouslySetInnerHTML`**：这是 UGC，
 * 而后台的令牌就在 `localStorage` 里（见 `session.ts` 的注释）。
 *
 * 图片类工单只带被举报那一张（服务端的 `image_urls` 已经收窄过），所以这里不必
 * 再判「哪张是被举报的」——给什么显示什么。
 */
export function TaskCard({
  task,
  busy,
  onApprove,
  onReject,
  onPreview,
}: {
  task: ModerationTaskDto;
  busy: boolean;
  onApprove(): void;
  onReject(): void;
  onPreview(url: string): void;
}): JSX.Element {
  return (
    <article className="card">
      <header className="card__head">
        <span className="badge">{TARGET_LABELS[task.targetType]}</span>
        <span className="badge badge--muted">{SOURCE_LABELS[task.source]}</span>
        {/* `reason` 可空：机审入队的工单没有举报原因。 */}
        {task.reason && <span className="badge badge--reason">{REPORT_REASON_LABELS[task.reason]}</span>}
        <time className="card__time" dateTime={task.createdAt}>
          {formatTime(task.createdAt)}
        </time>
      </header>

      <div className="card__author">
        作者：<strong>{task.authorNickname}</strong>
      </div>

      {/* 空正文（纯图动态）不留一个空框。 */}
      {task.content && <p className="card__content">{task.content}</p>}

      {task.imageUrls.length > 0 && (
        <div className="card__images">
          {task.imageUrls.map((url) => (
            <Thumb key={url} url={url} onPreview={() => onPreview(url)} />
          ))}
        </div>
      )}

      <footer className="card__actions">
        {/* 「保留」在前：多数举报不成立，把常用的那个放在手边。 */}
        <button type="button" className="btn btn--primary" disabled={busy} onClick={onApprove}>
          举报不成立，保留
        </button>
        <button type="button" className="btn btn--danger" disabled={busy} onClick={onReject}>
          举报成立，撤下
        </button>
      </footer>
    </article>
  );
}

/**
 * 一张缩略图。
 *
 * 取不到时**显式画一个占位**而不是留浏览器的碎图图标：待审图运营取不到是常态
 * （私有档只对作者开放，`<img>` 递不了 Authorization 头），而碎图图标看起来
 * 与「后台坏了」一模一样。仍然可点 —— 大图那边的说明更详细。
 */
function Thumb({ url, onPreview }: { url: string; onPreview(): void }): JSX.Element {
  const [failed, setFailed] = useState(false);
  return (
    <button
      type="button"
      className={failed ? 'thumb thumb--failed' : 'thumb'}
      onClick={onPreview}
      aria-label={failed ? '这张图取不到，点开看说明' : '放大查看这张图片'}
    >
      {failed ? (
        <span className="thumb__placeholder" aria-hidden="true">
          取不到
        </span>
      ) : (
        <img src={url} alt="" loading="lazy" onError={() => setFailed(true)} />
      )}
    </button>
  );
}

/**
 * ISO 时间 → 本地可读。`toLocaleString` 而不是手拼：运营看的是自己机器的时区，
 * 而服务端下发的是 UTC 的 ISO 串。
 */
function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('zh-CN', { hour12: false });
}
