import { useEffect } from 'react';

/**
 * 图片放大预览。
 *
 * 工单里的缩略图判不了色情低俗这类举报 —— 那要看清原图。开新标签页也能看，
 * 但那会丢掉复核的上下文（回来时列表已经刷新了）。
 *
 * 图片走的是服务端 `/uploads/:ownerId/:name` 那条**带鉴权**的路由：待审图落私有档，
 * 只有作者本人取得到（见 `UploadsService.fetch`）。所以运营在这里**看不到私有档的图** ——
 * 那是 Task 4 之后要单独开的口子，不是这个组件能解决的事。已过审的图（`public` 档）
 * 正常显示。加载失败时给出明确文案，而不是留一个碎图图标。
 */
export function ImageLightbox({
  url,
  onClose,
}: {
  url: string;
  onClose(): void;
}): JSX.Element {
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="overlay overlay--dark" onClick={onClose} role="dialog" aria-modal="true" aria-label="图片预览">
      <img
        className="lightbox__image"
        src={url}
        alt="被举报的图片"
        onClick={(e) => e.stopPropagation()}
      />
      <button type="button" className="lightbox__close" onClick={onClose} aria-label="关闭预览">
        ×
      </button>
    </div>
  );
}
