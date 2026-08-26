import type { PetSummary } from '../shared/types/index';

/**
 * 「选一只自己的宠物」。
 *
 * 发布页要它（动态挂在宠物名下）、「我的动态」也要它（`GET /posts` 的 `petId` 必填，
 * 服务端没有全局信息流）。两个页面共用一份，是因为「刷新后选中项别乱跳」这条规则
 * 各写一遍必然分叉：一处保留、一处重置，用户会觉得列表在自己换宠物。
 *
 * 刻意只取 `id` 与 `name`：选择条上再多的字段都是白传进 `setData` 的数据。
 */

export interface PetOption {
  id: string;
  name: string;
}

export function buildPetOptions(items: PetSummary[]): PetOption[] {
  return items.map((pet) => ({ id: pet.id, name: pet.name }));
}

/**
 * 定下当前该选哪只：`preferred` 还在清单里就用它，否则退回第一只，一只都没有回空串。
 *
 * 空串是「没有可选的宠物」这个状态的唯一表示 —— 页面据此走「先建一只」的空态，
 * 而不是拿空 id 去请求一次注定 422 的列表。
 */
export function resolvePetId(options: PetOption[], preferred: string): string {
  if (preferred && options.some((option) => option.id === preferred)) return preferred;
  return options[0]?.id ?? '';
}
