import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sign } from 'jsonwebtoken';
import { Pool } from 'pg';
import request from 'supertest';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter';
import { ResponseInterceptor } from '../src/common/response.interceptor';
import { MeModule } from '../src/me/me.module';
import { PetsModule } from '../src/pets/pets.module';
import { UsersService } from '../src/users/users.service';

/**
 * `GET /me/pets` —— 「我的宠物」。
 *
 * 这个端点是计划外补的（Task 15 的偏差，已记入 phase2-notes.md）：发布页要选宠物、
 * 「我的动态」要按宠物取动态，而既有的 `GET /pets` 是广场那个公开列表
 * （筛封面、过滤 visibility、分页），两个消费者都用不了。
 *
 * 三条断言是它存在的理由：只回自己的、**没照片的也回**、新建的排最前。
 */
describe('我的宠物（GET /me/pets）', () => {
  let app: INestApplication;
  let token: string;
  let otherToken: string;
  let userId: string;

  const OPENID = 'openid-u-test-mypets';
  const OTHER_OPENID = 'openid-u-test-mypets-other';
  const DB_URL = process.env.DATABASE_URL;
  let pool: Pool | null = null;

  const myPets = () => request(app.getHttpServer()).get('/me/pets');
  const auth = (req: request.Test, t = token) => req.set('Authorization', `Bearer ${t}`);

  const purge = async (): Promise<void> => {
    if (!pool) return;
    await pool.query(
      `DELETE FROM pets WHERE owner_id IN (SELECT id FROM users WHERE openid = ANY($1))`,
      [[OPENID, OTHER_OPENID]],
    );
    await pool.query(`DELETE FROM users WHERE openid = ANY($1)`, [[OPENID, OTHER_OPENID]]);
  };

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret';
    if (DB_URL) {
      pool = new Pool({ connectionString: DB_URL, max: 2 });
      await purge();
    }
    // PetsModule 一起 import：建宠物走 `POST /pets`（真实写路径），
    // 无库模式下内存仓储只有走同一个实例才看得见新建的行。
    const moduleRef = await Test.createTestingModule({ imports: [MeModule, PetsModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    const users = app.get(UsersService);
    const { user } = await users.upsertByOpenid(OPENID);
    userId = user.id;
    token = sign({ openid: OPENID }, 'test-secret', { subject: userId });
    const { user: other } = await users.upsertByOpenid(OTHER_OPENID);
    otherToken = sign({ openid: OTHER_OPENID }, 'test-secret', { subject: other.id });
  });

  afterAll(async () => {
    await app.close();
    if (pool) {
      await purge();
      await pool.end();
    }
  });

  const createPet = async (name: string, t = token): Promise<string> => {
    const res = await auth(
      request(app.getHttpServer()).post('/pets').send({ name, species: 'cat' }),
      t,
    ).expect(201);
    return res.body.data.id as string;
  };

  it('未登录 401', async () => {
    await myPets().expect(401);
  });

  it('新号：空清单，不是 404', async () => {
    const res = await auth(myPets()).expect(200);
    expect(res.body.code).toBe(0);
    expect(res.body.data).toEqual({ items: [] });
  });

  it('刻意不分页：没有 hasMore / page 两个字段', async () => {
    const res = await auth(myPets()).expect(200);
    expect(Object.keys(res.body.data)).toEqual(['items']);
  });

  describe('建了宠物之后', () => {
    let firstId: string;
    let secondId: string;

    beforeAll(async () => {
      firstId = await createPet('先建的');
      // 两次建号的 created_at 可能落在同一毫秒上，排序就靠不住了。
      await new Promise((resolve) => setTimeout(resolve, 20));
      secondId = await createPet('后建的');
      await createPet('别人的猫', otherToken);
    });

    it('只回自己的宠物，别人的不在里面', async () => {
      const res = await auth(myPets()).expect(200);
      const ids = res.body.data.items.map((p: { id: string }) => p.id);
      expect(ids).toContain(firstId);
      expect(ids).toContain(secondId);
      expect(res.body.data.items.every((p: { name: string }) => p.name !== '别人的猫')).toBe(true);
    });

    it('刚建好、还没传照片的宠物也在清单里（否则主人没有入口去传第一张）', async () => {
      const res = await auth(myPets()).expect(200);
      const fresh = res.body.data.items.find((p: { id: string }) => p.id === secondId);
      // `GET /pets` 那个 INNER JOIN 会把它漏掉；这里必须看得见，封面留空串。
      expect(fresh).toBeDefined();
      expect(fresh.coverUrl).toBe('');
      expect(fresh.coverWidth).toBe(0);
      expect(fresh.coverHeight).toBe(0);
    });

    it('新建的排最前', async () => {
      const res = await auth(myPets()).expect(200);
      const ids = res.body.data.items.map((p: { id: string }) => p.id);
      expect(ids.indexOf(secondId)).toBeLessThan(ids.indexOf(firstId));
    });

    it('卡片形状与广场一致：距离一律 null，isFollowing 恒为 false', async () => {
      const res = await auth(myPets()).expect(200);
      for (const pet of res.body.data.items) {
        expect(pet.distanceMeters).toBeNull();
        // 关注自己的宠物是 422（FOLLOW_SELF），所以这张清单上不可能有 true。
        expect(pet.isFollowing).toBe(false);
        expect(pet).toHaveProperty('personalityTags');
        expect(pet).toHaveProperty('ownerNickname');
      }
    });

    it('别人的号看到的是他自己那只，互不串号', async () => {
      const res = await auth(myPets(), otherToken).expect(200);
      const names = res.body.data.items.map((p: { name: string }) => p.name);
      expect(names).toEqual(['别人的猫']);
    });
  });
});
