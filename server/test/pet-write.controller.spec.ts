import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sign } from 'jsonwebtoken';
import { Pool } from 'pg';
import request from 'supertest';
import { ERROR_CODES } from '@paws/types';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter';
import { ResponseInterceptor } from '../src/common/response.interceptor';
import { MeModule } from '../src/me/me.module';
import { PetsModule } from '../src/pets/pets.module';
import { UsersService } from '../src/users/users.service';

/**
 * 宠物增改：`POST /pets`、`PATCH /pets/:id`、`DELETE /pets/:id` 与照片增删。
 *
 * 归属判定一律走 `PetRepository.findOwnerId`（不过滤 visibility，私密宠物的主人也要能改），
 * 改别人的宠物报 403 而不是 404 —— 宠物本来就在广场上公开可见，用 404 假装它不存在藏不住什么。
 *
 * 每个用例建的宠物都在 afterEach 里按 id 删掉：`GET /pets` 的「8 只」断言
 * （pets.controller.spec.ts、pets-postgres.integration.spec.ts）数的是**全表**公开宠物，
 * 漏一只没删就会把那两个套件带崩。
 */
describe('宠物增改（POST /pets + PATCH/DELETE /pets/:id + 照片）', () => {
  // 有库时这个套件是最话痨的一个：一个用例动辄二三十次往返，而远程库热连接
  // 单次往返实测 ~200ms（首次含连接 ~1s）—— Jest 默认的 5000ms 兜不住，
  // 超时会随机落在不同用例上。同 rate-limit-degradation.integration.spec.ts 的 30_000。
  jest.setTimeout(30_000);

  let app: INestApplication;
  let token: string;
  let ownerId: string;

  /** 专属主人，经 UsersService 建号：`pets.owner_id` 有外键，主人必须真的存在。 */
  const OPENID = 'openid-u-test-pet-write';
  /** 「别人」：种子用户 `u-1`，拥有 `p-1` 和照片 `ph-1`。 */
  const OTHERS_PET = 'p-1';
  /** 种子宠物都在这一带，建的宠物也放这儿，好落进同一页广场列表。 */
  const CENTER = { lat: 39.905, lng: 116.406 };

  const DB_URL = process.env.DATABASE_URL;
  const describeDb = DB_URL ? describe : describe.skip;
  let pool: Pool | null = null;

  const http = () => request(app.getHttpServer());
  const auth = (req: request.Test) => req.set('Authorization', `Bearer ${token}`);
  /** u-1 的 token：用来验「别人改我的宠物」这个方向也是 403。 */
  const otherToken = () => sign({ openid: 'openid-huang' }, 'test-secret', { subject: 'u-1' });
  const asOther = (req: request.Test) => req.set('Authorization', `Bearer ${otherToken()}`);

  /**
   * 有库时清掉这个主人名下的一切。顺序是多态表 → 照片 → 宠物：
   * `pet_photos.pet_id` 是阶段 1 建的外键，**没有** ON DELETE CASCADE，
   * 先删宠物会直接撞约束（follows / posts 那几张阶段 2 的表才有级联）；
   * 而 favorites / view_history 是多态表，压根挂不上外键，只能按 target_id 手清。
   */
  const purge = async (): Promise<void> => {
    if (!pool) return;
    const owner = `(SELECT id FROM users WHERE openid = $1)`;
    const ownedPets = `(SELECT id FROM pets WHERE owner_id IN ${owner})`;
    // 多态表先清：favorites / view_history 的 target_id 上挂不了外键，
    // 删了宠物它们也不会跟着走，孤儿行会把别的套件的收藏数撑高。
    await pool.query(
      `DELETE FROM favorites WHERE target_type = 'pet' AND target_id IN ${ownedPets}`,
      [OPENID],
    );
    await pool.query(
      `DELETE FROM view_history WHERE target_type = 'pet' AND target_id IN ${ownedPets}`,
      [OPENID],
    );
    await pool.query(`DELETE FROM pet_photos WHERE pet_id IN ${ownedPets}`, [OPENID]);
    await pool.query(`DELETE FROM pets WHERE owner_id IN ${owner}`, [OPENID]);
  };

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret';
    if (DB_URL) {
      pool = new Pool({ connectionString: DB_URL, max: 2 });
      // 上一轮崩在中途的话，残留的宠物会把别的套件的「8 只」断言带崩。
      await purge();
    }
    const moduleRef = await Test.createTestingModule({ imports: [PetsModule, MeModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    // 建号发的是随机 id，token 必须等建完号才能签（同 profile.controller.spec.ts）。
    const { user } = await app.get(UsersService).upsertByOpenid(OPENID);
    ownerId = user.id;
    token = sign({ openid: OPENID }, 'test-secret', { subject: ownerId });
  });

  afterAll(async () => {
    await app.close();
    if (pool) {
      await purge();
      await pool.query(`DELETE FROM users WHERE openid = $1`, [OPENID]);
      await pool.end();
    }
  });

  /** 用例建的宠物记在这里，afterEach 逐个删掉 —— 见文件头注释。 */
  const created: string[] = [];
  /** 用例里自己删掉的宠物从待清理名单里划掉，免得 afterEach 再删一次收 404。 */
  const forget = (id: string): void => {
    const at = created.indexOf(id);
    if (at >= 0) created.splice(at, 1);
  };

  const create = async (body: Record<string, unknown>): Promise<request.Response> => {
    const res = await auth(http().post('/pets')).send(body);
    if (res.status === 201) created.push(res.body.data.id);
    return res;
  };

  /** 建一只在广场中心、带一张照片（即有封面）的宠物，返回 id。 */
  const createWithPhoto = async (): Promise<string> => {
    const res = await create({ name: '小新', species: 'dog', ...CENTER });
    expect(res.status).toBe(201);
    const id = res.body.data.id as string;
    await auth(http().post(`/pets/${id}/photos`))
      .send({ url: 'https://picsum.photos/seed/paws-new/600/800', width: 600, height: 800 })
      .expect(201);
    return id;
  };

  afterEach(async () => {
    for (const id of created.splice(0)) {
      await auth(http().delete(`/pets/${id}`));
    }
  });

  describe('POST /pets', () => {
    it('未登录 401', async () => {
      const res = await http().post('/pets').send({ name: '小新', species: 'dog' }).expect(401);
      expect(res.body.code).toBe(ERROR_CODES.UNAUTHORIZED);
    });

    it('只给名字与物种就能建号：返回 id，其余字段落默认值', async () => {
      const res = await create({ name: '  小新  ', species: 'dog' });
      expect(res.status).toBe(201);
      expect(res.body.code).toBe(0);
      expect(typeof res.body.data.id).toBe('string');

      // 回读：刚建的宠物还没有照片，详情页也必须打得开 ——
      // 否则主人根本没有入口进去加第一张照片。
      const detail = await http().get(`/pets/${res.body.data.id}`).expect(200);
      expect(detail.body.data.name).toBe('小新');
      expect(detail.body.data.gender).toBe('unknown');
      expect(detail.body.data.breed).toBe('');
      expect(detail.body.data.bio).toBe('');
      expect(detail.body.data.personalityTags).toEqual([]);
      expect(detail.body.data.photos).toEqual([]);
    });

    it('全字段建号，回读一致', async () => {
      const res = await create({
        name: '奶糖',
        species: 'cat',
        breed: '布偶',
        gender: 'female',
        birthDate: '2024-02-14',
        bio: '爱睡觉的小公主',
        personalityTags: ['温柔', '爱睡觉'],
        ...CENTER,
      });
      expect(res.status).toBe(201);
      const detail = await http().get(`/pets/${res.body.data.id}`).expect(200);
      expect(detail.body.data).toMatchObject({
        name: '奶糖',
        species: 'cat',
        breed: '布偶',
        gender: 'female',
        birthDate: '2024-02-14',
        bio: '爱睡觉的小公主',
        personalityTags: ['温柔', '爱睡觉'],
      });
    });

    it('名字与物种缺一不可，物种只收 dog/cat/other —— 筛选用的 all 不是物种', async () => {
      const bad: Record<string, unknown>[] = [
        {},
        { species: 'dog' },
        { name: '', species: 'dog' },
        { name: '   ', species: 'dog' },
        { name: 'x'.repeat(21), species: 'dog' },
        { name: 123, species: 'dog' },
        { name: '小新' },
        { name: '小新', species: 'all' },
        { name: '小新', species: 'alien' },
      ];
      for (const body of bad) {
        const res = await create(body);
        expect(res.status).toBe(422);
        expect(res.body.code).toBe(ERROR_CODES.VALIDATION_FAILED);
      }
      // 正好 20 字是允许的边界
      const ok = await create({ name: 'x'.repeat(20), species: 'other' });
      expect(ok.status).toBe(201);
    });

    it('性别、生日、简介、性格标签非法 → 422', async () => {
      const bad: Record<string, unknown>[] = [
        { gender: '公' },
        { birthDate: '2024/02/14' },
        { birthDate: '2024-13-45' },
        { birthDate: '2024-02-30' },
        { bio: 'x'.repeat(201) },
        { personalityTags: '温柔' },
        { personalityTags: [1, 2] },
        { personalityTags: ['', '  '] },
        { personalityTags: ['a', 'b', 'c', 'd', 'e', 'f'] },
        { personalityTags: ['这个性格标签实在是太长了'] },
      ];
      for (const extra of bad) {
        const res = await create({ name: '小新', species: 'dog', ...extra });
        expect(res.status).toBe(422);
        expect(res.body.code).toBe(ERROR_CODES.VALIDATION_FAILED);
      }
    });

    it('坐标必须成对且在范围内', async () => {
      const bad: Record<string, unknown>[] = [
        { lat: 39.9 },
        { lng: 116.4 },
        { lat: 91, lng: 116.4 },
        { lat: 39.9, lng: 181 },
        { lat: '39.9', lng: '116.4' },
      ];
      for (const extra of bad) {
        const res = await create({ name: '小新', species: 'dog', ...extra });
        expect(res.status).toBe(422);
        expect(res.body.code).toBe(ERROR_CODES.VALIDATION_FAILED);
      }
    });
  });

  describe('PATCH /pets/:id', () => {
    it('未登录 401', async () => {
      await http().patch(`/pets/${OTHERS_PET}`).send({ name: '改名' }).expect(401);
    });

    it('改别人的宠物 → 403 而不是 404（宠物在广场上本来就公开可见，藏不住）', async () => {
      const res = await auth(http().patch(`/pets/${OTHERS_PET}`)).send({ name: '抢名字' });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe(ERROR_CODES.FORBIDDEN);
      const detail = await http().get(`/pets/${OTHERS_PET}`).expect(200);
      expect(detail.body.data.name).toBe('大黄');
    });

    it('别人改我的宠物 → 同样 403', async () => {
      const id = await createWithPhoto();
      const res = await asOther(http().patch(`/pets/${id}`)).send({ name: '抢名字' });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe(ERROR_CODES.FORBIDDEN);
    });

    it('不存在的宠物 → 404', async () => {
      const res = await auth(http().patch('/pets/p-nope')).send({ name: '改名' });
      expect(res.status).toBe(404);
      expect(res.body.code).toBe(ERROR_CODES.NOT_FOUND);
    });

    it('一个可改字段都没给 → 422（静默 200 只会让写错字段名的 bug 更难查）', async () => {
      const id = await createWithPhoto();
      for (const body of [{}, { id: 'p-9' }, { ownerId: 'u-2' }, { visibility: 'private' }]) {
        const res = await auth(http().patch(`/pets/${id}`)).send(body);
        expect(res.status).toBe(422);
        expect(res.body.code).toBe(ERROR_CODES.VALIDATION_FAILED);
      }
    });

    it('改名字与简介，回读生效，没给的字段一个都没动', async () => {
      const id = await createWithPhoto();
      const res = await auth(http().patch(`/pets/${id}`)).send({
        name: '小新改名',
        bio: '换了个简介',
      });
      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('小新改名');

      const detail = await http().get(`/pets/${id}`).expect(200);
      expect(detail.body.data.name).toBe('小新改名');
      expect(detail.body.data.bio).toBe('换了个简介');
      expect(detail.body.data.species).toBe('dog');
      expect(detail.body.data.photos).toHaveLength(1);
    });

    it('补坐标后广场列表里能算出距离', async () => {
      const res = await create({ name: '小新', species: 'dog' });
      const id = res.body.data.id as string;
      await auth(http().post(`/pets/${id}/photos`))
        .send({ url: 'https://picsum.photos/seed/paws-new/600/800', width: 600, height: 800 })
        .expect(201);
      await auth(http().patch(`/pets/${id}`)).send(CENTER).expect(200);

      const list = await http()
        .get(`/pets?pageSize=20&lat=${CENTER.lat}&lng=${CENTER.lng}`)
        .expect(200);
      const mine = (list.body.data.items as { id: string; distanceMeters: number | null }[]).find(
        (i) => i.id === id,
      );
      expect(mine).toBeDefined();
      expect(mine!.distanceMeters).not.toBeNull();
      expect(mine!.distanceMeters).toBeLessThan(100);
    });

    it('物种同样不收 all，其余字段的校验与建号一致', async () => {
      const id = await createWithPhoto();
      const bad: Record<string, unknown>[] = [
        { species: 'all' },
        { species: 'alien' },
        { name: '' },
        { name: 'x'.repeat(21) },
        { gender: '母' },
        { birthDate: '2024-02-30' },
        { personalityTags: ['a', 'b', 'c', 'd', 'e', 'f'] },
        { lat: 39.9 },
      ];
      for (const body of bad) {
        const res = await auth(http().patch(`/pets/${id}`)).send(body);
        expect(res.status).toBe(422);
        expect(res.body.code).toBe(ERROR_CODES.VALIDATION_FAILED);
      }
    });
  });

  /**
   * `wx.request` 发不出 PATCH（method 白名单里没有），所以 `/pets/:id` 上
   * PUT 与 PATCH 共用同一份实现。这里盯的是两个动词不许分叉。
   */
  describe('PUT /pets/:id（小程序端只能发 PUT）', () => {
    it('未登录 401、改别人的 403、不存在的 404 —— 与 PATCH 一致', async () => {
      await http().put(`/pets/${OTHERS_PET}`).send({ name: '改名' }).expect(401);

      const forbidden = await auth(http().put(`/pets/${OTHERS_PET}`)).send({ name: '抢名字' });
      expect(forbidden.status).toBe(403);
      expect(forbidden.body.code).toBe(ERROR_CODES.FORBIDDEN);

      const missing = await auth(http().put('/pets/p-nope')).send({ name: '改名' });
      expect(missing.status).toBe(404);
      expect(missing.body.code).toBe(ERROR_CODES.NOT_FOUND);
    });

    it('局部语义：只给 bio 时其余字段一个都没动', async () => {
      const id = await createWithPhoto();
      const res = await auth(http().put(`/pets/${id}`)).send({ bio: '走 PUT 改简介' });
      expect(res.status).toBe(200);

      const detail = await http().get(`/pets/${id}`).expect(200);
      expect(detail.body.data.bio).toBe('走 PUT 改简介');
      expect(detail.body.data.name).toBe('小新');
      expect(detail.body.data.species).toBe('dog');
      expect(detail.body.data.photos).toHaveLength(1);
    });

    it('校验同一份：空 body 与非法物种照样 422', async () => {
      const id = await createWithPhoto();
      for (const body of [{}, { species: 'all' }, { name: '' }]) {
        const res = await auth(http().put(`/pets/${id}`)).send(body);
        expect(res.status).toBe(422);
        expect(res.body.code).toBe(ERROR_CODES.VALIDATION_FAILED);
      }
    });
  });

  describe('DELETE /pets/:id', () => {
    it('未登录 401', async () => {
      await http().delete(`/pets/${OTHERS_PET}`).expect(401);
    });

    it('删别人的宠物 403、不存在的 404，别人的宠物毫发无损', async () => {
      const forbidden = await auth(http().delete(`/pets/${OTHERS_PET}`));
      expect(forbidden.status).toBe(403);
      expect(forbidden.body.code).toBe(ERROR_CODES.FORBIDDEN);

      const missing = await auth(http().delete('/pets/p-nope'));
      expect(missing.status).toBe(404);
      expect(missing.body.code).toBe(ERROR_CODES.NOT_FOUND);

      await http().get(`/pets/${OTHERS_PET}`).expect(200);
    });

    it('删自己的宠物：详情 404、广场列表里不见了、再删一次还是 404（硬删，没有墓碑）', async () => {
      const id = await createWithPhoto();
      const res = await auth(http().delete(`/pets/${id}`));
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ deleted: true });
      forget(id);

      await http().get(`/pets/${id}`).expect(404);
      const list = await http().get('/pets?pageSize=20').expect(200);
      expect((list.body.data.items as { id: string }[]).map((i) => i.id)).not.toContain(id);

      const again = await auth(http().delete(`/pets/${id}`));
      expect(again.status).toBe(404);
    });

    describeDb('硬删连带清掉照片、关注、收藏与浏览历史', () => {
      it('照片、收藏、浏览历史都得自己删（前者外键无级联，后两者是多态表挂不上外键），关注行靠级联走', async () => {
        const id = await createWithPhoto();
        await pool!.query(
          `INSERT INTO follows (id, follower_id, target_pet_id) VALUES ($1, 'u-1', $2)
           ON CONFLICT DO NOTHING`,
          ['f-test-pet-write', id],
        );
        await pool!.query(
          `INSERT INTO favorites (user_id, target_type, target_id) VALUES ('u-1', 'pet', $1)
           ON CONFLICT DO NOTHING`,
          [id],
        );
        await pool!.query(
          `INSERT INTO view_history (id, user_id, target_type, target_id)
           VALUES ($1, 'u-1', 'pet', $2) ON CONFLICT DO NOTHING`,
          ['vh-test-pet-write', id],
        );

        await auth(http().delete(`/pets/${id}`)).expect(200);
        forget(id);

        const photos = await pool!.query<{ c: number }>(
          `SELECT count(*)::int AS c FROM pet_photos WHERE pet_id = $1`,
          [id],
        );
        expect(photos.rows[0].c).toBe(0);
        const follows = await pool!.query<{ c: number }>(
          `SELECT count(*)::int AS c FROM follows WHERE target_pet_id = $1`,
          [id],
        );
        expect(follows.rows[0].c).toBe(0);
        // 多态表的孤儿行会一直把个人中心的 favoriteCount 撑高，指向一只已经不存在的宠物。
        const favorites = await pool!.query<{ c: number }>(
          `SELECT count(*)::int AS c FROM favorites WHERE target_type = 'pet' AND target_id = $1`,
          [id],
        );
        expect(favorites.rows[0].c).toBe(0);
        const history = await pool!.query<{ c: number }>(
          `SELECT count(*)::int AS c FROM view_history WHERE target_type = 'pet' AND target_id = $1`,
          [id],
        );
        expect(history.rows[0].c).toBe(0);
      });
    });
  });

  describe('照片增删与封面', () => {
    const PHOTO = { url: 'https://picsum.photos/seed/paws-new/600/800', width: 600, height: 800 };
    const SECOND = { url: 'https://picsum.photos/seed/paws-new2/800/600', width: 800, height: 600 };

    it('未登录 401；给别人的宠物加照片 403', async () => {
      const id = await createWithPhoto();
      await http().post(`/pets/${id}/photos`).send(SECOND).expect(401);
      const forbidden = await asOther(http().post(`/pets/${id}/photos`)).send(SECOND);
      expect(forbidden.status).toBe(403);
      expect(forbidden.body.code).toBe(ERROR_CODES.FORBIDDEN);
    });

    it('缺宽高、非正宽高、非法 url 一律 422（宽高是瀑布流的预估高度，不是可选项）', async () => {
      const id = await createWithPhoto();
      const bad: Record<string, unknown>[] = [
        { url: PHOTO.url },
        { url: PHOTO.url, width: 600 },
        { url: PHOTO.url, height: 800 },
        { url: PHOTO.url, width: 0, height: 800 },
        { url: PHOTO.url, width: -1, height: 800 },
        { url: PHOTO.url, width: 600.5, height: 800 },
        { url: PHOTO.url, width: '600', height: '800' },
        { url: 'javascript:alert(1)', width: 600, height: 800 },
        { url: 'data:image/png;base64,AAAA', width: 600, height: 800 },
        { url: '', width: 600, height: 800 },
        { width: 600, height: 800 },
      ];
      for (const body of bad) {
        const res = await auth(http().post(`/pets/${id}/photos`)).send(body);
        expect(res.status).toBe(422);
        expect(res.body.code).toBe(ERROR_CODES.VALIDATION_FAILED);
      }
    });

    it('第一张照片自动成为封面 —— 没封面的宠物进不了广场瀑布流', async () => {
      const res = await create({ name: '小新', species: 'dog', ...CENTER });
      const id = res.body.data.id as string;
      // 卡片是照片打底的，没图没法渲染，所以列表里必须还看不见它
      const before = await http().get('/pets?pageSize=20').expect(200);
      expect((before.body.data.items as { id: string }[]).map((i) => i.id)).not.toContain(id);

      const added = await auth(http().post(`/pets/${id}/photos`)).send(PHOTO);
      expect(added.status).toBe(201);
      expect(typeof added.body.data.id).toBe('string');
      expect(added.body.data).toMatchObject(PHOTO);

      const after = await http().get('/pets?pageSize=20').expect(200);
      const mine = (
        after.body.data.items as { id: string; coverUrl: string; coverWidth: number }[]
      ).find((i) => i.id === id);
      expect(mine).toBeDefined();
      expect(mine!.coverUrl).toBe(PHOTO.url);
      expect(mine!.coverWidth).toBe(600);
    });

    it('删掉封面：封面顶给剩下的第一张；照片删光后退出广场列表', async () => {
      const id = await createWithPhoto();
      await auth(http().post(`/pets/${id}/photos`)).send(SECOND).expect(201);

      const detail = await http().get(`/pets/${id}`).expect(200);
      const photos = detail.body.data.photos as { id: string; url: string }[];
      expect(photos).toHaveLength(2);
      expect(photos[0].url).toBe(PHOTO.url);

      const removed = await auth(http().delete(`/pets/${id}/photos/${photos[0].id}`));
      expect(removed.status).toBe(200);
      expect(removed.body.data).toEqual({ deleted: true });

      const list = await http().get('/pets?pageSize=20').expect(200);
      const mine = (list.body.data.items as { id: string; coverUrl: string }[]).find(
        (i) => i.id === id,
      );
      expect(mine!.coverUrl).toBe(SECOND.url);

      await auth(http().delete(`/pets/${id}/photos/${photos[1].id}`)).expect(200);
      const empty = await http().get(`/pets/${id}`).expect(200);
      expect(empty.body.data.photos).toEqual([]);
      const gone = await http().get('/pets?pageSize=20').expect(200);
      expect((gone.body.data.items as { id: string }[]).map((i) => i.id)).not.toContain(id);
    });

    it('删不属于这只宠物的照片 → 404，别人的照片一张没少', async () => {
      const id = await createWithPhoto();
      // ph-1 是 p-1 的照片
      const res = await auth(http().delete(`/pets/${id}/photos/ph-1`));
      expect(res.status).toBe(404);
      expect(res.body.code).toBe(ERROR_CODES.NOT_FOUND);

      const others = await http().get(`/pets/${OTHERS_PET}`).expect(200);
      expect((others.body.data.photos as { id: string }[]).map((p) => p.id)).toContain('ph-1');
    });

    it('换封面走 PATCH coverPhotoId；指向别人宠物的照片 422', async () => {
      const id = await createWithPhoto();
      const second = await auth(http().post(`/pets/${id}/photos`)).send(SECOND).expect(201);

      // 封面是 pets.cover_photo_id 这一个指针，换封面是改指针 ——
      // 「一只宠物只有一张封面」是结构决定的，不靠唯一索引维持。
      await auth(http().patch(`/pets/${id}`)).send({ coverPhotoId: second.body.data.id }).expect(200);
      const list = await http().get('/pets?pageSize=20').expect(200);
      const mine = (list.body.data.items as { id: string; coverUrl: string }[]).find(
        (i) => i.id === id,
      );
      expect(mine!.coverUrl).toBe(SECOND.url);
      // 老封面还在相册里，只是不再是封面
      const detail = await http().get(`/pets/${id}`).expect(200);
      expect((detail.body.data.photos as { url: string }[]).map((p) => p.url)).toContain(PHOTO.url);

      for (const coverPhotoId of ['ph-1', 'ph-nope']) {
        const bad = await auth(http().patch(`/pets/${id}`)).send({ coverPhotoId });
        expect(bad.status).toBe(422);
        expect(bad.body.code).toBe(ERROR_CODES.VALIDATION_FAILED);
      }
    });
  });

  describeDb('验收：新建的宠物立刻算进 GET /me 的宠物数', () => {
    /** 无库模式下三个计数恒为 0（有意的降级，见 phase2-notes.md），所以这段只在真库下跑。 */
    it('建号前 0、建完 1、删掉回 0', async () => {
      const before = await auth(http().get('/me')).expect(200);
      expect(before.body.data.petCount).toBe(0);

      const id = await createWithPhoto();
      const after = await auth(http().get('/me')).expect(200);
      expect(after.body.data.petCount).toBe(1);

      await auth(http().delete(`/pets/${id}`)).expect(200);
      forget(id);
      const back = await auth(http().get('/me')).expect(200);
      expect(back.body.data.petCount).toBe(0);
    });
  });
});
