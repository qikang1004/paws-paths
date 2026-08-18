import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  /** 云托管探活端点，不查数据库，只证明进程能响应。 */
  @Get()
  check(): { status: string } {
    return { status: 'up' };
  }
}
