import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ERROR_CODES } from '@paws/types';
import { HistoryDialog } from '../src/components/HistoryDialog';
import { auditLog, envelope, stubFetch } from './helpers';

afterEach(() => {
  vi.unstubAllGlobals();
});

const open = (onClose = vi.fn()): ReturnType<typeof vi.fn> => {
  render(<HistoryDialog targetType="post" targetId="p-1" onClose={onClose} />);
  return onClose;
};

describe('审核历史对话框', () => {
  it('按目标类型与 id 拉取，不带分页参数', async () => {
    const calls = stubFetch([envelope({ items: [] })]);
    open();
    await waitFor(() => expect(calls.length).toBe(1));
    expect(calls[0].url).toContain('/moderation/audit-logs/by-target?');
    expect(calls[0].url).toContain('targetType=post');
    expect(calls[0].url).toContain('targetId=p-1');
    // 不分页 —— 一条内容的流水撑不到要分页。
    expect(calls[0].url).not.toContain('pageSize');
  });

  it('按顺序列出每条动作与状态变化', async () => {
    stubFetch([
      envelope({
        items: [
          auditLog({ id: 'a', action: 'review_reject', statusBefore: 'pending_review', statusAfter: 'rejected' }),
          auditLog({ id: 'b', action: 'report', statusBefore: 'approved', statusAfter: 'pending_review' }),
        ],
      }),
    ]);
    open();
    expect(await screen.findByText('复核撤下')).toBeInTheDocument();
    expect(screen.getByText('用户举报')).toBeInTheDocument();
    expect(screen.getByText('pending_review → rejected')).toBeInTheDocument();
  });

  /**
   * 这条路径的 `actorName` 恒为 null（服务端不 JOIN users），所以显示的是 id。
   * 断言它**显示了 id** 而不是一个空位 —— 空位会让人以为数据缺了。
   */
  it('操作人显示 id（这条路径不下发显示名）', async () => {
    stubFetch([envelope({ items: [auditLog({ actorId: 'u-mod', actorName: null })] })]);
    open();
    expect(await screen.findByText(/操作人 u-mod/)).toBeInTheDocument();
  });

  it('机审的流水标成系统', async () => {
    stubFetch([envelope({ items: [auditLog({ actorId: null, actorName: null, action: 'auto_reject' })] })]);
    open();
    expect(await screen.findByText(/系统（机审）/)).toBeInTheDocument();
  });

  it('没有流水时说清是空的，不是加载中', async () => {
    stubFetch([envelope({ items: [] })]);
    open();
    expect(await screen.findByText(/还没有任何审核动作/)).toBeInTheDocument();
  });

  it('加载失败时显示服务端的报错', async () => {
    stubFetch([envelope(null, ERROR_CODES.INTERNAL, '服务异常')], 500);
    open();
    expect(await screen.findByText('服务异常')).toBeInTheDocument();
  });

  it('点关闭按钮回调 onClose', async () => {
    stubFetch([envelope({ items: [] })]);
    const onClose = open();
    await userEvent.click(await screen.findByRole('button', { name: '关闭' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('按 Esc 关闭', async () => {
    stubFetch([envelope({ items: [] })]);
    const onClose = open();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  /** 点内容区不该关掉 —— 里面有要读的东西（同 RejectDialog 的理由）。 */
  it('点对话框内部不关闭', async () => {
    stubFetch([envelope({ items: [auditLog()] })]);
    const onClose = open();
    await userEvent.click(await screen.findByText('复核撤下'));
    expect(onClose).not.toHaveBeenCalled();
  });
});
