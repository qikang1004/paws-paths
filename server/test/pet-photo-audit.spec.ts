import { Pool } from 'pg';
import {
  InMemoryPetRepository,
  PostgresPetRepository,
  type PetRepository,
} from '../src/pets/pet.repository';

/**
 * 宠物照片的审核状态（spec §4.5：`pet_photos` 与 `posts` / `post_images` 共用一套状态机）。
 *
 * 双跑：内存实现无条件跑，Postgres 实现由 DATABASE_URL 门控（同 follow-repository.spec）。
 *
 * 要钉住的四件事：
 *   1. 种子 / 存量照片一律视作已过审 —— 加列时回填，否则上线那一刻广场空了；
 *   2. 没过审的照片对别人不可见，主人自己看得见（带状态，客户端据此画「审核中」）；
 *   3. 封面没过审的宠物进不了广场与关注列表（卡片是照片打底的，没过审的图不能当门面）；
 *   4. 封面优先给过审的照片：先传了一张待审的、再传一张过审的，过审那张顶上来。
 */
const DB_URL = process.env.DATABASE_URL;
/** 种子用户：`pets.owner_id` 有外键，主人必须真的存在。 */
const OWNER = 'u-1';
const CENTER = { lat: 39.905, lng: 116.406 };
const APPROVED = { url: '/uploads/u-1/ok.jpg', width: 600, height: 800, auditStatus: 'approved' as const };
const PENDING = { url: '/uploads/u-1/wait.jpg', width: 800, height: 600, auditStatus: 'pending' as const };

function sharedContract(makeRepo: () => PetRepository): void {
  let repo: PetRepository;
  const created: string[] = [];

  beforeEach(() => {
    repo = makeRepo();
  });

  afterEach(async () => {
    for (const id of created.splice(0)) await repo.remove(id);
  });

  const newPet = async (): Promise<string> => {
    const id = await repo.create({
      ownerId: OWNER,
      name: '审核测试',
      species: 'dog',
      breed: '',
      gender: 'unknown',
      birthDate: '2024-01-01',
      bio: '',
      personalityTags: [],
      ...CENTER,
    });
    created.push(id);
    return id;
  };

  const inPlaza = async (id: string): Promise<boolean> => {
    // 种子 8 只 + 别的套件建的，一页 200 足够装下；只看「在不在」，不数全表。
    const { items } = await repo.list({
      filter: { species: 'all', breed: 'all' },
      page: 1,
      pageSize: 200,
      ...CENTER,
    });
    return items.some((item) => item.id === id);
  };

  it('种子照片一律已过审（存量回填），审核状态随照片一起返回', async () => {
    const found = await repo.getById('p-1');
    expect(found?.photos.length).toBeGreaterThanOrEqual(2);
    for (const photo of found?.photos ?? []) expect(photo.auditStatus).toBe('approved');
  });

  it('addPhoto 原样落下调用方给的审核状态并回读', async () => {
    const id = await newPet();
    const row = await repo.addPhoto(id, PENDING);
    expect(row).toMatchObject({ url: PENDING.url, auditStatus: 'pending' });
  });

  it('待审照片对别人不可见；主人（includeHidden）看得见且带状态', async () => {
    const id = await newPet();
    await repo.addPhoto(id, APPROVED);
    await repo.addPhoto(id, PENDING);

    const publicView = await repo.getById(id);
    expect(publicView?.photos.map((p) => p.url)).toEqual([APPROVED.url]);

    const ownerView = await repo.getById(id, undefined, { includeHidden: true });
    expect(ownerView?.photos.map((p) => [p.url, p.auditStatus])).toEqual([
      [APPROVED.url, 'approved'],
      [PENDING.url, 'pending'],
    ]);
  });

  it('封面没过审：进不了广场与 listByIds，「我的宠物」里照样有', async () => {
    const id = await newPet();
    await repo.addPhoto(id, PENDING);

    expect(await inPlaza(id)).toBe(false);
    expect((await repo.listByIds([id])).map((r) => r.id)).toEqual([]);
    expect((await repo.listByOwner(OWNER)).map((r) => r.id)).toContain(id);
  });

  it('封面优先给过审的照片：待审封面遇到一张过审的新照片，换成过审的那张', async () => {
    const id = await newPet();
    await repo.addPhoto(id, PENDING);
    await repo.addPhoto(id, APPROVED);

    expect(await inPlaza(id)).toBe(true);
    const [card] = await repo.listByIds([id]);
    expect(card.coverUrl).toBe(APPROVED.url);
  });

  it('已有过审封面时，再传待审照片不动封面', async () => {
    const id = await newPet();
    await repo.addPhoto(id, APPROVED);
    await repo.addPhoto(id, PENDING);

    const [card] = await repo.listByIds([id]);
    expect(card.coverUrl).toBe(APPROVED.url);
  });

  it('删掉封面时，接替的优先是过审的照片（哪怕它排在待审那张后面）', async () => {
    const id = await newPet();
    const first = await repo.addPhoto(id, APPROVED);
    await repo.addPhoto(id, PENDING);
    await repo.addPhoto(id, { ...APPROVED, url: '/uploads/u-1/ok2.jpg' });

    expect(await repo.removePhoto(id, first.id)).toBe(true);
    const [card] = await repo.listByIds([id]);
    expect(card.coverUrl).toBe('/uploads/u-1/ok2.jpg');
  });
}

describe('PetRepository 照片审核（InMemory）', () => {
  sharedContract(() => new InMemoryPetRepository());
});

const describeDb = DB_URL ? describe : describe.skip;

describeDb('PetRepository 照片审核（Postgres）', () => {
  let pool: Pool;

  beforeAll(() => {
    // 建表与种子由 test/global-setup.ts 全局跑一次（不在用例里跑迁移，见那边的注释）。
    pool = new Pool({ connectionString: DB_URL, max: 2 });
  });

  afterAll(async () => {
    await pool.end();
  });

  sharedContract(() => new PostgresPetRepository(pool));
});
