import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@paws/types';
import { verify } from 'jsonwebtoken';
import { ApiException } from '../common/api.exception';

/** 受保护端点：要求合法 Bearer JWT，把 payload.sub 挂到 req.userId；否则 401。 */
@Injectable()
export class AuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{ userId?: string | null; headers: Record<string, string | undefined> }>();
    const auth = req.headers.authorization ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) {
      throw new ApiException(ERROR_CODES.UNAUTHORIZED, undefined, HttpStatus.UNAUTHORIZED);
    }
    try {
      const secret = process.env.JWT_SECRET;
      if (!secret) throw new Error('缺少环境变量 JWT_SECRET');
      const payload = verify(token, secret) as { sub?: string };
      if (!payload.sub) {
        throw new ApiException(ERROR_CODES.UNAUTHORIZED, undefined, HttpStatus.UNAUTHORIZED);
      }
      req.userId = payload.sub;
      return true;
    } catch {
      throw new ApiException(ERROR_CODES.UNAUTHORIZED, undefined, HttpStatus.UNAUTHORIZED);
    }
  }
}
