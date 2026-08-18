import { Controller, Get, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ERROR_CODES } from '@paws/types';
import { AppModule } from '../src/app.module';
import { ApiException } from '../src/common/api.exception';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter';
import { ResponseInterceptor } from '../src/common/response.interceptor';

/** 只在测试里挂的抛错路由，生产代码不留调试端点。 */
@Controller('__test')
class ThrowController {
  @Get('api-error')
  apiError(): never {
    throw new ApiException(ERROR_CODES.VALIDATION_FAILED, '犬证编号格式不正确', 422);
  }

  @Get('crash')
  crash(): never {
    throw new Error('数据库连了个空气');
  }
}

describe('响应信封', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ThrowController],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('成功响应包成 code 0 信封', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body).toEqual({ code: 0, message: 'ok', data: { status: 'up' } });
  });

  it('未命中路由映射为 40400 + 中文文案，HTTP 状态仍是 404', async () => {
    const res = await request(app.getHttpServer()).get('/nope').expect(404);
    expect(res.body.code).toBe(ERROR_CODES.NOT_FOUND);
    expect(res.body.message).toBe('内容不存在或已删除');
    expect(res.body.data).toBeNull();
  });

  it('ApiException 保留业务码与服务端自定义文案', async () => {
    const res = await request(app.getHttpServer()).get('/__test/api-error').expect(422);
    expect(res.body).toEqual({
      code: ERROR_CODES.VALIDATION_FAILED,
      message: '犬证编号格式不正确',
      data: null,
    });
  });

  it('未预期异常收敛为 50000，响应体不泄漏内部细节', async () => {
    const res = await request(app.getHttpServer()).get('/__test/crash').expect(500);
    expect(res.body.code).toBe(ERROR_CODES.INTERNAL);
    expect(res.body.message).toBe('服务异常，请稍后再试');
    expect(JSON.stringify(res.body)).not.toContain('数据库连了个空气');
  });
});
