import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ERROR_CODES, type UserRole } from '@paws/types';
import { sign } from 'jsonwebtoken';
import { ApiException } from '../common/api.exception';
import { USER_REPOSITORY, type UserRepository } from '../users/user.repository';
import { UsersService } from '../users/users.service';
import { WECHAT_SESSION_API, type WechatSessionApi } from '../wechat/wechat-api.service';
import { verifyPassword } from './password';

export interface LoginResult {
  token: string;
  userId: string;
  isNewUser: boolean;
}

/**
 * 运营登录的结果。
 *
 * `role` 只供后台**决定显示哪些菜单** —— 它不是权限判据：每个运营端点仍会用
 * `ModeratorGuard` 从库里查一次（Global Constraint 28）。下发它只是让前端
 * 少画一个它无权访问的入口。
 *
 * 刻意不含 `openid`（运营账号可能压根没有微信身份）也不含任何凭据字段。
 */
export interface AdminLoginResult {
  token: string;
  userId: string;
  role: UserRole;
}

/** 校验过的运营登录入参。 */
export interface AdminLoginBody {
  username: string;
  password: string;
}

/**
 * 运营登录的入参校验。
 *
 * 缺字段是 **422 而不是 401**：那是入参问题，不是凭据问题。混成 401 会让
 * 前端分不清「我漏传了字段」和「密码错了」。
 *
 * 这里**不校验密码长度** —— 长度规则是设密码时的约束（`hashPassword` 把关），
 * 登录时套上去只会让改规则后的老账号登不进来，还顺带泄露「密码规则是几位」。
 */
export function parseAdminLogin(body: Record<string, unknown>): AdminLoginBody {
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!username || !password) {
    throw new ApiException(
      ERROR_CODES.VALIDATION_FAILED,
      '请填写用户名与密码',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
  return { username, password };
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(WECHAT_SESSION_API) private readonly wechat: WechatSessionApi,
    private readonly users: UsersService,
    @Inject(USER_REPOSITORY) private readonly userRepo: UserRepository,
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

  /**
   * 运营后台的账号密码登录。
   *
   * **「用户名不存在」与「密码错误」必须无法区分** —— 两者收敛成同一个 401，
   * 文案一字不差。分开的话就能拿它枚举运营用户名，而运营账号数量少、
   * 名字有规律（ops-xxx），枚举出来就等于把爆破面缩到一个账号上。
   *
   * 令牌里**不带 role**（Global Constraint 28）：角色只从库里读，否则撤销运营
   * 权限要等到令牌过期才生效。这也是 `signToken` 能原样复用的原因 ——
   * 运营令牌与小程序令牌在结构上完全一致，区别只在库里那一列。
   *
   * `openid` 传空串：运营账号可能压根没有微信身份，而 `AuthGuard` 只在
   * `msgSecCheck` 那条路径上需要它（运营不发 UGC）。传空而不是省掉，
   * 是为了让令牌的形状与小程序那条一致 —— 少一个字段会让 `AuthGuard`
   * 里那句 `payload.openid ?? null` 走进不同的分支。
   */
  async loginWithPassword(body: AdminLoginBody): Promise<AdminLoginResult> {
    const credential = await this.userRepo.findCredentialByUsername(body.username);
    // 找不到用户名时**仍然**走一次密码校验的等价耗时？不 —— 这里刻意不做
    // 「假验一次」的时序对齐：scrypt 单次 50–100ms，而限流已经把爆破速率
    // 压到一小时 10 次，时序差异在这个速率下问不出东西。真要防时序，
    // 该做的是恒定时间的整条路径，那是另一个量级的工程。
    if (!credential) throw this.badCredentials();
    if (!(await verifyPassword(body.password, credential.passwordHash))) {
      throw this.badCredentials();
    }
    return {
      token: this.signToken(credential.userId, ''),
      userId: credential.userId,
      role: credential.role,
    };
  }

  /** 两种失败共用这一个 —— 分开写迟早分叉，而分叉就是枚举面。 */
  private badCredentials(): ApiException {
    return new ApiException(
      ERROR_CODES.UNAUTHORIZED,
      '用户名或密码不正确',
      HttpStatus.UNAUTHORIZED,
    );
  }
}
