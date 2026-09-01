import type {
  AuditLogDto,
  HandledTaskDto,
  ModerationTargetType,
  ModerationTaskDto,
  UserRole,
} from '@paws/types';
import { api } from './client';

/** `GET /moderation/tasks` 的一页。形状与服务端的 `TaskListResponse` 一致。 */
export interface TaskPage {
  items: ModerationTaskDto[];
  hasMore: boolean;
  page: number;
}

/** `POST /auth/admin-login` 的响应（服务端的 `AdminLoginResult`）。 */
export interface AdminLoginResult {
  token: string;
  userId: string;
  role: UserRole;
}

export function adminLogin(username: string, password: string): Promise<AdminLoginResult> {
  return api.post<AdminLoginResult>('/auth/admin-login', { username, password });
}

/**
 * 待复核工单的一页。
 *
 * `pageSize` 的上限是服务端定的 20（`parseListQuery`），传更大的值会 422 ——
 * 所以这里不给调用方留一个会被拒的参数，页大小固定。
 */
export const PAGE_SIZE = 20;

export function fetchTasks(page: number): Promise<TaskPage> {
  return api.get<TaskPage>(`/moderation/tasks?page=${page}&pageSize=${PAGE_SIZE}`);
}

/** 复核结论。`approved` = 举报不成立、恢复可见；`rejected` = 举报成立、撤下。 */
export type ResolveResult = 'approved' | 'rejected';

export interface ResolveResponse {
  taskId: string;
  result: ResolveResult;
}

/**
 * 复核一条工单。`rejectReason` 只在驳回时带 —— 放行时服务端会把它丢掉
 * （`parseResolve`），传了只会让人以为放行也能写备注。
 */
export function resolveTask(
  taskId: string,
  result: ResolveResult,
  rejectReason?: string,
): Promise<ResolveResponse> {
  return api.post<ResolveResponse>(`/moderation/tasks/${encodeURIComponent(taskId)}/resolve`, {
    result,
    ...(result === 'rejected' ? { rejectReason } : {}),
  });
}

/** `GET /moderation/audit-logs` 的一页。 */
export interface AuditLogPage {
  items: AuditLogDto[];
  hasMore: boolean;
  page: number;
}

/**
 * 审核流水的一页，按时间倒序。
 *
 * 与工单列表共用 `PAGE_SIZE`（服务端两条端点走的是同一个 `parseListQuery`，
 * 上限都是 20）。
 */
export function fetchAuditLogs(page: number): Promise<AuditLogPage> {
  return api.get<AuditLogPage>(`/moderation/audit-logs?page=${page}&pageSize=${PAGE_SIZE}`);
}

/** `GET /moderation/tasks/handled` 的一页。 */
export interface HandledTaskPage {
  items: HandledTaskDto[];
  hasMore: boolean;
  page: number;
}

/** 已处理工单的一页，按处理时间倒序（最近判的在最前）。 */
export function fetchHandledTasks(page: number): Promise<HandledTaskPage> {
  return api.get<HandledTaskPage>(`/moderation/tasks/handled?page=${page}&pageSize=${PAGE_SIZE}`);
}

/**
 * 某条内容的完整审核历史。**不分页** —— 一条内容的流水撑不到要分页
 * （举报一条、复核一条，机审最多再两条）。
 *
 * 这条路径下发的 `actorName` 恒为 `null`（服务端的 `listByTarget` 不 JOIN users），
 * 所以调用方要按 `actorId` 显示，不能指望有名字。
 */
export function fetchTargetHistory(
  targetType: ModerationTargetType,
  targetId: string,
): Promise<{ items: AuditLogDto[] }> {
  const query = new URLSearchParams({ targetType, targetId });
  return api.get<{ items: AuditLogDto[] }>(`/moderation/audit-logs/by-target?${query}`);
}
