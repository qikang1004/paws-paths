import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { AUDIT_STATUSES, isPubliclyVisible, isVisibleTo, type AuditStatus } from '@paws/types';

/** DI token：动态仓储。无库时内存实现驱动演示（与 PET_REPOSITORY 同款）。 */
export const POST_REPOSITORY = 'PostRepository';

export interface PostImageRow {
  id: string;
  url: string;
  width: number;
  height: number;
  /** 与所属动态**独立**：文字过审不代表每张图都过审。 */
  auditStatus: AuditStatus;
}

/**
 * 域记录。`authorId` 留在行上而不像 `PetRow` 那样藏起来 —— 可见性判定
 * （`isVisibleTo(status, authorId === viewerId)`）就是拿它算的，投影成 DTO 时再摘掉。
 */
export interface PostRow {
  id: string;
  petId: string;
  petName: string;
  authorId: string;
  content: string;
  auditStatus: AuditStatus;
  rejectReason: string | null;
  publishedAt: Date;
  images: PostImageRow[];
}

export interface PostImageInput {
  url: string;
  width: number;
  height: number;
  /** 由服务端按图片实际落的存储档位决定，不听客户端报的值。 */
  auditStatus: AuditStatus;
}

/**
 * 发布入参。`petName` 由上层查好一并传进来：Postgres 侧本可以 JOIN 出来，
 * 但内存实现看不见 `pets`（那是另一个仓储），两边形状得一致。
 */
export interface PostCreateInput {
  petId: string;
  petName: string;
  authorId: string;
  content: string;
  images: PostImageInput[];
}

export interface PostListQuery {
  petId: string;
  /** 看的人。未登录为 null —— 那就只剩 approved 可见。 */
  viewerId: string | null;
  page: number;
  pageSize: number;
}

export interface PostRepository {
  /** 一律落 `pending`（库里的默认值），机审结论随后走 `setAuditStatus`。 */
  create(input: PostCreateInput): Promise<PostRow>;
  /**
   * 列表。**可见性过滤必须在这里做完**：先取一页再把不可见的筛掉，
   * 会让「一页 10 条」变成「一页 3 条还说 hasMore」——分页就不对了。
   */
  list(query: PostListQuery): Promise<{ items: PostRow[]; hasMore: boolean }>;
  /** 不做可见性过滤：判定要 `authorId`，交给上层的 `isVisibleTo`（详情要区分 404 与 200）。 */
  getById(id: string): Promise<PostRow | null>;
  /** 迁移动态本身的审核状态。合法性由上层的 `assertTransition` 把关。 */
  setAuditStatus(id: string, status: AuditStatus, rejectReason: string | null): Promise<void>;
}

/** 对外可见的状态。从状态机筛，不写死字面量（spec §4.5 要求状态机唯一）。 */
const PUBLIC_STATUSES: readonly AuditStatus[] = AUDIT_STATUSES.filter(isPubliclyVisible);

/**
 * 无库模式的演示数据，逐条对齐 `seed.sql` 的 po-1..po-5 / pi-1..pi-6
 * （同一份 id 与文案，两种模式下测试断言才能共用一套期望值）。
 *
 * `hoursAgo` 而不是绝对时间：种子里写的是 `now() - interval '5 hour'`，
 * 落成常量时间的话，跑得久一点顺序就和真库分叉了。
 */
const POST_SEED: readonly (Omit<PostRow, 'publishedAt' | 'images'> & {
  hoursAgo: number;
  images: readonly PostImageRow[];
})[] = [
  {
    id: 'po-1',
    petId: 'p-1',
    petName: '大黄',
    authorId: 'u-1',
    content: '今天带大黄去公园撒欢，玩水玩到不肯走。',
    auditStatus: 'approved',
    rejectReason: null,
    hoursAgo: 5,
    images: [
      { id: 'pi-1', url: 'https://picsum.photos/seed/post-1a/600/800', width: 600, height: 800, auditStatus: 'approved' },
      { id: 'pi-2', url: 'https://picsum.photos/seed/post-1b/800/600', width: 800, height: 600, auditStatus: 'approved' },
    ],
  },
  {
    id: 'po-2',
    petId: 'p-2',
    petName: '奶昔',
    authorId: 'u-2',
    content: '奶昔今天格外黏人，一直踩奶。',
    auditStatus: 'approved',
    rejectReason: null,
    hoursAgo: 4,
    images: [
      { id: 'pi-3', url: 'https://picsum.photos/seed/post-2a/700/700', width: 700, height: 700, auditStatus: 'approved' },
    ],
  },
  {
    id: 'po-3',
    petId: 'p-5',
    petName: '花花',
    authorId: 'u-5',
    content: '花花学会开门了，家里再没有秘密。',
    auditStatus: 'approved',
    rejectReason: null,
    hoursAgo: 3,
    // pi-6 挂在过审的动态上但自身 pending：图片与动态的审核状态是独立的。
    images: [
      { id: 'pi-4', url: 'https://picsum.photos/seed/post-3a/900/600', width: 900, height: 600, auditStatus: 'approved' },
      { id: 'pi-6', url: 'https://picsum.photos/seed/post-3b/800/800', width: 800, height: 800, auditStatus: 'pending' },
    ],
  },
  {
    id: 'po-4',
    petId: 'p-2',
    petName: '奶昔',
    authorId: 'u-2',
    content: '这条还在机审队列里。',
    auditStatus: 'pending',
    rejectReason: null,
    hoursAgo: 2,
    images: [
      { id: 'pi-5', url: 'https://picsum.photos/seed/post-4a/600/900', width: 600, height: 900, auditStatus: 'pending' },
    ],
  },
  {
    id: 'po-5',
    petId: 'p-5',
    petName: '花花',
    authorId: 'u-5',
    content: '这条被机审驳回了。',
    auditStatus: 'rejected',
    rejectReason: '包含疑似违规信息',
    hoursAgo: 1,
    images: [],
  },
];

/**
 * 无库模式的实现。
 *
 * 种子取**实例级的可变副本**（同 `InMemoryPetRepository`）：发布端点会往里塞行，
 * 直接改模块级常量的话，同一进程里的下一个测试套件会看到上一个套件发的动态。
 */
@Injectable()
export class InMemoryPostRepository implements PostRepository {
  private readonly rows: PostRow[];

  constructor() {
    const now = Date.now();
    this.rows = POST_SEED.map(({ hoursAgo, images, ...rest }) => ({
      ...rest,
      publishedAt: new Date(now - hoursAgo * 3600_000),
      images: images.map((image) => ({ ...image })),
    }));
  }

  async create(input: PostCreateInput): Promise<PostRow> {
    const row: PostRow = {
      id: randomUUID(),
      petId: input.petId,
      petName: input.petName,
      authorId: input.authorId,
      content: input.content,
      // 库里的默认值也是 pending：机审结论一律另走 setAuditStatus。
      auditStatus: 'pending',
      rejectReason: null,
      publishedAt: new Date(),
      images: input.images.map((image) => ({ id: randomUUID(), ...image })),
    };
    this.rows.push(row);
    return this.clone(row);
  }

  async list({ petId, viewerId, page, pageSize }: PostListQuery): Promise<{
    items: PostRow[];
    hasMore: boolean;
  }> {
    const visible = this.rows
      .filter((row) => row.petId === petId && isVisibleTo(row.auditStatus, row.authorId === viewerId))
      .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
    const offset = (page - 1) * pageSize;
    const slice = visible.slice(offset, offset + pageSize);
    return { items: slice.map((row) => this.clone(row)), hasMore: offset + slice.length < visible.length };
  }

  async getById(id: string): Promise<PostRow | null> {
    const row = this.rows.find((candidate) => candidate.id === id);
    return row ? this.clone(row) : null;
  }

  async setAuditStatus(id: string, status: AuditStatus, rejectReason: string | null): Promise<void> {
    const row = this.rows.find((candidate) => candidate.id === id);
    if (!row) return;
    row.auditStatus = status;
    row.rejectReason = rejectReason;
  }

  /** 出仓库的行一律是副本：调用方投影 DTO 时改到的不该是这里存的那份。 */
  private clone(row: PostRow): PostRow {
    return { ...row, images: row.images.map((image) => ({ ...image })) };
  }
}

interface PostQueryRow {
  id: string;
  pet_id: string;
  pet_name: string;
  author_id: string;
  content: string;
  audit_status: AuditStatus;
  reject_reason: string | null;
  published_at: Date;
  /** json_agg 的产物，pg 已经解析成对象数组；没有图片时是 `[]`。 */
  images: PostImageRow[];
}

/**
 * 每条动态连带把图片聚成一个 JSON 数组取回来。
 *
 * 不拆成「先查一页动态、再按 id 批量查图片」的两条语句：远程库单次往返实测
 * 几百毫秒，而这两条查询之间没有任何需要在应用层做的决策。图片的排序放在
 * `json_agg` 里，`sort_order` 相同时用 id 兜底，保证两种模式下顺序稳定。
 */
const SELECT_POSTS = `
  SELECT po.id, po.pet_id, pe.name AS pet_name, po.author_id, po.content,
         po.audit_status, po.reject_reason, po.published_at,
         COALESCE((
           SELECT json_agg(json_build_object(
                    'id', pi.id, 'url', pi.url, 'width', pi.width,
                    'height', pi.height, 'auditStatus', pi.audit_status)
                  ORDER BY pi.sort_order, pi.id)
           FROM post_images pi WHERE pi.post_id = po.id
         ), '[]'::json) AS images
  FROM posts po
  JOIN pets pe ON pe.id = po.pet_id
`;

function toRow(row: PostQueryRow): PostRow {
  return {
    id: row.id,
    petId: row.pet_id,
    petName: row.pet_name,
    authorId: row.author_id,
    content: row.content,
    auditStatus: row.audit_status,
    rejectReason: row.reject_reason,
    publishedAt: row.published_at,
    images: row.images,
  };
}

/** PostgreSQL 实现（DATABASE_URL 存在时经 PostsModule 工厂注入）。 */
@Injectable()
export class PostgresPostRepository implements PostRepository {
  constructor(private readonly pool: Pool) {}

  /**
   * 动态与它的图片一条语句写完。
   *
   * 不开事务：数据修改型 CTE 的各子语句保证各执行一次、执行到底（同
   * `PostgresPetRepository.addPhoto` 的理由），而外键的检查发生在整条语句末尾，
   * 所以子语句之间「谁先谁后」不影响 `post_images.post_id` 指向刚插的那行。
   * 图片 id 在应用侧生成，因此图片那条子语句不必等 `created` 的 RETURNING。
   *
   * `audit_status` / `published_at` 交给库的默认值，再读回来 ——
   * 「发布即 pending」这件事只在 schema 里写一次。
   */
  async create(input: PostCreateInput): Promise<PostRow> {
    const id = randomUUID();
    const images = input.images.map((image, index) => ({
      id: randomUUID(),
      url: image.url,
      width: image.width,
      height: image.height,
      sort_order: index,
      audit_status: image.auditStatus,
    }));
    const { rows } = await this.pool.query<{
      audit_status: AuditStatus;
      reject_reason: string | null;
      published_at: Date;
    }>(
      `WITH created AS (
         INSERT INTO posts (id, pet_id, author_id, content) VALUES ($1, $2, $3, $4)
         RETURNING audit_status, reject_reason, published_at
       ), created_images AS (
         INSERT INTO post_images (id, post_id, url, width, height, sort_order, audit_status)
         SELECT i.id, $1, i.url, i.width, i.height, i.sort_order, i.audit_status
         FROM jsonb_to_recordset($5::jsonb)
           AS i(id text, url text, width int, height int, sort_order int, audit_status text)
         RETURNING id
       )
       SELECT audit_status, reject_reason, published_at FROM created`,
      [id, input.petId, input.authorId, input.content, JSON.stringify(images)],
    );
    return {
      id,
      petId: input.petId,
      petName: input.petName,
      authorId: input.authorId,
      content: input.content,
      auditStatus: rows[0].audit_status,
      rejectReason: rows[0].reject_reason,
      publishedAt: rows[0].published_at,
      images: images.map((image) => ({
        id: image.id,
        url: image.url,
        width: image.width,
        height: image.height,
        auditStatus: image.audit_status,
      })),
    };
  }

  /**
   * 可见性写进 WHERE：`审核状态在公开集合里 或者 我就是作者`。
   *
   * 未登录时 `$3` 是 null，`po.author_id = NULL` 求值为 NULL（不是 true），
   * 于是只剩公开的那些 —— 两种身份共用同一条语句，不必分叉。
   */
  async list({ petId, viewerId, page, pageSize }: PostListQuery): Promise<{
    items: PostRow[];
    hasMore: boolean;
  }> {
    const offset = (page - 1) * pageSize;
    // 多取一条判断 hasMore，省一次 count 查询（同 PostgresFollowRepository.listFollowing）。
    const { rows } = await this.pool.query<PostQueryRow>(
      `${SELECT_POSTS}
       WHERE po.pet_id = $1 AND (po.audit_status = ANY($2) OR po.author_id = $3)
       ORDER BY po.published_at DESC, po.id DESC
       LIMIT $4 OFFSET $5`,
      [petId, PUBLIC_STATUSES, viewerId, pageSize + 1, offset],
    );
    return { items: rows.slice(0, pageSize).map(toRow), hasMore: rows.length > pageSize };
  }

  async getById(id: string): Promise<PostRow | null> {
    const { rows } = await this.pool.query<PostQueryRow>(`${SELECT_POSTS} WHERE po.id = $1`, [id]);
    return rows[0] ? toRow(rows[0]) : null;
  }

  async setAuditStatus(id: string, status: AuditStatus, rejectReason: string | null): Promise<void> {
    await this.pool.query(`UPDATE posts SET audit_status = $2, reject_reason = $3 WHERE id = $1`, [
      id,
      status,
      rejectReason,
    ]);
  }
}
