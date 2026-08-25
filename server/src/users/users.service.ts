import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@paws/types';
import { ApiException } from '../common/api.exception';
import {
  USER_REPOSITORY,
  type UserProfile,
  type UserProfilePatch,
  type UserRecord,
  type UserRepository,
} from './user.repository';

/** 昵称上限，按码点数（spec §5.1 的「20 字」）。 */
export const NICKNAME_MAX_LENGTH = 20;

function fail(message: string): never {
  throw new ApiException(ERROR_CODES.VALIDATION_FAILED, message, HttpStatus.UNPROCESSABLE_ENTITY);
}

/**
 * PATCH /me 的请求体校验。返回的 patch 只含调用方真正给了的字段 ——
 * 缺字段与「显式给 null」是两回事，前者不动、后者清空。
 */
export function parseProfilePatch(body: Record<string, unknown>): UserProfilePatch {
  const patch: UserProfilePatch = {};

  if ('nickname' in body) {
    const raw = body.nickname;
    if (typeof raw !== 'string') fail('昵称必须是字符串');
    const nickname = raw.trim();
    // 长度按码点数：用 String.length 的话一个 emoji 顶两格，10 个 emoji 就被误杀。
    if (nickname.length === 0) fail('昵称不能为空');
    if ([...nickname].length > NICKNAME_MAX_LENGTH) fail(`昵称最多 ${NICKNAME_MAX_LENGTH} 个字`);
    patch.nickname = nickname;
  }

  if ('avatarUrl' in body) {
    const raw = body.avatarUrl;
    if (raw === null) {
      patch.avatarUrl = null;
    } else {
      if (typeof raw !== 'string') fail('头像地址必须是字符串或 null');
      const avatarUrl = raw.trim();
      // 只收 http(s) 绝对地址与站内路径（上传通道落的就是站内路径）；
      // data: / javascript: 这类既没法当图片存，也没有理由进库。
      if (!/^(https?:\/\/|\/)[^\s]*$/.test(avatarUrl)) fail('头像地址不合法');
      patch.avatarUrl = avatarUrl;
    }
  }

  // 一个可改字段都没给：客户端要么写错了字段名，要么发了空请求，静默 200 会让它更难查。
  if (patch.nickname === undefined && patch.avatarUrl === undefined) fail('没有需要更新的字段');
  return patch;
}

@Injectable()
export class UsersService {
  constructor(@Inject(USER_REPOSITORY) private readonly repo: UserRepository) {}

  /** openid 是唯一身份锚点，没有就建号。 */
  async upsertByOpenid(openid: string): Promise<{ user: UserRecord; isNewUser: boolean }> {
    const existing = await this.repo.findByOpenid(openid);
    if (existing) return { user: existing, isNewUser: false };
    return { user: await this.repo.create(openid), isNewUser: true };
  }

  async profile(userId: string): Promise<UserProfile> {
    const profile = await this.repo.findProfile(userId);
    // token 有效但人没了（换库、被清理）：报 404 而不是发一份空资料，
    // 空资料会让个人中心画出「0 只宠物」的假象。
    if (!profile) this.notFound();
    return profile;
  }

  async updateProfile(userId: string, patch: UserProfilePatch): Promise<UserProfile> {
    const updated = await this.repo.updateProfile(userId, patch);
    if (!updated) this.notFound();
    return updated;
  }

  private notFound(): never {
    throw new ApiException(ERROR_CODES.NOT_FOUND, '用户不存在', HttpStatus.NOT_FOUND);
  }
}
