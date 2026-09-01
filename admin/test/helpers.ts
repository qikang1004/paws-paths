import { vi } from 'vitest';
import type { ModerationTaskDto } from '@paws/types';

/** 服务端的统一包络。测试里造响应一律经过它，别各处手拼 JSON。 */
export function envelope(data: unknown, code = 0, message = 'ok'): string {
  return JSON.stringify({ code, message, data });
}

/**
 * 一条工单的默认形状，字段可覆盖。
 *
 * 有了它，用例里只写「与这条断言相关的那一两个字段」，读的人一眼看出重点。
 */
export function task(over: Partial<ModerationTaskDto> = {}): ModerationTaskDto {
  return {
    id: 't-1',
    targetType: 'post',
    targetId: 'p-1',
    source: 'user_report',
    reason: 'abuse',
    createdAt: '2026-08-30T02:00:00.000Z',
    content: '一条被举报的动态',
    imageUrls: [],
    authorNickname: '小明',
    ...over,
  };
}

/**
 * 把 `fetch` 换成按调用顺序返回预设响应的替身，并记下每次的入参。
 *
 * 记入参是关键：这一层测试的价值在于「前端有没有按约定发请求」——
 * 令牌带没带、页码传没传、驳回原因在放行时有没有被去掉。
 */
export interface FetchCall {
  url: string;
  init: RequestInit;
}

export function stubFetch(bodies: string[], status = 200): FetchCall[] {
  const calls: FetchCall[] = [];
  let i = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit = {}) => {
      calls.push({ url, init });
      const body = bodies[Math.min(i, bodies.length - 1)];
      i += 1;
      return Promise.resolve(new Response(body, { status }));
    }),
  );
  return calls;
}

/** 取某次调用的请求体（已解析）。断言 `rejectReason` 之类的字段时用。 */
export function bodyOf(call: FetchCall): Record<string, unknown> {
  return JSON.parse(String(call.init.body ?? '{}'));
}
