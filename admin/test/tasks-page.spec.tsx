import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ERROR_CODES } from '@paws/types';
import { TasksPage } from '../src/pages/TasksPage';
import { ToastProvider } from '../src/components/Toast';
import { bodyOf, envelope, stubFetch, task, type FetchCall } from './helpers';

afterEach(() => {
  vi.unstubAllGlobals();
});

/** 工单页要靠 Toast 给反馈，所以测试里也得套上 provider。 */
function renderPage(onExpired = vi.fn()): { onExpired: ReturnType<typeof vi.fn> } {
  render(
    <ToastProvider>
      <TasksPage onExpired={onExpired} />
    </ToastProvider>,
  );
  return { onExpired };
}

function page(items: unknown[], hasMore = false, p = 1): string {
  return envelope({ items, hasMore, page: p });
}

describe('工单列表页', () => {
  it('把工单的正文与作者显示出来', async () => {
    stubFetch([page([task({ content: '这条动态被举报了', authorNickname: '小红' })])]);
    renderPage();
    expect(await screen.findByText('这条动态被举报了')).toBeInTheDocument();
    expect(screen.getByText('小红')).toBeInTheDocument();
  });

  it('举报原因显示成中文文案，不是枚举值', async () => {
    stubFetch([page([task({ reason: 'animal_abuse' })])]);
    renderPage();
    expect(await screen.findByText('虐待动物')).toBeInTheDocument();
    expect(screen.queryByText('animal_abuse')).toBeNull();
  });

  it('队列为空时说清楚是空的', async () => {
    stubFetch([page([])]);
    renderPage();
    expect(await screen.findByText(/队列是空的/)).toBeInTheDocument();
  });

  it('首屏按第一页拉取', async () => {
    const calls = stubFetch([page([])]);
    renderPage();
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(calls[0].url).toContain('page=1');
  });

  it('点「下一页」按第二页重新拉取', async () => {
    const calls = stubFetch([page([task()], true), page([task({ id: 't-2' })])]);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: '下一页' }));
    await waitFor(() => expect(calls.some((c) => c.url.includes('page=2'))).toBe(true));
  });

  /** 没有下一页时按钮必须禁用 —— 点下去只会拿到一页空列表。 */
  it('hasMore 为 false 时「下一页」禁用', async () => {
    stubFetch([page([task()], false)]);
    renderPage();
    expect(await screen.findByRole('button', { name: '下一页' })).toBeDisabled();
  });

  it('第一页时「上一页」禁用', async () => {
    stubFetch([page([task()], true)]);
    renderPage();
    expect(await screen.findByRole('button', { name: '上一页' })).toBeDisabled();
  });

  it('放行时发 approved，不带驳回原因', async () => {
    const calls = stubFetch([page([task()]), envelope({ taskId: 't-1', result: 'approved' }), page([])]);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: '举报不成立，保留' }));
    await waitFor(() => expect(resolveCall(calls)).toBeDefined());
    expect(bodyOf(resolveCall(calls) as FetchCall)).toEqual({ result: 'approved' });
  });

  /**
   * 撤下**必须先经过对话框**：服务端要求驳回带原因（那条 422），
   * 而点一下就提交会让人在毫无提示的情况下撞上它。
   */
  it('点「撤下」先弹出驳回原因对话框，不直接提交', async () => {
    const calls = stubFetch([page([task()])]);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: '举报成立，撤下' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(resolveCall(calls)).toBeUndefined();
  });

  it('原因为空时「确认撤下」不可点', async () => {
    stubFetch([page([task()])]);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: '举报成立，撤下' }));
    expect(screen.getByRole('button', { name: '确认撤下' })).toBeDisabled();
  });

  it('填了原因后提交，原因随请求发出', async () => {
    const calls = stubFetch([page([task()]), envelope({ taskId: 't-1', result: 'rejected' }), page([])]);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: '举报成立，撤下' }));
    await userEvent.type(screen.getByRole('textbox'), '辱骂他人');
    await userEvent.click(screen.getByRole('button', { name: '确认撤下' }));
    await waitFor(() => expect(resolveCall(calls)).toBeDefined());
    expect(bodyOf(resolveCall(calls) as FetchCall)).toEqual({
      result: 'rejected',
      rejectReason: '辱骂他人',
    });
  });

  /**
   * 复核成功后**重拉当前页**，不是只把那条从本地摘掉：队列在动，
   * 摘掉一条会让这一页少显示一条，而下一条本该从后面补上来。
   */
  it('复核成功后重新拉取当前页', async () => {
    const calls = stubFetch([page([task()]), envelope({ taskId: 't-1', result: 'approved' }), page([])]);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: '举报不成立，保留' }));
    await waitFor(() => expect(calls.filter((c) => c.url.includes('/moderation/tasks?')).length).toBe(2));
  });

  /** 并发败者（工单已被别人处理）也要刷新 —— 那条已经不该在这一页了。 */
  it('工单已被处理时提示并刷新列表', async () => {
    const calls = stubFetch([
      page([task()]),
      envelope(null, ERROR_CODES.MODERATION_TASK_HANDLED, '这条工单已被处理'),
      page([]),
    ]);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: '举报不成立，保留' }));
    expect(await screen.findByText('这条工单已被处理')).toBeInTheDocument();
    await waitFor(() => expect(calls.filter((c) => c.url.includes('/moderation/tasks?')).length).toBe(2));
  });

  it('加载失败时给出重试入口', async () => {
    stubFetch([envelope(null, ERROR_CODES.INTERNAL, '服务异常')], 500);
    renderPage();
    expect(await screen.findByText('服务异常')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
  });

  /** 401：本地会话已被 client 清掉，这里要把外壳的内存状态也同步掉。 */
  it('令牌失效时通知外壳', async () => {
    stubFetch([envelope(null, ERROR_CODES.UNAUTHORIZED, '登录已过期')], 401);
    const onExpired = vi.fn();
    renderPage(onExpired);
    await waitFor(() => expect(onExpired).toHaveBeenCalled());
  });

  it('点缩略图打开大图预览', async () => {
    stubFetch([page([task({ imageUrls: ['/uploads/u-1/a.jpg'] })])]);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: '放大查看这张图片' }));
    expect(screen.getByRole('dialog', { name: '图片预览' })).toBeInTheDocument();
  });

  it('图片类工单只显示被举报的那一张', async () => {
    stubFetch([page([task({ targetType: 'post_image', imageUrls: ['/uploads/u-1/only.jpg'] })])]);
    renderPage();
    expect(await screen.findAllByRole('button', { name: '放大查看这张图片' })).toHaveLength(1);
  });

  /**
   * UGC 一律走文本插值。这条断言的是「HTML 没有被当成标签解析」——
   * 后台的令牌就在 localStorage 里，一个 `dangerouslySetInnerHTML` 就能被读走。
   */
  it('正文里的 HTML 当文本显示，不解析成标签', async () => {
    stubFetch([page([task({ content: '<img src=x onerror=alert(1)>' })])]);
    renderPage();
    expect(await screen.findByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(document.querySelector('img[src="x"]')).toBeNull();
  });
});

/** 取那次复核请求。列表请求与它混在一起，按路径挑出来。 */
function resolveCall(calls: FetchCall[]): FetchCall | undefined {
  return calls.find((c) => c.url.includes('/resolve'));
}

/**
 * 图片取不到时的表现。
 *
 * 这一组存在的理由是一个真实的配置错误：`vite.config.ts` 起初只代理了 `/api`，
 * 而工单里的 `imageUrls` 是 `/uploads/...` —— 那些请求全打在 dev server 上拿 404，
 * **所有图都是碎图**。代理补上了，但「取不到」仍是待审图的常态（私有档只对作者
 * 开放，`<img>` 递不了 Authorization 头），所以界面必须说清这件事。
 */
describe('图片取不到时', () => {
  it('缩略图换成占位，不留浏览器的碎图图标', async () => {
    stubFetch([page([task({ imageUrls: ['/uploads/u-1/gone.jpg'] })])]);
    renderPage();
    const img = await screen.findByRole('button', { name: '放大查看这张图片' });
    fireEvent.error(img.querySelector('img') as HTMLImageElement);
    expect(await screen.findByRole('button', { name: /取不到/ })).toBeInTheDocument();
  });

  it('占位仍然可点，点开能看到原因说明', async () => {
    stubFetch([page([task({ imageUrls: ['/uploads/u-1/gone.jpg'] })])]);
    renderPage();
    const thumb = await screen.findByRole('button', { name: '放大查看这张图片' });
    fireEvent.error(thumb.querySelector('img') as HTMLImageElement);
    await userEvent.click(await screen.findByRole('button', { name: /取不到/ }));
    expect(screen.getByRole('dialog', { name: '图片预览' })).toBeInTheDocument();
  });

  it('大图加载失败时说明「待审图只有作者能取」，并把 URL 显示出来', async () => {
    stubFetch([page([task({ imageUrls: ['/uploads/u-1/pending.jpg'] })])]);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: '放大查看这张图片' }));
    fireEvent.error(screen.getByAltText('被举报的图片'));
    expect(await screen.findByText(/只有作者本人能取/)).toBeInTheDocument();
    expect(screen.getByText('/uploads/u-1/pending.jpg')).toBeInTheDocument();
  });

  /** 排错线索：图全打不开时，第一个要查的就是反向代理有没有转 `/uploads/`。 */
  it('失败说明里提到检查反向代理', async () => {
    stubFetch([page([task({ imageUrls: ['/uploads/u-1/pending.jpg'] })])]);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: '放大查看这张图片' }));
    fireEvent.error(screen.getByAltText('被举报的图片'));
    expect(await screen.findByText(/反向代理/)).toBeInTheDocument();
  });
});
