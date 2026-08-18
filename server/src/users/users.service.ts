import { Inject, Injectable } from '@nestjs/common';
import { USER_REPOSITORY, type UserRecord, type UserRepository } from './user.repository';

@Injectable()
export class UsersService {
  constructor(@Inject(USER_REPOSITORY) private readonly repo: UserRepository) {}

  /** openid 是唯一身份锚点，没有就建号。 */
  async upsertByOpenid(openid: string): Promise<{ user: UserRecord; isNewUser: boolean }> {
    const existing = await this.repo.findByOpenid(openid);
    if (existing) return { user: existing, isNewUser: false };
    return { user: await this.repo.create(openid), isNewUser: true };
  }
}
