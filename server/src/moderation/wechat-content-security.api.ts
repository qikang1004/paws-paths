import { Injectable, Logger } from '@nestjs/common';
import { AccessTokenService } from '../wechat/access-token.service';
import type {
  ContentSecurityApi,
  ContentSecurityVerdict,
  ImageCheckInput,
  TextCheckInput,
} from './content-security';

const BASE = 'https://api.weixin.qq.com';

/** 微信用这一个 errcode 表示「命中违规内容」，与调用失败区分得开。 */
const RISKY_ERRCODE = 87014;

/** `msgSecCheck` v2 的建议值 → 审核状态。见 content-security.ts 对 `pending` 的说明。 */
const SUGGEST_VERDICTS: Readonly<Record<string, ContentSecurityVerdict>> = {
  pass: 'approved',
  risky: 'rejected',
  review: 'pending',
};

/** 默认场景：社交日志。动态发布走这一档。 */
const DEFAULT_SCENE = 4;

/**
 * 真实的微信内容安全实现：`security.msgSecCheck`（v2）与 `security.imgSecCheck`。
 *
 * access_token 一律经 `AccessTokenService`（Redis 单点缓存的唯一出口）取，
 * 不自己拉 —— 见 `WechatModule` 为什么不 export `WechatApiService` 本体。
 *
 * **fail-closed**（Global Constraint 18）：网络异常、HTTP 非 2xx、token 取不到、
 * 配额耗尽、响应形状变了 —— 任何查不出结论的情形都返回 `pending`，绝不返回
 * `approved`。这与限流的 fail-open 取向相反，因为代价不对称：限流放行多几个请求，
 * 内容安全放行的是未审内容，直接威胁小程序过审。
 *
 * 上游的 `errcode` / `errmsg` 只进日志，不进返回值、不往上抛（Global Constraint 5）。
 */
@Injectable()
export class WechatContentSecurityApi implements ContentSecurityApi {
  private readonly logger = new Logger(WechatContentSecurityApi.name);

  constructor(private readonly tokens: AccessTokenService) {}

  async checkText(input: TextCheckInput): Promise<ContentSecurityVerdict> {
    return this.attempt('msgSecCheck', async (token) => {
      const body = await this.postJson(`${BASE}/wxa/msg_sec_check?access_token=${token}`, {
        version: 2,
        openid: input.openid,
        scene: input.scene ?? DEFAULT_SCENE,
        content: input.content,
      });
      const failure = this.failureOf('msgSecCheck', body);
      if (failure) return failure;

      const suggest = (body.result as { suggest?: string } | undefined)?.suggest;
      // 没见过的 suggest 值当「没结论」处理：宁可多留一条待审，也不猜着放行。
      return SUGGEST_VERDICTS[suggest ?? ''] ?? this.unavailable('msgSecCheck', body);
    });
  }

  async checkImage(input: ImageCheckInput): Promise<ContentSecurityVerdict> {
    return this.attempt('imgSecCheck', async (token) => {
      const form = new FormData();
      // imgSecCheck 只收 multipart 的 media 字段，不接受图片 URL。
      form.append('media', new Blob([input.data]), input.filename ?? 'image');
      const body = await this.postForm(`${BASE}/wxa/img_sec_check?access_token=${token}`, form);
      const failure = this.failureOf('imgSecCheck', body);
      if (failure) return failure;
      // 图片接口没有 suggest：errcode 0 就是通过。
      return 'approved';
    });
  }

  /**
   * 取 token → 跑检查 → 兜住一切异常。
   *
   * token 取不到时 `fetch` 压根不会发出去，调用方拿到 `pending`：
   * 发布流程不该因为内容安全不可用而 500 —— 内容已经落库为待审，对他人本来就不可见。
   */
  private async attempt(
    label: string,
    run: (token: string) => Promise<ContentSecurityVerdict>,
  ): Promise<ContentSecurityVerdict> {
    try {
      return await run(await this.tokens.get());
    } catch (err) {
      this.logger.error(`${label} 调用失败，内容留在待审：${detail(err)}`);
      return 'pending';
    }
  }

  /** 命中违规 → `rejected`；其余非 0 的 errcode → 查不出结论。返回 null 表示这一关过了。 */
  private failureOf(
    label: string,
    body: Record<string, unknown>,
  ): ContentSecurityVerdict | null {
    const errcode = Number(body.errcode ?? 0);
    if (errcode === RISKY_ERRCODE) return 'rejected';
    if (errcode !== 0) return this.unavailable(label, body);
    return null;
  }

  private unavailable(label: string, body: Record<string, unknown>): ContentSecurityVerdict {
    this.logger.error(
      `${label} 未给出结论，内容留在待审：` +
        `errcode=${String(body.errcode ?? '')} errmsg=${String(body.errmsg ?? '')}`,
    );
    return 'pending';
  }

  private async postJson(url: string, payload: unknown): Promise<Record<string, unknown>> {
    return this.read(
      await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      }),
    );
  }

  private async postForm(url: string, form: FormData): Promise<Record<string, unknown>> {
    // 不手写 content-type：boundary 由 fetch 自己填。
    return this.read(await fetch(url, { method: 'POST', body: form }));
  }

  private async read(res: Response): Promise<Record<string, unknown>> {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as Record<string, unknown>;
  }
}

/** 异常里只取消息，不带栈：这条日志的用途是「哪一类失败」，不是排查我们自己的代码。 */
function detail(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
