import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FilterBar } from '../src/components/FilterBar';

describe('筛选条', () => {
  it('只画声明了的维度', () => {
    render(<FilterBar dimensions={['targetType', 'reason']} value={{}} busy={false} onChange={vi.fn()} />);
    expect(screen.getByLabelText('类型')).toBeInTheDocument();
    expect(screen.getByLabelText('举报原因')).toBeInTheDocument();
    // 待办没有结论可筛 —— 那个下拉不该出现。
    expect(screen.queryByLabelText('结论')).toBeNull();
    expect(screen.queryByLabelText('动作')).toBeNull();
  });

  it('已处理页多一个结论维度', () => {
    render(
      <FilterBar dimensions={['targetType', 'reason', 'result']} value={{}} busy={false} onChange={vi.fn()} />,
    );
    expect(screen.getByLabelText('结论')).toBeInTheDocument();
  });

  it('流水页有动作、没有举报原因', () => {
    render(<FilterBar dimensions={['targetType', 'action']} value={{}} busy={false} onChange={vi.fn()} />);
    expect(screen.getByLabelText('动作')).toBeInTheDocument();
    expect(screen.queryByLabelText('举报原因')).toBeNull();
  });

  /** 选项文案走 `@paws/types` 的 LABELS，不各自硬编码一份。 */
  it('举报原因显示中文文案而不是枚举值', () => {
    render(<FilterBar dimensions={['reason']} value={{}} busy={false} onChange={vi.fn()} />);
    expect(screen.getByRole('option', { name: '虐待动物' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'animal_abuse' })).toBeNull();
  });

  it('动作显示中文文案', () => {
    render(<FilterBar dimensions={['action']} value={{}} busy={false} onChange={vi.fn()} />);
    expect(screen.getByRole('option', { name: '复核撤下' })).toBeInTheDocument();
  });

  /** 空选项表达的是「这一维不筛」，文案必须是「全部」而不是空白。 */
  it('每个下拉都有「全部」选项', () => {
    render(<FilterBar dimensions={['targetType']} value={{}} busy={false} onChange={vi.fn()} />);
    expect(screen.getAllByRole('option', { name: '全部' })).toHaveLength(1);
  });

  it('选一项后上抛新的筛选对象', async () => {
    const onChange = vi.fn();
    render(<FilterBar dimensions={['reason']} value={{}} busy={false} onChange={onChange} />);
    await userEvent.selectOptions(screen.getByLabelText('举报原因'), 'porn');
    expect(onChange).toHaveBeenCalledWith({ reason: 'porn' });
  });

  /**
   * 选回「全部」时把那个键**删掉**，不是留一个空串。空串在 URL 里是
   * `?reason=`，服务端当没筛，但发出去让接口日志读不出实际筛了什么。
   */
  it('选回「全部」时删掉那一维，不留空值', async () => {
    const onChange = vi.fn();
    render(<FilterBar dimensions={['reason']} value={{ reason: 'porn' }} busy={false} onChange={onChange} />);
    await userEvent.selectOptions(screen.getByLabelText('举报原因'), '');
    expect(onChange).toHaveBeenCalledWith({});
  });

  it('改一维不影响另一维', async () => {
    const onChange = vi.fn();
    render(
      <FilterBar
        dimensions={['targetType', 'reason']}
        value={{ reason: 'spam' }}
        busy={false}
        onChange={onChange}
      />,
    );
    await userEvent.selectOptions(screen.getByLabelText('类型'), 'post_image');
    expect(onChange).toHaveBeenCalledWith({ reason: 'spam', targetType: 'post_image' });
  });

  it('受控组件：当前值来自 props', () => {
    render(
      <FilterBar dimensions={['reason']} value={{ reason: 'fraud' }} busy={false} onChange={vi.fn()} />,
    );
    expect(screen.getByLabelText('举报原因')).toHaveValue('fraud');
  });

  /** 没筛的时候「清空」是个没用的按钮 —— 不画。 */
  it('没有筛选生效时不显示清空按钮', () => {
    render(<FilterBar dimensions={['reason']} value={{}} busy={false} onChange={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /清空筛选/ })).toBeNull();
  });

  it('有筛选时显示清空按钮并带上生效的维度数', () => {
    render(
      <FilterBar
        dimensions={['targetType', 'reason']}
        value={{ targetType: 'post', reason: 'spam' }}
        busy={false}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: '清空筛选（2）' })).toBeInTheDocument();
  });

  it('点清空后上抛空对象', async () => {
    const onChange = vi.fn();
    render(
      <FilterBar dimensions={['reason']} value={{ reason: 'spam' }} busy={false} onChange={onChange} />,
    );
    await userEvent.click(screen.getByRole('button', { name: /清空筛选/ }));
    expect(onChange).toHaveBeenCalledWith({});
  });

  /** 加载中禁用：改筛选会发请求，连点会让几个请求的结果互相覆盖。 */
  it('busy 时下拉与清空都禁用', () => {
    render(
      <FilterBar dimensions={['reason']} value={{ reason: 'spam' }} busy={true} onChange={vi.fn()} />,
    );
    expect(screen.getByLabelText('举报原因')).toBeDisabled();
    expect(screen.getByRole('button', { name: /清空筛选/ })).toBeDisabled();
  });

  /**
   * 清空按钮上的计数只数**这个页面认的**维度。若 value 里带着别页留下的维度
   * （筛选器状态在切页时不重置的话会这样），不该把它算进来。
   */
  it('计数只数本页支持的维度', () => {
    render(
      <FilterBar
        dimensions={['reason']}
        value={{ reason: 'spam', action: 'report' }}
        busy={false}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: '清空筛选（1）' })).toBeInTheDocument();
  });
});
