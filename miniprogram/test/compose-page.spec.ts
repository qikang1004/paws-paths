import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { findBarePx, findHexLiterals, findUndefinedVars } from '../tools/style-guard';
import {
  countChars,
  POST_CONTENT_MAX_LENGTH,
  POST_IMAGES_MAX_COUNT,
  toPublishBody,
  validatePostForm,
  type ComposeImage,
  type PostForm,
} from '../packages/post/pages/compose/compose-model';

const ROOT = resolve(__dirname, '..');
const TOKENS = readFileSync(join(ROOT, 'styles/tokens.wxss'), 'utf8');
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');
const DIR = 'packages/post/pages/compose';

const form = (over: Partial<PostForm> = {}): PostForm => ({
  petId: 'p-1',
  content: '今天遛了三公里',
  images: [],
  ...over,
});

/**
 * 发布页。上限与文案跟服务端 `parsePostCreate` 对齐 —— 客户端先挡一道纯粹是为了
 * 省一次白跑的请求，两边不一致时用户会看着「还没到上限」被拒。
 */
describe('发布动态表单', () => {
  it('上限与服务端一致', () => {
    expect(POST_CONTENT_MAX_LENGTH).toBe(500);
    expect(POST_IMAGES_MAX_COUNT).toBe(9);
  });

  it('按码点数字数：500 个 emoji 是 500 字，不是 1000', () => {
    expect(countChars('🐶🐱')).toBe(2);
    expect(validatePostForm(form({ content: '🐶'.repeat(500) })).ok).toBe(true);
    const over = validatePostForm(form({ content: '🐶'.repeat(501) }));
    expect(over.ok).toBe(false);
    expect(over.message).toBe('动态内容不能超过 500 字');
  });

  it('没选宠物不让发 —— 动态是发在宠物名下的', () => {
    expect(validatePostForm(form({ petId: '' }))).toEqual({ ok: false, message: '先选一只宠物' });
  });

  it('只有空白算没写', () => {
    expect(validatePostForm(form({ content: '   \n ' }))).toEqual({
      ok: false,
      message: '说点什么再发吧',
    });
  });

  it('图片超量拦在本地，不白传一次', () => {
    const images = Array.from({ length: 10 }, (_, i) => ({
      url: `/uploads/u-1/${i}.jpg`,
      width: 100,
      height: 200,
    }));
    expect(validatePostForm(form({ images }))).toEqual({
      ok: false,
      message: '最多只能发 9 张图',
    });
  });

  it('入参只带 url 与宽高：客户端报的审核状态服务端一概不读，别发过去', () => {
    // 上传接口回的就是这个形状（`UploadedImage` 多一个 auditStatus）。
    const uploaded: ComposeImage & { auditStatus: string } = {
      url: '/uploads/u-1/a.jpg',
      width: 800,
      height: 600,
      auditStatus: 'approved',
    };
    const body = toPublishBody(form({ content: '  阳光很好  ', images: [uploaded] }));
    expect(body).toEqual({
      petId: 'p-1',
      content: '阳光很好',
      images: [{ url: '/uploads/u-1/a.jpg', width: 800, height: 600 }],
    });
  });
});

describe('发布页配置与结构', () => {
  it('json 声明选图器与按钮', () => {
    const json = JSON.parse(read(`${DIR}/index.json`)) as {
      navigationBarTitleText?: string;
      usingComponents?: Record<string, string>;
    };
    expect(json.navigationBarTitleText).toBe('发动态');
    const used = json.usingComponents ?? {};
    expect(used['sq-button']).toBe('/components/sq-button/index');
    expect(used['media-picker']).toBe('/components/media-picker/index');
    expect(used['empty-state']).toBe('/components/empty-state/index');
  });

  it('wxml 有宠物选择、字数、选图与提交', () => {
    const wxml = read(`${DIR}/index.wxml`);
    expect(wxml).toContain('wx:for="{{pets}}"');
    expect(wxml).toContain('bindtap="onPetTap"');
    expect(wxml).toContain('bindinput="onContentInput"');
    expect(wxml).toContain('{{contentCount}}/{{contentMax}}');
    expect(wxml).toContain('<media-picker');
    expect(wxml).toContain('bind:pick="onPickPhotos"');
    expect(wxml).toContain('bind:remove="onRemovePhoto"');
    expect(wxml).toContain('bind:tap="onSubmit"');
    expect(wxml).toContain('loading="{{submitting}}"');
    // 发布响应恒为 pending，页面得提前说清「过审前只有自己看得到」。
    expect(wxml).toContain('审核');
    // 一只宠物都没有时不该给一个发不出去的表单。
    expect(wxml).toContain('wx:if="{{!pets.length}}"');
    expect(wxml).toContain('<empty-state');
  });

  it('页面 ts 经封装选图上传，不自己调 wx.chooseMedia', () => {
    const ts = read(`${DIR}/index.ts`);
    expect(ts).toContain('fetchMyPets');
    expect(ts).toContain('buildPetOptions');
    expect(ts).toContain('resolvePetId');
    expect(ts).toContain('pickAndUploadImages');
    expect(ts).toContain('publishPost');
    expect(ts).toContain('validatePostForm');
    expect(ts).toContain('toPublishBody');
    expect(ts).toContain('navigateBack');
    // Global Constraint 21：宽高必须是 chooseMedia 给的真值，页面不碰选图。
    expect(ts).not.toContain('wx.chooseMedia');
    expect(ts).not.toContain('wx.request');
  });

  it('wxss 不出现色值字面量、裸 px、未定义 token', () => {
    const css = read(`${DIR}/index.wxss`);
    expect(findHexLiterals(css)).toEqual([]);
    expect(findBarePx(css)).toEqual([]);
    expect(findUndefinedVars(css, TOKENS)).toEqual([]);
  });
});
