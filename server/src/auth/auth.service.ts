import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@paws/types';
import { sign } from 'jsonwebtoken';
import { ApiException } from '../common/api.exception';
import { UsersService } from '../users/users.service';
import { WECHAT_SESSION_API, type WechatSessionApi } from '../wechat/wechat-api.service';

export interface LoginResult {
  token: string;
  userId: string;
  isNewUser: boolean;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(WECHAT_SESSION_API) private readonly wechat: WechatSessionApi,
    private readonly users: UsersService,
  ) {}

  async loginWithCode(code: string): Promise<LoginResult> {
    if (!code) {
      throw new ApiException(
        ERROR_CODES.VALIDATION_FAILED,
        '缺少登录凭证 code',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    // session_key 阶段 0 用不到（解手机号才需要），拿到即丢，不落库。
    const { openid } = await this.wechat.code2Session(code);
    const { user, isNewUser } = await this.users.upsertByOpenid(openid);
    return { token: this.signToken(user.id, openid), userId: user.id, isNewUser };
  }

  private signToken(userId: string, openid: string): string {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error('缺少环境变量 JWT_SECRET');
    return sign({ openid }, secret, {
      subject: userId,
      expiresIn: Number(process.env.JWT_TTL_SECONDS ?? 604800),
    });
  }
}
