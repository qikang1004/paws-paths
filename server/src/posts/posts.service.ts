import { HttpStatus, Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import {
  assertTransition,
  AuditTransitionError,
  ERROR_CODES,
  isVisibleTo,
  type AuditStatus,
  type PostDto,
} from '@paws/types';
import { ApiException } from '../common/api.exception';
import {
  CONTENT_SECURITY_API,
  type ContentSecurityApi,
  type ContentSecurityScene,
  type ContentSecurityVerdict,
} from '../moderation/content-security';
import { PET_REPOSITORY, type PetRepository } from '../pets/pet.repository';
import type { StorageLane } from '../uploads/image-storage';
import { UploadsService } from '../uploads/uploads.service';
import {
  POST_REPOSITORY,
  type PostImageInput,
  type PostRepository,
  type PostRow,
} from './post.repository';

/**
 * 正文上限，按**码点**计。`'🐶'.length` 是 2（一个 emoji 两个 UTF-16 码元），
 * 拿 `.length` 卡会让「500 字」对爱用 emoji 的人变成 250 个 —— 客户端的字数
 * 提示也按码点数，两边不一致时用户会看着「250/500」被拒。
 */
export const POST_CONTENT_MAX_LENGTH = 500;

/** 单条动态最多 9 张图（九宫格，与小程序选图的常规上限一致）。 */
export const POST_IMAGES_MAX_COUNT = 9;

/** `msgSecCheck` v2 的场景值：动态发布属社交日志。 */
const POST_SCENE: ContentSecurityScene = 4;

/**
 * 机审裁决 → 要迁移到的状态。`null` 表示**没有结论**（假实现、机器不敢判、
 * 或者调用本身失败了）：什么都不做，内容留在待审。
 *
 * 查表而不是逐个比较状态字面量：那种写法会被 `test/audit-literal-guard.spec.ts`
 * 拦下（spec §4.5 要求状态机唯一），顺带把「将来多一种裁决」变成编译错误。
 */
const TRANSITION_OF: Readonly<Record<ContentSecurityVerdict, AuditStatus | null>> = {
  approved: 'approved',
  rejected: 'rejected',
  pending: null,
};
/** 驳回原因按目标状态查表：只有被驳回才有原因，其余一律清空。 */
const REJECT_REASON_OF: Readonly<Record<AuditStatus, string | null>> = {
  approved: null,
  pending: null,
  pending_review: null,
  rejected: '内容包含疑似违规信息',
};

/**
 * 图片落的存储档位 → 它的审核状态。档位是机审当时定的，也就是唯一的真相：
 * 公开档说明那张图过审了，私有档说明还没有。
 */
const STATUS_OF_LANE: Readonly<Record<StorageLane, AuditStatus>> = {
  public: 'approved',
  private: 'pending',
};

/** 校验过的发布入参。图片的 `auditStatus` 不在这里 —— 那是服务端自己算的。 */
export interface PostCreateBody {
  petId: string;
  content: string;
  images: { url: string; width: number; height: number }[];
}

export interface PostListResponse {
  items: PostDto[];
  hasMore: boolean;
  page: number;
}

function fail(message: string): never {
  throw new ApiException(ERROR_CODES.VALIDATION_FAILED, message, HttpStatus.UNPROCESSABLE_ENTITY);
}

/**
 * 正整数。刻意不复用 `parseDimension` —— 那个收 multipart 的字符串字段，
 * 这里的宽高来自 JSON 本来就是数；两边各卡各自的形状，不互相将就。
 */
function positiveInt(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 1 ? raw : null;
}
/** 请求体校验。导出在服务层，让控制器只管取参数、不管规则。 */
export function parsePostCreate(body: Record<string, unknown>): PostCreateBody {
  const petId = typeof body.petId === 'string' ? body.petId.trim() : '';
  if (!petId) fail('缺少宠物 id');

  if (typeof body.content !== 'string') fail('动态内容必须是文本');
  const content = body.content.trim();
  if (content.length === 0) fail('说点什么再发吧');
  if ([...content].length > POST_CONTENT_MAX_LENGTH) {
    fail(`动态内容不能超过 ${POST_CONTENT_MAX_LENGTH} 字`);
  }

  const rawImages = body.images ?? [];
  if (!Array.isArray(rawImages)) fail('图片列表格式不对');
  if (rawImages.length > POST_IMAGES_MAX_COUNT) fail(`最多只能发 ${POST_IMAGES_MAX_COUNT} 张图`);

  const images = rawImages.map((item: unknown) => {
    const image = (item ?? {}) as Record<string, unknown>;
    const url = typeof image.url === 'string' ? image.url.trim() : '';
    if (!url) fail('图片地址缺失');
    // Global Constraint 21：宽高是瀑布流的预估高度，缺了列表会在图片加载时跳版。
    const width = positiveInt(image.width);
    const height = positiveInt(image.height);
    if (width == null || height == null) fail('必须提供图片的真实宽高');
    // 客户端报的 auditStatus 一概不读 —— 那等于让发布方自己声明「我这张图过审了」。
    return { url, width, height };
  });
  return { petId, content, images };
}

/** 投影 DTO：摘掉只在服务端用的 `authorId`，并按可见性筛掉这个人看不到的图。 */
function toDto(row: PostRow, viewerId: string | null): PostDto {
  const isAuthor = row.authorId === viewerId;
  return {
    id: row.id,
    petId: row.petId,
    petName: row.petName,
    content: row.content,
    auditStatus: row.auditStatus,
    rejectReason: row.rejectReason,
    publishedAt: row.publishedAt.toISOString(),
    // 图片与动态的审核状态独立：文字过审而某张图待审时，那张图不下发、文字照常显示。
    images: row.images.filter((image) => isVisibleTo(image.auditStatus, isAuthor)),
  };
}
@Injectable()
export class PostsService implements OnModuleDestroy {
  private readonly logger = new Logger(PostsService.name);

  /**
   * 在飞的机审任务。留着句柄有两个用处：测试拿 `settleAuditChecks()` 收敛而不靠
   * sleep；进程退出前也等一等，免得一条已经拿到裁决、还没写回状态的动态永久待审。
   */
  private readonly inFlight = new Set<Promise<void>>();

  constructor(
    @Inject(POST_REPOSITORY) private readonly posts: PostRepository,
    @Inject(PET_REPOSITORY) private readonly pets: PetRepository,
    @Inject(CONTENT_SECURITY_API) private readonly security: ContentSecurityApi,
    private readonly uploads: UploadsService,
  ) {}

  /**
   * 发布：落 `pending` → 返回 → 后台机审 → 按状态机迁移。
   *
   * 机审**不阻塞响应**。微信那两个接口正常也要几百毫秒、慢的时候是几秒，而这一刻
   * 的答案无论如何都是「待审」—— 让用户对着转圈等一个已知的结果毫无意义。
   */
  async publish(authorId: string, openid: string | null, body: PostCreateBody): Promise<PostDto> {
    // 归属与名字一起取：两次 O(1) 查询并发打，省掉一次远程往返的等待。
    const [ownerId, petName] = await Promise.all([
      this.pets.findOwnerId(body.petId),
      this.pets.findNameById(body.petId),
    ]);
    if (ownerId == null || petName == null) {
      throw new ApiException(ERROR_CODES.NOT_FOUND, '宠物不存在', HttpStatus.NOT_FOUND);
    }
    if (ownerId !== authorId) {
      throw new ApiException(
        ERROR_CODES.FORBIDDEN,
        '只能为自己的宠物发动态',
        HttpStatus.FORBIDDEN,
      );
    }

    const images = await Promise.all(body.images.map((image) => this.withLaneStatus(image)));
    const row = await this.posts.create({
      petId: body.petId,
      petName,
      authorId,
      content: body.content,
      images,
    });
    this.trackAuditCheck(row, openid);
    return toDto(row, authorId);
  }
  async list(
    petId: string,
    viewerId: string | null,
    opts: { page: number; pageSize: number },
  ): Promise<PostListResponse> {
    // 宠物不存在与「这只宠物还没发过动态」要分开：前者是客户端拿错了 id。
    if ((await this.pets.findOwnerId(petId)) == null) {
      throw new ApiException(ERROR_CODES.NOT_FOUND, '宠物不存在', HttpStatus.NOT_FOUND);
    }
    const { items, hasMore } = await this.posts.list({ petId, viewerId, ...opts });
    return { items: items.map((row) => toDto(row, viewerId)), hasMore, page: opts.page };
  }

  /**
   * 关注流。可见性与「不含自己的动态」两件事都在仓储的 WHERE 里做完 ——
   * 先取一页再筛，会让分页不对（同 `list` 的理由）。
   *
   * 投影时 `viewerId` 照常传：feed 里全是别人的动态，所以 `isAuthor` 恒为 false，
   * 未过审的图片自然被 `toDto` 滤掉。传 null 也是同样结果，但传真实值才与
   * 「这个人在看」这件事一致，将来加「我点赞过吗」之类的字段时不必回头改。
   */
  async feed(viewerId: string, opts: { page: number; pageSize: number }): Promise<PostListResponse> {
    const { items, hasMore } = await this.posts.listFeed({ viewerId, ...opts });
    return { items: items.map((row) => toDto(row, viewerId)), hasMore, page: opts.page };
  }

  /**
   * 详情。看不见的动态返回 404 而不是 403：两者不同的话，响应码本身就把
   * 「这条 id 有东西」告诉了探测者。
   */
  async detail(id: string, viewerId: string | null): Promise<PostDto> {
    const row = await this.posts.getById(id);
    if (!row || !isVisibleTo(row.auditStatus, row.authorId === viewerId)) {
      throw new ApiException(ERROR_CODES.NOT_FOUND, '动态不存在', HttpStatus.NOT_FOUND);
    }
    return toDto(row, viewerId);
  }

  /** 等所有在飞的机审落地。测试拿它取代 sleep。 */
  async settleAuditChecks(): Promise<void> {
    // 循环而不是只 Promise.all 一次：等待期间可能又发了新动态。
    while (this.inFlight.size > 0) {
      await Promise.all([...this.inFlight]);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.settleAuditChecks();
  }

  /** 图片的审核状态由服务端按它实际落的档位定，验不出档位的地址一律待审。 */
  private async withLaneStatus(image: {
    url: string;
    width: number;
    height: number;
  }): Promise<PostImageInput> {
    const lane = await this.uploads.laneOfUrl(image.url);
    // 外链、拼错的 key、已经不存在的文件都落在这里：验不了就不放行。
    return { ...image, auditStatus: lane ? STATUS_OF_LANE[lane] : 'pending' };
  }
  /** 起一次后台机审并登记句柄。刻意返回 void：调用方不该 await 它。 */
  private trackAuditCheck(row: PostRow, openid: string | null): void {
    const task = this.settleOne(row, openid).catch((error: unknown) => {
      // fail-closed（Global Constraint 18）：这一路出任何问题，内容就留在待审。
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.error(`动态机审失败，留在待审：${row.id} —— ${detail}`);
    });
    this.inFlight.add(task);
    void task.finally(() => this.inFlight.delete(task));
  }

  private async settleOne(row: PostRow, openid: string | null): Promise<void> {
    const target = TRANSITION_OF[await this.verdictOf(row.content, openid)];
    if (!target) return;
    try {
      assertTransition(row.auditStatus, target);
    } catch (error) {
      // 机审期间状态被别的路径改过（作者删了重发之类）。放弃这次迁移，不硬写。
      if (error instanceof AuditTransitionError) {
        this.logger.warn(`跳过非法的审核状态迁移：${row.id} ${error.message}`);
        return;
      }
      throw error;
    }
    await this.posts.setAuditStatus(row.id, target, REJECT_REASON_OF[target]);
  }

  /**
   * 取机审裁决。拿不到 openid 就不调 —— `msgSecCheck` v2 强制要求它（阶段 0
   * 签发的老令牌里没有），硬调只会换回一个参数错误；而把「调不通」当成「通过」
   * 正是过审最不能出的那个漏子。
   */
  private async verdictOf(
    content: string,
    openid: string | null,
  ): Promise<ContentSecurityVerdict> {
    if (!openid) return 'pending';
    return this.security.checkText({ content, openid, scene: POST_SCENE });
  }
}
