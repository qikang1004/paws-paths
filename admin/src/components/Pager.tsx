/**
 * 上一页 / 下一页。
 *
 * 提出来是因为工单页与流水页要的是同一套：`hasMore` 由服务端多取一条判出来，
 * 所以两边都**不知道总页数** —— 页码跳转做不了，只有前后翻。
 */
export function Pager({
  page,
  hasMore,
  busy,
  onChange,
}: {
  page: number;
  hasMore: boolean;
  busy: boolean;
  onChange(page: number): void;
}): JSX.Element {
  return (
    <nav className="pager">
      <button type="button" className="btn" disabled={page === 1 || busy} onClick={() => onChange(page - 1)}>
        上一页
      </button>
      <span className="pager__label">第 {page} 页</span>
      <button type="button" className="btn" disabled={!hasMore || busy} onClick={() => onChange(page + 1)}>
        下一页
      </button>
    </nav>
  );
}
