/**
 * 阶段 4 走查：运营后台的登录链（真实 HTTP，真库 + 真 Redis）。
 *
 * 阶段 3 那份走查（`phase3-walkthrough.mjs`）拿运营令牌的方式是
 * `POST /auth/wx-login` 传 `code: 'moderator'` —— 靠 `FAKE_WECHAT_LOGIN` 派生出
 * 种子 `u-mod` 的 openid。那条路**一行都不经过密码登录**，所以 `admin-login`、
 * 两列迁移、CLI 建出来的账号至今没有任何端到端证据。这份补上那一段。
 *
 * 跑法（服务端已在 3100 起着）：
 *   node test/manual/phase4-walkthrough.mjs
 *
 * 前置：先用 CLI 建一个账号（这是唯一的加人入口，刻意没有 HTTP 端点）：
 *   echo 'walkthrough-password-1' | DATABASE_URL=... node dist/scripts/create-admin.js wt-ops moderator
 *
 * 凭据从环境变量读，默认 `wt-ops` / `walkthrough-password-1`：
 *   WALKTHROUGH_ADMIN_USER / WALKTHROUGH_ADMIN_PASS
 *
 * 服务端需要：DATABASE_URL / REDIS_URL。**不需要** FAKE_WECHAT_LOGIN ——
 * 这条链压根不碰微信（那正是它的意义：运营账号可以没有微信身份）。
 */
const BASE = process.env.WALKTHROUGH_BASE ?? 'http://127.0.0.1:3100';
const USER = process.env.WALKTHROUGH_ADMIN_USER ?? 'wt-ops';
const PASS = process.env.WALKTHROUGH_ADMIN_PASS ?? 'walkthrough-password-1';

/**
 * 限流探测默认**关着**。
 *
 * `admin-login` 同时按用户名与 IP 计数，一小时各 10 次。跑一次「打到 429」会把
 * **这台机器的 IP 配额烧掉一小时** —— 之后这份走查本身也登不进去了，得等窗口过期。
 * 所以它是显式开关：`WALKTHROUGH_PROBE_RATE_LIMIT=1`，且必须放在最后一段。
 */
const PROBE_RATE_LIMIT = process.env.WALKTHROUGH_PROBE_RATE_LIMIT === '1';

let step = 0;
const log = (title, detail) => {
  step += 1;
  console.log(`\n[${String(step).padStart(2, '0')}] ${title}`);
  if (detail !== undefined) console.log(detail);
};
const show = (v) => JSON.stringify(v);

async function call(method, path, { token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (body !== undefined) {
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
  return { status: res.status, code: json.code, message: json.message, data: json.data };
}

const must = (cond, what) => {
  if (!cond) throw new Error(`走查断言失败：${what}`);
};

const login = (username, password) =>
  call('POST', '/auth/admin-login', { body: { username, password } });

/** JWT 的 payload。**只解不验** —— 验签是服务端的事，这里只看里面有什么。 */
function payloadOf(token) {
  const [, mid] = token.split('.');
  return JSON.parse(Buffer.from(mid, 'base64url').toString('utf8'));
}

async function main() {
  // —— 登录成功 ——
  const ok = await login(USER, PASS);
  must(
    ok.status === 200,
    `登录失败（${ok.status} ${ok.code} ${ok.message}）—— 先用 CLI 建 ${USER}：\n` +
      `  echo '${PASS}' | DATABASE_URL=... node dist/scripts/create-admin.js ${USER} moderator`,
  );
  const token = ok.data.token;
  log('POST /auth/admin-login 正确凭据', `200 role=${ok.data.role} userId=${ok.data.userId}`);

  /**
   * `@HttpCode(200)` 而不是 Nest 给 POST 的默认 201：登录不创建资源。
   * `wx-login` 那条是历史形状（201），后台是新写的，没跟着错。
   */
  must(ok.status === 200, '登录应是 200 而不是 201（没有创建任何资源）');

  // —— 令牌里不带角色（Global Constraint 28）——
  const claims = payloadOf(token);
  log('令牌的 payload', show(claims));
  must(claims.sub === ok.data.userId, 'sub 应是 userId');
  must(!('role' in claims), '令牌里不许带 role —— 带了撤权就要等令牌过期才生效');
  // 运营账号没有微信身份，openid 签的是空串（不是 null —— 那会让下游判空判两次）。
  must(claims.openid === '', '运营令牌的 openid 应是空串');

  // —— 响应体不含凭据 ——
  must(!('passwordHash' in ok.data) && !('password' in ok.data), '响应体不许回任何凭据字段');
  must(!('openid' in ok.data), '响应体不下发 openid');

  // —— 这个令牌真的能用 ——
  const tasks = await call('GET', '/moderation/tasks?pageSize=20', { token });
  log('GET /moderation/tasks（用密码登录拿到的令牌）', `${tasks.status} ${tasks.data?.items?.length ?? '-'} 条待处理`);
  must(tasks.status === 200, '密码登录的令牌应能访问运营端点');
  must(Array.isArray(tasks.data.items), '应返回 items 数组');

  /**
   * 前端页大小上限 20 与服务端 `parseListQuery` 对齐 —— 超了是 422。
   * 后台真发过 21 就会在生产上翻车，这里钉一下。
   */
  const tooBig = await call('GET', '/moderation/tasks?pageSize=21', { token });
  log('GET /moderation/tasks?pageSize=21', `${tooBig.status} ${tooBig.code} ${tooBig.message}`);
  must(tooBig.status === 422, '页大小超过 20 应 422（后台固定发 20）');

  // —— 已处理工单的历史（阶段 4 新增）——
  const handled = await call('GET', '/moderation/tasks/handled?pageSize=20', { token });
  log('GET /moderation/tasks/handled', `${handled.status} ${handled.data?.items?.length ?? '-'} 条已处理`);
  must(handled.status === 200, '运营应能读已处理工单');
  must(Array.isArray(handled.data.items), '应返回 items 数组');
  // 这条路径**只**出已处理的 —— 混进未处理的等于把待办队列泄进历史。
  must(
    handled.data.items.every((row) => row.result !== null && row.result !== undefined),
    '已处理列表里不该出现 result 为空的工单',
  );
  if (handled.data.items.length > 0) {
    const row = handled.data.items[0];
    log('最近一条已处理工单', show(row));
    must(typeof row.handledAt === 'string', '应带处理时间');
    must('handledByName' in row, '应带复核人显示名这个键（值可能是 null）');
    // 举报人仍然不下发 —— 回看时也不需要知道，下发只多一条报复路径。
    must(!('reportedBy' in row), '已处理列表不该下发举报人');
  }

  const handledTooBig = await call('GET', '/moderation/tasks/handled?pageSize=21', { token });
  must(handledTooBig.status === 422, '已处理列表的页大小上限也是 20');

  // —— 单条内容的审核历史（阶段 4 新增）——
  // 挑一条已处理工单的目标来查 —— 它一定有流水（举报一条 + 复核一条）。
  const sample = handled.data.items[0];
  if (sample) {
    const q = `?targetType=${sample.targetType}&targetId=${encodeURIComponent(sample.targetId)}`;
    const history = await call('GET', `/moderation/audit-logs/by-target${q}`, { token });
    log('GET /moderation/audit-logs/by-target', `${history.status} ${history.data?.items?.length ?? '-'} 条`);
    must(history.status === 200, '应能查单条内容的历史');
    must(history.data.items.length >= 2, '举报 + 复核至少两条流水');
    must(
      history.data.items.every((row) => row.targetId === sample.targetId),
      '不该混进别的目标的流水',
    );
    // 不分页：这两个字段不该出现。
    must(!('hasMore' in history.data), '单条历史不分页，不该有 hasMore');
    must(!('page' in history.data), '单条历史不分页，不该有 page');
  } else {
    log('跳过单条历史', '这个库还没有已处理的工单 —— 先跑一遍 phase3-walkthrough.mjs');
  }

  const badType = await call('GET', '/moderation/audit-logs/by-target?targetType=pet_photo&targetId=x', {
    token,
  });
  must(badType.status === 422 && badType.code === 42204, '未知 targetType 应是 42204');
  const noId = await call('GET', '/moderation/audit-logs/by-target?targetType=post', { token });
  must(noId.status === 422 && noId.code === 42200, '缺 targetId 应是通用校验失败');
  log('单条历史的入参校验', `未知类型 ${badType.code} / 缺 id ${noId.code}`);

  // —— 流水列表（阶段 4 新增的端点）——
  const logs = await call('GET', '/moderation/audit-logs?pageSize=20', { token });
  log('GET /moderation/audit-logs', `${logs.status} ${logs.data?.items?.length ?? '-'} 条流水`);
  must(logs.status === 200, '运营应能读流水');
  must(Array.isArray(logs.data.items), '应返回 items 数组');

  if (logs.data.items.length > 0) {
    const row = logs.data.items[0];
    log('最近一条流水', show(row));
    // 流水**不带内容原文** —— 它要比它记录的目标活得久（动态被删了，
    // 「谁撤下了它」仍必须查得到）。
    must(!('content' in row), '流水不该带内容原文');
    must(!('imageUrls' in row), '流水不该带图片');
    must('actorName' in row, '流水应带操作人显示名这个键（值可能是 null）');
    must(typeof row.action === 'string', '流水应带动作');
    must(typeof row.statusBefore === 'string' && typeof row.statusAfter === 'string', '应带前后状态');
  } else {
    log('流水是空的', '这个库还没有任何审核动作 —— 先跑一遍 phase3-walkthrough.mjs');
  }

  // 只读：这张表没有写入端点，也不该有。
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const res = await call(method, '/moderation/audit-logs', { token, body: {} });
    must(res.status === 404, `${method} /moderation/audit-logs 应是 404，实际 ${res.status}`);
  }
  log('流水没有写入端点', '四个动词全 404 —— 流水只由复核流程在自己的事务里追加');

  for (const path of [
    '/moderation/audit-logs',
    '/moderation/tasks/handled',
    '/moderation/audit-logs/by-target?targetType=post&targetId=x',
  ]) {
    const res = await call('GET', path);
    must(res.status === 401, `未登录读 ${path} 应 401，实际 ${res.status}`);
  }
  log('未登录读三条运营端点', '全 401');

  // —— 两种失败必须无法区分（防枚举）——
  const wrongPass = await login(USER, `${PASS}-wrong`);
  const noSuchUser = await login(`no-such-${Date.now().toString(36)}`, PASS);
  log('两种失败的响应', [
    `密码错     ${wrongPass.status} ${wrongPass.code} ${wrongPass.message}`,
    `用户不存在 ${noSuchUser.status} ${noSuchUser.code} ${noSuchUser.message}`,
  ].join('\n'));
  must(wrongPass.status === 401 && noSuchUser.status === 401, '两者都应 401');
  must(
    wrongPass.code === noSuchUser.code && wrongPass.message === noSuchUser.message,
    '两者的响应体必须一字不差 —— 否则能问出「这个用户名存在」',
  );

  // —— 缺字段是 422 而不是 401 ——
  const noPass = await call('POST', '/auth/admin-login', { body: { username: USER } });
  const noUser = await call('POST', '/auth/admin-login', { body: { password: PASS } });
  const empty = await call('POST', '/auth/admin-login', { body: {} });
  log('入参校验', [
    `只给用户名 ${noPass.status} ${noPass.code} ${noPass.message}`,
    `只给密码   ${noUser.status} ${noUser.code} ${noUser.message}`,
    `空 body    ${empty.status} ${empty.code} ${empty.message}`,
  ].join('\n'));
  must(noPass.status === 422 && noUser.status === 422 && empty.status === 422, '缺字段应 422');
  must(noPass.code === 42200, '缺字段应是通用校验失败，不是 401');

  // —— 小程序用户走不了密码登录 ——
  // 种子 u-1 的 username / password_hash 都是 NULL，用它的 id 当用户名试。
  const wxUser = await login('u-1', PASS);
  log('拿小程序用户的 id 当用户名登录', `${wxUser.status} ${wxUser.code} ${wxUser.message}`);
  must(wxUser.status === 401, '没有用户名的用户应登不进来');
  must(wxUser.message === wrongPass.message, '与密码错同一个响应');

  // —— 没有注册端点 ——
  for (const path of ['/auth/admin-register', '/auth/register', '/auth/admin-signup']) {
    const res = await call('POST', path, { body: { username: 'x', password: 'y' } });
    must(res.status === 404, `${path} 必须不存在（运营账号只能从 CLI 建），实际 ${res.status}`);
  }
  log('注册端点', '三个常见路径全是 404 —— 运营账号不该能从公网创建');

  // —— 未登录 / 坏令牌访问运营端点 ——
  const anon = await call('GET', '/moderation/tasks');
  const bad = await call('GET', '/moderation/tasks', { token: 'not-a-jwt' });
  log('运营端点的鉴权', [
    `未登录   ${anon.status} ${anon.code}`,
    `坏令牌   ${bad.status} ${bad.code}`,
  ].join('\n'));
  must(anon.status === 401 && bad.status === 401, '未登录与坏令牌都应 401');

  if (!PROBE_RATE_LIMIT) {
    log(
      '限流探测已跳过（默认）',
      '打到 429 会把这台机器的 IP 配额烧掉一小时，之后本走查自己也登不进去。\n' +
        '要验就单独跑：WALKTHROUGH_PROBE_RATE_LIMIT=1 node test/manual/phase4-walkthrough.mjs\n' +
        '（跑完那一小时内别再跑这份走查，或换一台机器/等窗口过期）',
    );
    console.log('\n全部走查步骤通过。');
    return;
  }

  /**
   * 限流。一小时 10 次，用户名与 IP 各一条，**哪条先满都是 429**。
   *
   * 这一段刻意放在最后：它一旦跑完，这台机器的 IP 桶就满了 —— 上面每一步
   * 都得在它之前完成。用一个不存在的用户名，这样用户名那条桶烧的是垃圾键，
   * 真账号的桶留着（虽然 IP 桶还是会满 —— 那躲不掉，见上面的注释）。
   */
  const probe = `rl-probe-${Date.now().toString(36)}`;
  let hit429 = 0;
  let attempts = 0;
  for (let i = 0; i < 14; i += 1) {
    const res = await login(probe, 'whatever-password');
    attempts += 1;
    if (res.status === 429) {
      hit429 += 1;
      if (hit429 === 1) log('第几次撞上 429', `第 ${attempts} 次（上限 10，窗口 3600s）`);
      if (hit429 >= 2) break;
    }
  }
  must(hit429 > 0, `连试 ${attempts} 次都没触发限流 —— 检查 REDIS_URL 是否真的连上了`);

  // 限流是按 IP 也计的，所以此刻**真账号也应该登不进来** —— 那正是它该有的行为。
  const blocked = await login(USER, PASS);
  log('限流生效后用正确凭据登录', `${blocked.status} ${blocked.code} ${blocked.message}`);
  must(blocked.status === 429, '同一 IP 的正确凭据此刻也应被限流（IP 维度在起作用）');

  console.log('\n全部走查步骤通过（含限流探测）。');
  console.log(`注意：${USER} 的 IP 配额已烧满，一小时内本走查会在第一步就 429。`);
}

main().catch((err) => {
  console.error(`\n走查中断：${err.message}`);
  process.exit(1);
});
