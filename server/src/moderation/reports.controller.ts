import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ReportRateLimitGuard } from '../common/rate-limit/report-rate-limit.guard';
import { ModerationService, parseReport, type ReportResponse } from './moderation.service';

/**
 * 内容举报。**普通登录用户**的入口 —— 与 `/moderation/*`（运营侧，挂
 * `ModeratorGuard`）分开成两个 controller：两批端点的权限模型不同，
 * 挤在一处迟早有人往运营那批上漏一个守卫。
 */
@Controller('reports')
export class ReportsController {
  constructor(private readonly moderation: ModerationService) {}

  /**
   * 举报一条内容。
   *
   * `@HttpCode(200)` 而不是 Nest 给 POST 的默认 201：举报是**幂等**的
   * （Global Constraint 27），重复举报同一目标不产生新工单。201 Created
   * 会在「什么都没新建」的那一路上说谎，而客户端两条路走的是同一个分支。
   *
   * 两个守卫按顺序执行，`ReportRateLimitGuard` 必须排在 `AuthGuard` **之后** ——
   * 它按 `req.userId` 键控（举报的滥用单位是账号，不是 IP），而那个字段是
   * `AuthGuard` 挂上去的。限流的理由见守卫本身的注释：每成功一次举报，
   * 那条内容就立刻对所有人隐藏，不限流等于给每个账号一个批量下架按钮。
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, ReportRateLimitGuard)
  async report(
    @Body() body: Record<string, unknown>,
    @CurrentUser() userId: string | null,
  ): Promise<ReportResponse> {
    // 校验先行：非法入参不该走到仓储去改状态。
    return this.moderation.report(userId as string, parseReport(body ?? {}));
  }
}
