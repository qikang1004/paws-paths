import { HttpStatus } from '@nestjs/common';
import { ERROR_CODES } from '@paws/types';
import { ApiException } from './api.exception';

function fail(message: string): never {
  throw new ApiException(ERROR_CODES.VALIDATION_FAILED, message, HttpStatus.UNPROCESSABLE_ENTITY);
}

function optionalNumber(raw: string | undefined): number | undefined {
  if (raw == null || raw === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * 分页与坐标的入参校验，列表端点共用一套规则。
 *
 * 放进 common 而不是继续留在 `MeController` 里：动态列表（`GET /posts`）也要它，
 * 而让动态域去 import 一个 controller 文件，等于把「当前用户的数据」那一域
 * 拖进自己的依赖里。规则只有一份，改上限时不必找齐所有抄本。
 */
export function parseListQuery(q: Record<string, string | undefined>): {
  page: number;
  pageSize: number;
  lat?: number;
  lng?: number;
} {
  const page = optionalNumber(q.page) ?? 1;
  if (!Number.isInteger(page) || page < 1) fail('非法的页码');

  const pageSize = optionalNumber(q.pageSize) ?? 10;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 20) fail('非法的页大小');

  const lat = optionalNumber(q.lat);
  const lng = optionalNumber(q.lng);
  if (lat == null !== (lng == null)) fail('经纬度必须成对提供');
  if (lat != null && (lat < -90 || lat > 90 || (lng as number) < -180 || (lng as number) > 180)) {
    fail('非法坐标');
  }
  return { page, pageSize, lat, lng };
}
