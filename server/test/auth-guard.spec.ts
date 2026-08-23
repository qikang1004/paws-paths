import { Controller, Get, INestApplication, UseGuards } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sign } from 'jsonwebtoken';
import request from 'supertest';
import { ERROR_CODES } from '@paws/types';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter';
import { ResponseInterceptor } from '../src/common/response.interceptor';
import { AuthGuard } from '../src/auth/auth.guard';
import { CurrentUser } from '../src/auth/current-user.decorator';
import { OptionalAuthGuard } from '../src/auth/optional-auth.guard';

@Controller('dummy')
class DummyController {
  @Get('required')
  @UseGuards(AuthGuard)
  required(@CurrentUser() userId: string | null): { userId: string | null } {
    return { userId };
  }

  @Get('optional')
  @UseGuards(OptionalAuthGuard)
  optional(@CurrentUser() userId: string | null): { userId: string | null } {
    return { userId };
  }
}

describe('AuthGuard / OptionalAuthGuard / @CurrentUser', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret';
    const moduleRef = await Test.createTestingModule({
      controllers: [DummyController],
      providers: [AuthGuard, OptionalAuthGuard],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const validToken = sign({ openid: 'openid-x' }, 'test-secret', {
    subject: 'u-1',
    expiresIn: 3600,
  });

  it('required：无 token → 401 + UNAUTHORIZED', async () => {
    const res = await request(app.getHttpServer()).get('/dummy/required').expect(401);
    expect(res.body.code).toBe(ERROR_CODES.UNAUTHORIZED);
  });

  it('required：坏 token → 401', async () => {
    const res = await request(app.getHttpServer())
      .get('/dummy/required')
      .set('Authorization', 'Bearer garbage')
      .expect(401);
    expect(res.body.code).toBe(ERROR_CODES.UNAUTHORIZED);
  });

  it('required：合法 token → 200 + userId', async () => {
    const res = await request(app.getHttpServer())
      .get('/dummy/required')
      .set('Authorization', `Bearer ${validToken}`)
      .expect(200);
    expect(res.body.code).toBe(0);
    expect(res.body.data).toEqual({ userId: 'u-1' });
  });

  it('optional：无 token → 200 + null（不 401）', async () => {
    const res = await request(app.getHttpServer()).get('/dummy/optional').expect(200);
    expect(res.body.data).toEqual({ userId: null });
  });

  it('optional：坏 token → 200 + null（不 401）', async () => {
    const res = await request(app.getHttpServer())
      .get('/dummy/optional')
      .set('Authorization', 'Bearer garbage')
      .expect(200);
    expect(res.body.data).toEqual({ userId: null });
  });

  it('optional：合法 token → 200 + userId', async () => {
    const res = await request(app.getHttpServer())
      .get('/dummy/optional')
      .set('Authorization', `Bearer ${validToken}`)
      .expect(200);
    expect(res.body.data).toEqual({ userId: 'u-1' });
  });
});
