import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ModeratorGuard } from '../auth/moderator.guard';
import { parseListQuery } from '../common/list-query';
import {
  ModerationService,
  parseResolve,
  parseTargetRef,
  type AuditLogListResponse,
  type HandledTaskListResponse,
  type ResolveResponse,
  type TaskListResponse,
} from './moderation.service';

/**
 * 运营侧的审核端点（spec §4.4）。与 `/reports`（普通用户的举报入口）分开成两个
 * controller：**这一批每个端点都要 `ModeratorGuard`**，挤在一处迟早有人漏一个守卫。
 *
 * 守卫写在方法上而不是类上，是为了让「这个端点要运营权限」在每个方法处都看得见 ——
 * 类级守卫读代码时要往上翻，而漏掉的后果是运营端点对所有人开放。
 */
@Controller('moderation')
export class ModerationController {
  constructor(private readonly moderation: ModerationService) {}

  /** 待处理工单的一页，按创建时间正序（先举报的先处理）。 */
  @Get('tasks')
  @UseGuards(AuthGuard, ModeratorGuard)
  async tasks(@Query() query: Record<string, string | undefined>): Promise<TaskListResponse> {
    const { page, pageSize } = parseListQuery(query);
    return this.moderation.listTasks({ page, pageSize });
  }

  /**
   * **已处理**工单的一页，按处理时间倒序（最近判的在最前）。
   *
   * 路径是 `tasks/handled` 而不是给 `tasks` 加一个 `?status=` 参数：两者的排序相反、
   * 下发字段也不同（这条必带 `result` 与 `handledBy`）。一个端点两种形状会让
   * 客户端在每个字段上判空。
   *
   * 放在 `tasks` 之后、`tasks/:id/resolve` 之前都无所谓 —— 那条是 POST，
   * 而 Nest 按方法 + 路径匹配，`GET tasks/handled` 不会被它截走。
   */
  @Get('tasks/handled')
  @UseGuards(AuthGuard, ModeratorGuard)
  async handledTasks(
    @Query() query: Record<string, string | undefined>,
  ): Promise<HandledTaskListResponse> {
    const { page, pageSize } = parseListQuery(query);
    return this.moderation.listHandledTasks({ page, pageSize });
  }

  /**
   * 某条内容的完整审核历史，不分页。
   *
   * 与 `audit-logs` 分成两条路径而不是给它加可选的 `targetId`：那条是分页的全局
   * 视图（带操作人显示名），这条是单个目标的全量流水。混一个端点会让「分页参数
   * 在带 targetId 时被忽略」这种事变成可能。
   *
   * `actorName` 在这条路径上恒为 `null` —— 仓储的 `listByTarget` 不 JOIN users
   * （它的主调用点在复核流程里，那里不需要显示名）。客户端因此显示 `actorId`。
   */
  @Get('audit-logs/by-target')
  @UseGuards(AuthGuard, ModeratorGuard)
  async auditLogsByTarget(
    @Query() query: Record<string, string | undefined>,
  ): Promise<{ items: AuditLogListResponse['items'] }> {
    return this.moderation.listAuditLogsByTarget(parseTargetRef(query));
  }

  /**
   * 审核流水的一页，按时间倒序（最近的动作在最前）。
   *
   * 与 `tasks` 一样挂 `ModeratorGuard` —— 流水里有「谁撤下了什么」，那是内部信息。
   *
   * 只读：这张表没有写入端点，也不该有。流水由复核流程在自己的事务里追加
   * （Global Constraint 24），而仓储接口上压根没有 update / delete
   * （Global Constraint 25）。
   */
  @Get('audit-logs')
  @UseGuards(AuthGuard, ModeratorGuard)
  async auditLogs(
    @Query() query: Record<string, string | undefined>,
  ): Promise<AuditLogListResponse> {
    const { page, pageSize } = parseListQuery(query);
    return this.moderation.listAuditLogs({ page, pageSize });
  }

  /**
   * 复核一条工单。
   *
   * `@HttpCode(200)` 而不是 POST 的默认 201：复核没有新建任何资源，它是把一条
   * 既有工单关掉。并发的败者拿 422 `MODERATION_TASK_HANDLED`（不是 409）——
   * 客户端的处置是「刷新列表」，与其他 422 同一条分支。
   */
  @Post('tasks/:id/resolve')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, ModeratorGuard)
  async resolve(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() userId: string | null,
  ): Promise<ResolveResponse> {
    // 校验先行：非法入参不该走到仓储去拿票。
    return this.moderation.resolve(userId as string, id, parseResolve(body ?? {}));
  }
}
