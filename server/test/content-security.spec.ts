import type { AccessTokenService } from '../src/wechat/access-token.service';
import {
  shouldFakeContentSecurity,
  type ContentSecurityVerdict,
} from '../src/moderation/content-security';
import { FakeContentSecurityApi } from '../src/moderation/fake-content-security.api';
import { WechatContentSecurityApi } from '../src/moderation/wechat-content-security.api';

/**
 * 内容安全 DI seam 的三件事：开关的取值规格、假实现**绝不放行**、
 * 真实现失败时 fail-closed。
 *
 * 后两条是过审的必要条件（Global Constraint 17 / 18），不是风格偏好：
 * 只要有一条路径能因为「查不了」而落 `approved`，未审内容就会公开可见。
 */
describe('内容安全 DI seam', () => {
  const TEXT = { content: '今天带大黄去了公园', openid: 'o-1' };
  const IMAGE = { data: Buffer.from([0x89, 0x50, 0x4e, 0x47]), filename: 'a.png' };

  describe('shouldFakeContentSecurity', () => {
    it('只认字面 1，近义写法一概不算（与 shouldFakeWechatLogin 同规格）', () => {
      expect(shouldFakeContentSecurity('1')).toBe(true);
      for (const raw of ['true', 'TRUE', 'yes', '0', '', ' 1', '1 ', undefined]) {
        expect(shouldFakeContentSecurity(raw)).toBe(false);
      }
    });
  });

  describe('FakeContentSecurityApi', () => {
    const fake = new FakeContentSecurityApi();

    /**
     * 这条测试存在的唯一目的是防止有人「顺手」把假实现改成放行。
     * 假实现落 `approved` 的话，「未 approved 对他人不可见」那个安全测试
     * （test/post-visibility.security.spec.ts）就被测空了 —— 它再也验不到
     * 任何一条过滤路径，却仍然全绿。
     */
    it('文本与图片都落 pending，绝不落 approved（Global Constraint 17）', async () => {
      expect(await fake.checkText(TEXT)).toBe('pending');
      expect(await fake.checkImage(IMAGE)).toBe('pending');
    });
  });

  describe('WechatContentSecurityApi', () => {
    const realFetch = global.fetch;
    /** 每个用例自己塞。默认抛，避免忘记 stub 时静默打真网络。 */
    let handler: (url: string, init?: RequestInit) => Promise<Response>;
    let calls: { url: string; init?: RequestInit }[];

    const okJson = (body: unknown): Response =>
      ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

    /** token 拿得到的正常情形。 */
    const api = (token: () => Promise<string> = async () => 'tok-1'): WechatContentSecurityApi =>
      new WechatContentSecurityApi({ get: token } as unknown as AccessTokenService);

    beforeEach(() => {
      calls = [];
      handler = async () => {
        throw new Error('测试没有 stub 这次请求');
      };
      global.fetch = (async (url: string, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        return handler(String(url), init);
      }) as unknown as typeof fetch;
    });

    afterEach(() => {
      global.fetch = realFetch;
    });

    it('msgSecCheck 走 v2：带 access_token、openid、scene 与 content', async () => {
      handler = async () => okJson({ errcode: 0, result: { suggest: 'pass', label: 100 } });
      await api().checkText({ ...TEXT, scene: 4 });

      expect(calls).toHaveLength(1);
      expect(calls[0].url).toContain('/wxa/msg_sec_check');
      expect(calls[0].url).toContain('access_token=tok-1');
      expect(calls[0].init?.method).toBe('POST');
      expect(JSON.parse(String(calls[0].init?.body))).toEqual({
        version: 2,
        openid: 'o-1',
        scene: 4,
        content: TEXT.content,
      });
    });

    it('scene 缺省落 4（社交日志：动态发布）', async () => {
      handler = async () => okJson({ errcode: 0, result: { suggest: 'pass' } });
      await api().checkText(TEXT);
      expect(JSON.parse(String(calls[0].init?.body)).scene).toBe(4);
    });

    it('suggest 三态各自映射：pass → approved、risky → rejected、review → pending', async () => {
      const cases: [string, ContentSecurityVerdict][] = [
        ['pass', 'approved'],
        ['risky', 'rejected'],
        // review 是「机器不敢判，要人看」：还没结论，留在待审而不是放行。
        ['review', 'pending'],
      ];
      for (const [suggest, expected] of cases) {
        handler = async () => okJson({ errcode: 0, result: { suggest } });
        expect(await api().checkText(TEXT)).toBe(expected);
      }
    });

    it('errcode 87014（命中违规）→ rejected', async () => {
      handler = async () => okJson({ errcode: 87014, errmsg: 'risky content hint' });
      expect(await api().checkText(TEXT)).toBe('rejected');
    });

    /**
     * fail-closed 的正面表述：**任何**查不出结论的情形都落 pending。
     * 这里逐条列出真实会遇到的失败形态，因为「大部分失败都 pending」不算 fail-closed ——
     * 漏一条就够了。
     */
    it('所有失败形态一律 pending，没有一条能落 approved（Global Constraint 18）', async () => {
      const failures: [string, () => void][] = [
        [
          '网络异常',
          () => {
            handler = async () => {
              throw new Error('ECONNRESET');
            };
          },
        ],
        [
          'HTTP 非 2xx',
          () => {
            handler = async () =>
              ({ ok: false, status: 500, json: async () => ({}) }) as unknown as Response;
          },
        ],
        [
          '响应不是 JSON',
          () => {
            handler = async () =>
              ({
                ok: true,
                status: 200,
                json: async () => {
                  throw new Error('Unexpected token < in JSON');
                },
              }) as unknown as Response;
          },
        ],
        [
          'token 失效（40001）',
          () => {
            handler = async () => okJson({ errcode: 40001, errmsg: 'invalid credential' });
          },
        ],
        [
          '配额耗尽（45009）',
          () => {
            handler = async () => okJson({ errcode: 45009, errmsg: 'api freq out of limit' });
          },
        ],
        [
          'errcode 0 但没有 result（响应形状变了）',
          () => {
            handler = async () => okJson({ errcode: 0 });
          },
        ],
        [
          'suggest 是没见过的值',
          () => {
            handler = async () => okJson({ errcode: 0, result: { suggest: 'whatever' } });
          },
        ],
      ];

      for (const [label, arrange] of failures) {
        arrange();
        const verdict = await api().checkText(TEXT);
        expect([label, verdict]).toEqual([label, 'pending']);
      }
    });

    it('取不到 access_token 时也是 pending，而不是把异常抛给调用方', async () => {
      // 发布流程不该因为内容安全不可用而 500：动态已经落库为 pending，
      // 对他人本来就不可见，等下一次检查即可。
      const verdict = await api(async () => {
        throw new Error('Redis 挂了');
      }).checkText(TEXT);
      expect(verdict).toBe('pending');
      expect(calls).toHaveLength(0);
    });

    it('imgSecCheck 走 multipart 的 media 字段', async () => {
      handler = async () => okJson({ errcode: 0, errmsg: 'ok' });
      expect(await api().checkImage(IMAGE)).toBe('approved');

      expect(calls[0].url).toContain('/wxa/img_sec_check');
      expect(calls[0].url).toContain('access_token=tok-1');
      const body = calls[0].init?.body as unknown as FormData;
      expect(body).toBeInstanceOf(FormData);
      expect(body.get('media')).toBeInstanceOf(Blob);
    });

    it('图片：87014 → rejected，失败一律 pending', async () => {
      handler = async () => okJson({ errcode: 87014, errmsg: 'risky' });
      expect(await api().checkImage(IMAGE)).toBe('rejected');

      handler = async () => {
        throw new Error('socket hang up');
      };
      expect(await api().checkImage(IMAGE)).toBe('pending');
    });

    it('errcode / errmsg 只进日志，不进返回值也不进异常（Global Constraint 5）', async () => {
      const errmsg = 'risky content: 这里是微信返回的原文';
      handler = async () => okJson({ errcode: 87014, errmsg });
      const verdict = await api().checkText(TEXT);
      // 返回值只有三种字面量，天然带不出上游文案；这里断言的是「没抛出来」。
      expect(verdict).toBe('rejected');
      expect(JSON.stringify(verdict)).not.toContain(errmsg);
    });
  });
});
