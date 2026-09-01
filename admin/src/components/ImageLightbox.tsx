import { useEffect, useState } from 'react';

/**
 * 图片放大预览。
 *
 * 工单里的缩略图判不了色情低俗这类举报 —— 那要看清原图。开新标签页也能看，
 * 但那会丢掉复核的上下文（回来时列表已经刷新了）。
 *
 * **待审图在这里取不到，而且这不是前端能解决的。** 图走的是服务端
 * `/uploads/:ownerId/:name`，待审图落私有档、只对作者本人开放
 * （`UploadsService.fetch`），而 `<img>` 压根不会带 Authorization 头 ——
 * 运营连自己的身份都递不过去。所以这里显式处理加载失败：给一句说明，
 * 而不是留一个碎图图标让人以为后台坏了。
 */
export function ImageLightbox({
  url,
  onClose,
}: {
  url: string;
  onClose(): void;
}): JSX.Element {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="overlay overlay--dark" onClick={onClose} role="dialog" aria-modal="true" aria-label="图片预览">
      {failed ? (
        // 点这段文字不该关掉预览 —— 里面有要读的说明。
        <div className="lightbox__failure" onClick={(e) => e.stopPropagation()}>
          <p>这张图取不到。</p>
          <p className="lightbox__failure-hint">
            待审核的图片只有作者本人能取（服务端还没有为运营开取图路径）。
            已过审的图若也是这样，检查反向代理有没有把 <code>/uploads/</code> 转到服务端。
          </p>
          <p className="lightbox__failure-url">{url}</p>
        </div>
      ) : (
        <img
          className="lightbox__image"
          src={url}
          alt="被举报的图片"
          onClick={(e) => e.stopPropagation()}
          onError={() => setFailed(true)}
        />
      )}
      <button type="button" className="lightbox__close" onClick={onClose} aria-label="关闭预览">
        ×
      </button>
    </div>
  );
}
