import {
  AUDIT_ACTIONS,
  AUDIT_ACTION_LABELS,
  MODERATION_TARGET_TYPES,
  REPORT_REASONS,
  REPORT_REASON_LABELS,
  type ModerationFilter,
} from '@paws/types';

/** 这个列表页支持筛哪几维。与服务端 controller 里的 `allowed` 一一对应。 */
export type FilterDimension = keyof ModerationFilter;

const TARGET_LABELS: Record<string, string> = { post: '动态', post_image: '图片' };
const RESULT_LABELS: Record<string, string> = { approved: '已保留', rejected: '已撤下' };

/**
 * 筛选条。三个列表页共用，按 `dimensions` 决定画哪几个下拉。
 *
 * 用 `<select>` 而不是一排 chip：维度可能到四个，每个 2–6 个选项，chip 会占掉
 * 半屏。运营是在桌面浏览器里用的，原生下拉的键盘操作也更快。
 *
 * **不做「应用」按钮** —— 改一个下拉立刻生效。加按钮意味着要维护一份「待应用」
 * 的中间状态，而这里改一次就是一次请求，没有批量改的必要。
 */
export function FilterBar({
  dimensions,
  value,
  busy,
  onChange,
}: {
  dimensions: readonly FilterDimension[];
  value: ModerationFilter;
  busy: boolean;
  onChange(next: ModerationFilter): void;
}): JSX.Element {
  /** 改一维：空串表示「不筛这一维」，那时把键删掉而不是留一个空值。 */
  function set(key: FilterDimension, raw: string): void {
    const next = { ...value };
    if (raw) next[key] = raw as never;
    else delete next[key];
    onChange(next);
  }

  const active = dimensions.filter((d) => value[d]).length;

  return (
    <div className="filters">
      {dimensions.includes('targetType') && (
        <Select
          label="类型"
          value={value.targetType ?? ''}
          options={MODERATION_TARGET_TYPES.map((v) => [v, TARGET_LABELS[v] ?? v])}
          busy={busy}
          onChange={(raw) => set('targetType', raw)}
        />
      )}
      {dimensions.includes('reason') && (
        <Select
          label="举报原因"
          value={value.reason ?? ''}
          options={REPORT_REASONS.map((v) => [v, REPORT_REASON_LABELS[v]])}
          busy={busy}
          onChange={(raw) => set('reason', raw)}
        />
      )}
      {dimensions.includes('result') && (
        <Select
          label="结论"
          value={value.result ?? ''}
          options={(['approved', 'rejected'] as const).map((v) => [v, RESULT_LABELS[v]])}
          busy={busy}
          onChange={(raw) => set('result', raw)}
        />
      )}
      {dimensions.includes('action') && (
        <Select
          label="动作"
          value={value.action ?? ''}
          options={AUDIT_ACTIONS.map((v) => [v, AUDIT_ACTION_LABELS[v]])}
          busy={busy}
          onChange={(raw) => set('action', raw)}
        />
      )}

      {/* 有筛选生效时才给清空入口 —— 没筛的时候它是个没用的按钮。 */}
      {active > 0 && (
        <button type="button" className="btn btn--link" onClick={() => onChange({})} disabled={busy}>
          清空筛选（{active}）
        </button>
      )}
    </div>
  );
}

/** 一个下拉。空选项的文案是「全部」——它表达的是「这一维不筛」。 */
function Select({
  label,
  value,
  options,
  busy,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly (readonly [string, string])[];
  busy: boolean;
  onChange(raw: string): void;
}): JSX.Element {
  return (
    <label className="filters__field">
      <span className="filters__label">{label}</span>
      <select
        className="filters__select"
        value={value}
        disabled={busy}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">全部</option>
        {options.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}
