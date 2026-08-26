/**
 * 阶段 2 演示走查（真实 HTTP，真库 + 真 Redis）。
 *
 * 不是自动化测试的替代品 —— 它按用户的真实路线把端点串一遍，逐条打印响应，
 * 结果抄进 docs/superpowers/phase2-notes.md。跑法（服务端已在 3100 起着）：
 *   node test/manual/phase2-walkthrough.mjs
 *
 * 服务端需要的环境：DATABASE_URL / REDIS_URL / FAKE_WECHAT_LOGIN=1 /
 * FAKE_CONTENT_SECURITY=1。两个开关都是本地联调用的，部署环境必须关掉。
 *
 * 跑完会在库里留下一个用户、一只宠物（带一张照片）、一条动态、两次收藏与三条历史 ——
 * 有意不清理，跑完可以直接在小程序里翻。代价是**测试断言不能写死全表行数**：
 * 「全库正好 8 只宠物」那两条就是这么红的（见 phase2-notes 第一节第 4 条）。
 */
const BASE = process.env.WALKTHROUGH_BASE ?? 'http://127.0.0.1:3100';

let step = 0;
const log = (title, detail) => {
  step += 1;
  console.log(`\n[${String(step).padStart(2, '0')}] ${title}`);
  if (detail !== undefined) console.log(detail);
};
const show = (v) => JSON.stringify(v);

async function call(method, path, { token, body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) {
    payload = form;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${path}`, { method, headers, body: payload });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 80) };
  }
  return { status: res.status, code: json.code, message: json.message, data: json.data, headers: res.headers };
}

const must = (cond, what) => {
  if (!cond) throw new Error(`走查断言失败：${what}`);
};

// 1×1 PNG。机审按魔数嗅探类型，宽高是表单里声明的那两个数（Global Constraint 21），
// 所以最小的合法 PNG 就够走通上传这一环。
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

async function main() {
  // —— 登录 ——
  // 每轮换一对 code：走查会改昵称、建宠物、发动态，复用同一个用户跑第二遍时
  // 「新用户昵称是占位值」这类断言必然假红。
  const run = Date.now().toString(36);
  const a = await call('POST', '/auth/wx-login', { body: { code: `walkthrough-a-${run}` } });
  const b = await call('POST', '/auth/wx-login', { body: { code: `walkthrough-b-${run}` } });
  must(a.status === 201 || a.status === 200, `登录返回 ${a.status}`);
  const tokenA = a.data.token;
  const tokenB = b.data.token;
  log(
    '登录（FAKE_WECHAT_LOGIN，两个 code 换两个用户）',
    `A userId=${a.data.userId} isNewUser=${a.data.isNewUser}\nB userId=${b.data.userId} isNewUser=${b.data.isNewUser}`,
  );

  const noAuth = await call('GET', '/me');
  log('未登录 GET /me', `${noAuth.status} ${noAuth.code} ${noAuth.message}`);
  must(noAuth.status === 401, '未登录应 401');

  // —— 个人中心 ——
  const before = await call('GET', '/me');
  const me0 = await call('GET', '/me', { token: tokenA });
  log('GET /me（改名前）', show(me0.data));
  must(me0.data.nickname === '微信用户', '新用户昵称应是占位值');

  const patched = await call('PUT', '/me', {
    token: tokenA,
    body: { nickname: '走查阿康', avatarUrl: 'https://picsum.photos/seed/walk-a/200/200' },
  });
  log('PUT /me 改昵称与头像', show(patched.data));
  must(patched.data.nickname === '走查阿康', '昵称应已改');

  const tooLong = await call('PUT', '/me', { token: tokenA, body: { nickname: '康'.repeat(21) } });
  log('PUT /me 昵称 21 字', `${tooLong.status} ${tooLong.code} ${tooLong.message}`);
  const empty = await call('PUT', '/me', { token: tokenA, body: {} });
  log('PUT /me 一个可改字段都不给', `${empty.status} ${empty.code} ${empty.message}`);

  // —— 建宠物 ——
  const created = await call('POST', '/pets', {
    token: tokenA,
    body: { name: '走查小布', species: 'cat', breed: '布偶', gender: 'female', bio: '走查用的猫' },
  });
  log('POST /pets（只给名字物种之外的可选项，不给生日）', show(created.data));
  const petId = created.data.id;
  must(petId, '建宠物应返回 id');

  const badSpecies = await call('POST', '/pets', { token: tokenA, body: { name: 'x', species: 'all' } });
  log('POST /pets species=all（筛选用伪物种）', `${badSpecies.status} ${badSpecies.code} ${badSpecies.message}`);

  const myPets = await call('GET', '/me/pets', { token: tokenA });
  log('GET /me/pets（不分页、含没有封面的新宠物）', show(myPets.data));
  must(myPets.data.items.some((p) => p.id === petId), '新宠物应在我的宠物里');
  must(myPets.data.hasMore === undefined, '这个端点刻意没有 hasMore');

  const detailNew = await call('GET', `/pets/${petId}`);
  log('GET /pets/:id（刚建好、没有照片）', `${detailNew.status} photos=${detailNew.data?.photos.length}`);
  must(detailNew.status === 200, '没有照片的宠物详情也必须打得开');

  // —— 传图 ——
  const form = new FormData();
  form.set('file', new Blob([PNG_1PX], { type: 'image/png' }), 'walk.png');
  form.set('width', '800');
  form.set('height', '600');
  const up = await call('POST', '/uploads', { token: tokenA, form });
  log('POST /uploads（multipart + 真实宽高）', show(up.data));
  const imageUrl = up.data.url;
  must(up.data.auditStatus === 'pending', 'FAKE_CONTENT_SECURITY 必须落 pending 而不是 approved');

  const noDim = new FormData();
  noDim.set('file', new Blob([PNG_1PX], { type: 'image/png' }), 'walk.png');
  const upNoDim = await call('POST', '/uploads', { token: tokenA, form: noDim });
  log('POST /uploads 不给宽高', `${upNoDim.status} ${upNoDim.code} ${upNoDim.message}`);

  const notImage = new FormData();
  notImage.set('file', new Blob([Buffer.from('#!/bin/sh\necho hi\n')], { type: 'image/png' }), 'shell.png');
  notImage.set('width', '10');
  notImage.set('height', '10');
  const upFake = await call('POST', '/uploads', { token: tokenA, form: notImage });
  log('POST /uploads 改名成 .png 的脚本（按魔数嗅探）', `${upFake.status} ${upFake.code} ${upFake.message}`);

  const mine = await call('GET', imageUrl, { token: tokenA });
  const others = await call('GET', imageUrl, { token: tokenB });
  const anon = await call('GET', imageUrl);
  log('待审图片的可见性', [
    `作者本人 ${mine.status} cache-control=${mine.headers.get('cache-control')}`,
    `其他用户 ${others.status} ${others.code ?? ''}`,
    `未登录   ${anon.status} ${anon.code ?? ''}`,
  ].join('\n'));
  must(mine.status === 200 && others.status === 404 && anon.status === 404, '待审图片只对作者可见');

  const photo = await call('POST', `/pets/${petId}/photos`, {
    token: tokenA,
    body: { url: imageUrl, width: 800, height: 600 },
  });
  log('POST /pets/:id/photos（第一张自动成为封面）', show(photo.data));
  const withCover = await call('GET', `/pets/${petId}`);
  const cover = withCover.data.photos[0];
  log('回读详情的照片', `photos=${withCover.data.photos.length} ${cover.width}×${cover.height} ${cover.url}`);
  const summary = await call('GET', '/me/pets', { token: tokenA });
  const mineNow = summary.data.items.find((p) => p.id === petId);
  log('回读「我的宠物」的封面指针', `coverUrl=${mineNow.coverUrl} ${mineNow.coverWidth}×${mineNow.coverHeight}`);
  must(mineNow.coverUrl === imageUrl, '第一张照片应自动成为封面');

  // —— 关注 ——
  const followSelf = await call('POST', `/pets/${petId}/follow`, { token: tokenA });
  log('关注自己的宠物', `${followSelf.status} ${followSelf.code} ${followSelf.message}`);
  const follow1 = await call('POST', '/pets/p-2/follow', { token: tokenA });
  const follow2 = await call('POST', '/pets/p-2/follow', { token: tokenA });
  log('POST /pets/p-2/follow ×2（幂等）', `${follow1.status} ${show(follow1.data)} → ${follow2.status} ${show(follow2.data)}`);
  const followMissing = await call('POST', '/pets/p-不存在/follow', { token: tokenA });
  log('关注不存在的宠物', `${followMissing.status} ${followMissing.code} ${followMissing.message}`);
  const petDetail = await call('GET', '/pets/p-2', { token: tokenA });
  log('GET /pets/p-2 带登录态', `isFollowing=${petDetail.data.isFollowing} isFavorite=${petDetail.data.isFavorite}`);
  const following = await call('GET', '/me/following', { token: tokenA, });
  log('GET /me/following', `${following.data.items.length} 只：${following.data.items.map((p) => p.name).join('、')}，hasMore=${following.data.hasMore}`);

  // —— 收藏 ——
  await call('POST', '/pets/p-3/favorite', { token: tokenA });
  await call('POST', '/venues/v-1/favorite', { token: tokenA });
  const favorites = await call('GET', '/me/favorites', { token: tokenA });
  log(
    'GET /me/favorites（pet 与 venue 混排，按收藏时间倒序）',
    favorites.data.items.map((it) => `${it.targetType}:${it.title}`).join('、'),
  );
  must(favorites.data.items.length === 2, '两条收藏都应回来');

  // —— 浏览历史 ——
  await call('GET', '/pets/p-5', { token: tokenA });
  await call('GET', '/venues/v-9', { token: tokenA });
  await new Promise((r) => setTimeout(r, 600)); // 历史是异步写的（不阻塞详情响应）
  const history = await call('GET', '/me/history', { token: tokenA });
  log(
    'GET /me/history（按 viewed_at 倒序）',
    history.data.items.map((it) => `${it.targetType}:${it.title}`).join('、'),
  );

  // —— 发动态 ——
  const emptyPost = await call('POST', '/posts', { token: tokenA, body: { petId, content: '   ' } });
  log('POST /posts 空内容', `${emptyPost.status} ${emptyPost.code} ${emptyPost.message}`);
  const post = await call('POST', '/posts', {
    token: tokenA,
    body: {
      petId,
      content: '走查：第一条动态，带一张刚上传的图。',
      images: [{ url: imageUrl, width: 800, height: 600 }],
    },
  });
  log('POST /posts', `auditStatus=${post.data.auditStatus} images=${post.data.images.map((i) => i.auditStatus).join(',')} petName=${post.data.petName}`);
  must(post.data.auditStatus === 'pending', '发布响应恒为 pending');
  const postId = post.data.id;

  const notMyPet = await call('POST', '/posts', { token: tokenB, body: { petId, content: '替别人的宠物发' } });
  log('拿别人的宠物发动态', `${notMyPet.status} ${notMyPet.code} ${notMyPet.message}`);

  // —— 验可见性 ——
  const listAuthor = await call('GET', `/posts?petId=${petId}`, { token: tokenA });
  const listOther = await call('GET', `/posts?petId=${petId}`, { token: tokenB });
  const listAnon = await call('GET', `/posts?petId=${petId}`);
  log('GET /posts?petId= 三种身份', [
    `作者本人 ${listAuthor.data.items.length} 条，hasMore=${listAuthor.data.hasMore}，状态=${listAuthor.data.items.map((p) => p.auditStatus).join(',')}`,
    `其他用户 ${listOther.data.items.length} 条，hasMore=${listOther.data.hasMore}`,
    `未登录   ${listAnon.data.items.length} 条，hasMore=${listAnon.data.hasMore}`,
  ].join('\n'));
  must(listAuthor.data.items.length === 1, '作者应看到自己的待审动态');
  must(listOther.data.items.length === 0 && listAnon.data.items.length === 0, '待审动态对他人必须不可见');

  const detailAuthor = await call('GET', `/posts/${postId}`, { token: tokenA });
  const detailOther = await call('GET', `/posts/${postId}`, { token: tokenB });
  const detailAnon = await call('GET', `/posts/${postId}`);
  log('GET /posts/:id 三种身份', [
    `作者本人 ${detailAuthor.status} images=${detailAuthor.data.images.length}`,
    `其他用户 ${detailOther.status} ${detailOther.code} ${detailOther.message}`,
    `未登录   ${detailAnon.status} ${detailAnon.code} ${detailAnon.message}`,
  ].join('\n'));
  must(detailOther.status === 404 && detailAnon.status === 404, '看不见的动态必须 404 而不是 403');

  // 种子里的 p-5 有一条 approved（po-3，挂着 pi-4 approved + pi-6 pending）与一条
  // rejected（po-5）。陌生人视角同时验两件事：只看得到 approved 那条，且那条里
  // 未过审的图不返回、文字照常显示（图片与动态的审核状态各自独立）。
  const seedOther = await call('GET', '/posts?petId=p-5', { token: tokenB });
  log(
    'GET /posts?petId=p-5（陌生人看种子动态）',
    seedOther.data.items.map((p) => `${p.id}:${p.auditStatus}:${p.images.length}图`).join('、'),
  );
  must(seedOther.data.items.length === 1, '陌生人只应看到 approved 的那条');
  must(seedOther.data.items[0].images.length === 1, '同一条动态里未过审的图不能返回');

  // —— 个人中心聚合计数 ——
  const meFinal = await call('GET', '/me', { token: tokenA });
  log('GET /me（走查后的聚合计数）', show(meFinal.data));

  console.log('\n全部走查步骤通过。');
  void before;
}

main().catch((err) => {
  console.error(`\n走查中断：${err.message}`);
  process.exit(1);
});
