import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { verify } from 'jsonwebtoken';

/**
 * 匿名可访问端点：有合法 token 则挂 req.userId，无/坏 token 置 null 并放行
 * （浏览接口用，供 isFavorite 等个性化字段消费）。
 */
@Injectable()
export class OptionalAuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{ userId?: string | null; headers: Record<string, string | undefined> }>();
    const auth = req.headers.authorization ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    req.userId = null;
    if (!token) return true;
    try {
      const secret = process.env.JWT_SECRET;
      if (!secret) return true;
      const payload = verify(token, secret) as { sub?: string };
      if (payload.sub) req.userId = payload.sub;
    } catch {
      // 坏 token 视为匿名
    }
    return true;
  }
}
