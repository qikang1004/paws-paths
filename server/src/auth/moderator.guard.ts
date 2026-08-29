import { CanActivate, ExecutionContext, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@paws/types';
import { ApiException } from '../common/api.exception';
import { USER_REPOSITORY, type UserRepository } from '../users/user.repository';

/**
 * 运营端点的第二道守卫（spec §3.1 的 RBAC）。
 *
 * **不重新验签**：用法一律是 `@UseGuards(AuthGuard, ModeratorGuard)`，Nest 的守卫
 * 数组顺序执行，`AuthGuard` 已经验过签并把 `req.userId` 挂好了，前一个抛出后一个
 * 压根不跑。所以这里没有令牌处理代码 —— 少一份验签逻辑就少一处会分叉的地方。
 *
 * 角色**只从库里读**（Global Constraint 28）。令牌里若带着 `role` 声明，一概无视：
 * 令牌是阶段 0 签的、里面本来没有角色字段，而把角色塞进令牌会让「撤销运营权限」
 * 要等到令牌过期才生效。代价是每次请求多一次 O(1) 查询，换即时可撤销。
 */
@Injectable()
export class ModeratorGuard implements CanActivate {
  constructor(@Inject(USER_REPOSITORY) private readonly users: UserRepository) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{ userId?: string | null }>();
    const userId = req.userId;
    // 没有 userId 说明 AuthGuard 没挂在前面 —— 那是配线错误，不是权限不足。
    // 仍然按 401 处理：这条路径上放行才是真正危险的那个选择。
    if (!userId) {
      throw new ApiException(ERROR_CODES.UNAUTHORIZED, undefined, HttpStatus.UNAUTHORIZED);
    }

    const role = await this.users.findRole(userId);
    // 查不到这个人也是 403，不是 500 —— 令牌验过签、`sub` 在库里没有对应行，
    // 那是「这个身份没有运营权限」，与普通用户同一个响应。
    if (!role || !ELEVATED.has(role)) {
      throw new ApiException(ERROR_CODES.FORBIDDEN, '没有权限', HttpStatus.FORBIDDEN);
    }
    return true;
  }
}

/**
 * 放行的两个角色。`admin` 是 `moderator` 的超集 —— 不做「角色等级」那套比较，
 * 一个显式集合看一眼就知道谁能进，加角色时也不会有人把不等号写反。
 */
const ELEVATED: ReadonlySet<string> = new Set(['moderator', 'admin']);
