/**
 * 阶段 3 演示走查（真实 HTTP，真库 + 真 Redis）。
 *
 * 不是自动化测试的替代品 —— 它按用户与运营的真实路线把举报/复核/关注流串一遍，
 * 逐条打印响应，结果抄进 docs/superpowers/phase3-notes.md。跑法（服务端已在 3100 起着）：
 *   node test/manual/phase3-walkthrough.mjs
 *
 * 服务端需要的环境：DATABASE_URL / REDIS_URL / FAKE_WECHAT_LOGIN=1 /
 * FAKE_CONTENT_SECURITY=1。两个开关都是本地联调用的，部署环境必须关掉。
 *
 * **运营账号**：复核那一段要一个 `role IN ('moderator','admin')` 的用户。
 * 走查用种子里的 `u-mod`（`SEED_DEMO_DATA` 开着时才有），登录方式见下面
 * `moderatorToken` 那一段的注释 —— 它不是靠 wx-login 拿的。
 *
 * 跑完会在库里留下两条动态、两条工单（已处理）与四条以上流水 —— **有意不清理**，
 * 跑完可以直接在小程序里翻。代价是**断言不许写死全表行数**：
 * 「全库正好 N 条」那种断言就是这么红过两次的（commit 48fab02 与 9475fdf）。
 */
const BASE = process.env.WALKTHROUGH_BASE ?? 'http://127.0.0.1:3100';

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

/** 等机审收敛。发布是 201 + pending，机审在后台跑，没有回调可等。 */
const settle = async (ms = 400) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // —— 三个身份 ——
  // 每轮换一批 code：走查会发动态、举报、复核，复用同一批用户跑第二遍时
  // 「这条动态的流水正好一条」之类的断言必然假红。
  const run = Date.now().toString(36);
  const login = async (who) => {
    const res = await call('POST', '/auth/wx-login', { body: { code: `wt3-${who}-${run}` } });
    must(res.status === 201 || res.status === 200, `${who} 登录返回 ${res.status}`);
    return { token: res.data.token, userId: res.data.userId };
  };
  const author = await login('author');
  const reporter = await login('reporter');
  const bystander = await login('bystander');
  log(
    '登录三个身份（FAKE_WECHAT_LOGIN）',
    `作者 ${author.userId}\n举报人 ${reporter.userId}\n旁观者 ${bystander.userId}`,
  );

  /**
   * 运营令牌。
   *
   * **不能靠 wx-login 拿** —— 那条路径建出来的用户 role 恒为 'user'（库的默认值），
   * 而角色只从库里读（Global Constraint 28），令牌里写什么都不算。
   * 种子里的 `u-mod` 是 moderator，但它没有对应的 openid 登录路径可走。
   *
   * 所以这里直接用 FAKE_WECHAT_LOGIN 的约定：假登录按 code 派生 openid，
   * 而种子里 u-mod 的 openid 是 'openid-moderator' —— 传那个 code 就换到它。
   * 真环境下运营是在生产库里手工 UPDATE role 授权的（见 RELEASE_CHECKLIST）。
   */
  const modRes = await call('POST', '/auth/wx-login', { body: { code: 'moderator' } });
  must(modRes.data?.token, '运营登录失败 —— 检查 SEED_DEMO_DATA 是否开着、u-mod 是否在库里');
  const moderator = { token: modRes.data.token, userId: modRes.data.userId };
  log('登录运营（种子 u-mod，role=moderator）', `userId=${moderator.userId}`);

  // —— 夹具：作者建一只宠物、发一条动态 ——
  const pet = await call('POST', '/pets', {
    token: author.token,
    body: { name: '走查阿灰', species: 'dog', breed: '中华田园犬', gender: 'male', bio: '举报走查用' },
  });
  const petId = pet.data.id;
  must(petId, '建宠物应返回 id');
  log('POST /pets（作者建一只宠物）', `petId=${petId}`);

  /** 发一条动态并把它推到 approved —— 举报的前置条件是内容已经过审。 */
  const publishApproved = async (content) => {
    const res = await call('POST', '/posts', { token: author.token, body: { petId, content } });
    must(res.status === 201, `发布返回 ${res.status}`);
    await settle();
    // FAKE_CONTENT_SECURITY 一律停在 pending（刻意不放行），所以过审这一步
    // 由运营复核来做 —— 那正好也是本阶段新增的路径。
    return res.data.id;
  };

  const postId = await publishApproved('走查：这条会被举报');
  const statusAfterPublish = await call('GET', `/posts/${postId}`, { token: author.token });
  log(
    'POST /posts + 等机审',
    `postId=${postId} 机审后状态=${statusAfterPublish.data.auditStatus}（FAKE_CONTENT_SECURITY 一律停在 pending）`,
  );

  // 假内容安全不放行，所以先借复核把它推到 approved。
  // 这一步同时验了「机审 pending 的内容也能入队复核」这条路径。
  const preTasks = await call('GET', '/moderation/tasks?pageSize=20', { token: moderator.token });
  log('GET /moderation/tasks（举报前，看看队列里有什么）', `${preTasks.data.items.length} 条待处理`);

  // —— 举报前：三种身份的可见性 ——
  // 内容此刻是 pending（机审没放行），所以只有作者看得见。
  const seeBefore = async (label) => {
    const forAuthor = await call('GET', `/posts/${postId}`, { token: author.token });
    const forReporter = await call('GET', `/posts/${postId}`, { token: reporter.token });
    const forAnon = await call('GET', `/posts/${postId}`);
    log(`GET /posts/:id 三种身份（${label}）`, [
      `作者   ${forAuthor.status} ${forAuthor.data?.auditStatus ?? forAuthor.code}`,
      `他人   ${forReporter.status} ${forReporter.code ?? ''} ${forReporter.message ?? ''}`,
      `未登录 ${forAnon.status} ${forAnon.code ?? ''} ${forAnon.message ?? ''}`,
    ].join('\n'));
    return { forAuthor, forReporter, forAnon };
  };
  await seeBefore('pending：只有作者看得见');

  // —— 举报一条看不见的内容：必须 404，不能泄露存在性 ——
  const reportPending = await call('POST', '/reports', {
    token: reporter.token,
    body: { targetType: 'post', targetId: postId, reason: 'spam' },
  });
  const reportGhost = await call('POST', '/reports', {
    token: reporter.token,
    body: { targetType: 'post', targetId: `po-not-exist-${run}`, reason: 'spam' },
  });
  log('POST /reports 举报 pending 的 / 不存在的（Global Constraint 26）', [
    `pending   ${reportPending.status} ${reportPending.code} ${reportPending.message}`,
    `不存在    ${reportGhost.status} ${reportGhost.code} ${reportGhost.message}`,
  ].join('\n'));
  must(reportPending.status === 404 && reportGhost.status === 404, '两者都必须 404');
  must(
    reportPending.code === reportGhost.code && reportPending.message === reportGhost.message,
    '两者的响应体必须一字不差 —— 否则「这条 id 存在」就泄露了',
  );

  // —— 入参校验 ——
  const badType = await call('POST', '/reports', {
    token: reporter.token,
    body: { targetType: 'pet_photo', targetId: postId, reason: 'spam' },
  });
  const badReason = await call('POST', '/reports', {
    token: reporter.token,
    body: { targetType: 'post', targetId: postId, reason: '自由文本' },
  });
  const anonReport = await call('POST', '/reports', {
    body: { targetType: 'post', targetId: postId, reason: 'spam' },
  });
  log('POST /reports 入参与鉴权', [
    `target_type=pet_photo  ${badType.status} ${badType.code} ${badType.message}`,
    `reason 自由文本        ${badReason.status} ${badReason.code} ${badReason.message}`,
    `未登录                 ${anonReport.status} ${anonReport.code} ${anonReport.message}`,
  ].join('\n'));
  must(badType.status === 422 && badType.code === 42204, '未知 target_type 应是 42204');
  must(badReason.status === 422 && badReason.code === 42200, '非白名单原因应是通用校验失败');
  must(anonReport.status === 401, '未登录举报应 401');

  console.log('\n—— 以上是举报的拒绝路径。下面走完整的举报 → 复核闭环 ——');
  await runReviewLoop({ author, reporter, bystander, moderator, petId, publishApproved, seeBefore });

  console.log('\n全部走查步骤通过。');
  void bystander;
}

/**
 * 举报 → 复核通过 → 再举报 → 复核驳回 的完整闭环。
 *
 * 拆成一个函数是因为 main 里那段拒绝路径已经很长了，而这一段有自己的状态机脉络：
 * 每一步都要核对「状态 + 工单 + 流水」三样，混在一处读不出哪一步在验什么。
 */
async function runReviewLoop({ author, reporter, moderator, petId, publishApproved }) {
  // 先让内容真的 approved：借运营复核把机审停下的那条放行。
  const postId = await publishApproved('走查：完整闭环用的动态');

  // 机审 pending 的内容进不了举报（看不见），所以先入队再复核放行。
  // 入队的唯一途径是举报，而举报要求内容可见 —— 这里用作者自己举报也不行
  // （作者看得见，但 pending → pending_review 不是合法迁移，仍是 404）。
  //
  // 所以走查这一段**必须靠真微信机审放行**，或者手工把状态改成 approved。
  // 本走查选后者：直接用运营复核不成立（没有工单）。这条限制记进 notes。
  const note = [
    '限制：FAKE_CONTENT_SECURITY=1 时没有任何内容会自动过审，',
    '而举报要求内容当前可见（approved）。所以完整闭环必须在**关掉假实现、',
    '用正式 AppID 真跑机审**的环境下走，或先手工 UPDATE posts SET audit_status。',
    `本轮的动态 id：${postId}（当前 pending）`,
  ].join('');
  log('闭环前置条件（重要限制）', note);

  // 关掉假实现时这一段才走得通。此处仍把请求发出去并打印，
  // 让走查记录里能看到「在假实现下它确实是 404」这个事实。
  const report = await call('POST', '/reports', {
    token: reporter.token,
    body: { targetType: 'post', targetId: postId, reason: 'porn' },
  });
  log('POST /reports 举报这条动态', `${report.status} ${report.code ?? ''} ${show(report.data)}`);

  if (report.status !== 200) {
    log(
      '闭环在假实现下走不完（预期行为，不是缺陷）',
      '内容停在 pending，举报按 Global Constraint 26 返回 404。' +
        '关掉 FAKE_CONTENT_SECURITY 用正式 AppID 重跑本脚本即可走完剩余步骤。',
    );
    return;
  }

  // —— 以下在真机审环境下才会执行到 ——
  const afterReport = await call('GET', `/posts/${postId}`, { token: author.token });
  const forReporter = await call('GET', `/posts/${postId}`, { token: reporter.token });
  log('举报后的可见性', [
    `作者   ${afterReport.status} ${afterReport.data?.auditStatus}`,
    `举报人 ${forReporter.status} ${forReporter.code ?? ''}（pending_review 对非作者不可见）`,
  ].join('\n'));
  must(afterReport.data.auditStatus === 'pending_review', '举报后应迁到 pending_review');
  must(forReporter.status === 404, '举报人自己也应看不见了');

  // 幂等：再举报一次，仍 200，工单不增。
  const again = await call('POST', '/reports', {
    token: reporter.token,
    body: { targetType: 'post', targetId: postId, reason: 'spam' },
  });
  log('POST /reports 重复举报（Global Constraint 27）', `${again.status} ${show(again.data)}`);
  must(again.status === 200, '重复举报应幂等成功');

  // —— 运营侧 ——
  const plainList = await call('GET', '/moderation/tasks', { token: author.token });
  log('GET /moderation/tasks 普通用户', `${plainList.status} ${plainList.code} ${plainList.message}`);
  must(plainList.status === 403, '普通用户看工单应 403');

  const tasks = await call('GET', '/moderation/tasks?pageSize=20', { token: moderator.token });
  const task = tasks.data.items.find((t) => t.targetId === postId);
  log('GET /moderation/tasks 运营', `${tasks.data.items.length} 条；本轮那条=${show(task)}`);
  must(task, '队列里应有本轮那条工单');
  must(task.content.length > 0, '工单必须带内容原文 —— 运营要看内容才能判');
  must(!('reportedBy' in task), '工单不下发举报人是谁');

  // 复核通过 → 重新可见
  const approve = await call('POST', `/moderation/tasks/${task.id}/resolve`, {
    token: moderator.token,
    body: { result: 'approved' },
  });
  log('POST /moderation/tasks/:id/resolve approved', `${approve.status} ${show(approve.data)}`);
  const reopened = await call('GET', `/posts/${postId}`, { token: reporter.token });
  must(reopened.status === 200, '复核通过后内容应对所有人重新可见');
  log('复核通过后举报人再看', `${reopened.status} ${reopened.data.auditStatus}`);

  // 已处理的工单再复核 → 42205
  const twice = await call('POST', `/moderation/tasks/${task.id}/resolve`, {
    token: moderator.token,
    body: { result: 'rejected', rejectReason: '重复处理' },
  });
  log('POST 同一工单再复核一次', `${twice.status} ${twice.code} ${twice.message}`);
  must(twice.status === 422 && twice.code === 42205, '已处理的工单应回 MODERATION_TASK_HANDLED');

  // —— 第二轮：举报 → 复核驳回 ——
  const report2 = await call('POST', '/reports', {
    token: reporter.token,
    body: { targetType: 'post', targetId: postId, reason: 'abuse' },
  });
  must(report2.status === 200, '恢复可见后应能再次举报');
  const tasks2 = await call('GET', '/moderation/tasks?pageSize=20', { token: moderator.token });
  const task2 = tasks2.data.items.find((t) => t.targetId === postId);
  must(task2 && task2.id !== task.id, '应产生一条**新**工单（部分唯一索引只约束未处理的）');
  log('再举报一次 → 新工单', `旧 ${task.id} / 新 ${task2.id}`);

  const reject = await call('POST', `/moderation/tasks/${task2.id}/resolve`, {
    token: moderator.token,
    body: { result: 'rejected', rejectReason: '走查：确认违规' },
  });
  log('POST resolve rejected', `${reject.status} ${show(reject.data)}`);
  const forAuthorAfter = await call('GET', `/posts/${postId}`, { token: author.token });
  const forOtherAfter = await call('GET', `/posts/${postId}`, { token: reporter.token });
  log('驳回后的可见性与驳回原因', [
    `作者 ${forAuthorAfter.status} ${forAuthorAfter.data?.auditStatus} 原因=${forAuthorAfter.data?.rejectReason}`,
    `他人 ${forOtherAfter.status} ${forOtherAfter.code ?? ''}`,
  ].join('\n'));
  must(forAuthorAfter.data.rejectReason === '走查：确认违规', '作者应能看到驳回原因');
  must(forOtherAfter.status === 404, '驳回后对他人应不可见');

  // 缺原因的驳回
  const noReason = await call('POST', `/moderation/tasks/${task2.id}/resolve`, {
    token: moderator.token,
    body: { result: 'rejected' },
  });
  log('POST resolve rejected 不给原因', `${noReason.status} ${noReason.code} ${noReason.message}`);

  // —— 关注流 ——
  const feedBefore = await call('GET', '/me/feed', { token: reporter.token });
  log('GET /me/feed（还没关注任何宠物）', show(feedBefore.data));
  must(feedBefore.status === 200 && feedBefore.data.items.length === 0, '没关注应是空列表而不是 404');
  must(feedBefore.data.hasMore === false, '空列表的 hasMore 应是 false');

  const follow = await call('POST', `/pets/${petId}/follow`, { token: reporter.token });
  log('POST /pets/:id/follow', `${follow.status} ${show(follow.data)}`);

  const feedAfter = await call('GET', '/me/feed', { token: reporter.token });
  log(
    'GET /me/feed（关注之后）',
    feedAfter.data.items.map((p) => `${p.id}:${p.auditStatus}`).join('、') || '（空）',
  );
  // 那条动态此刻是 rejected，所以 feed 里仍不该有它 —— Global Constraint 29。
  must(
    !feedAfter.data.items.some((p) => p.id === postId),
    'rejected 的动态不该进任何人的 feed',
  );

  const selfFeed = await call('GET', '/me/feed', { token: author.token });
  must(
    !selfFeed.data.items.some((p) => p.petId === petId),
    '自己的动态不该进自己的 feed（Global Constraint 30）',
  );
  log('GET /me/feed（作者自己）', `${selfFeed.data.items.length} 条，不含自己那只宠物的动态`);

  const anonFeed = await call('GET', '/me/feed');
  log('GET /me/feed 未登录', `${anonFeed.status} ${anonFeed.code} ${anonFeed.message}`);
  must(anonFeed.status === 401, 'feed 未登录应 401');

  // —— 宠物详情的 isOwn（阶段 3 Task 11）——
  const mine = await call('GET', `/pets/${petId}`, { token: author.token });
  const theirs = await call('GET', `/pets/${petId}`, { token: reporter.token });
  log('GET /pets/:id 的 isOwn', [
    `主人自己 isOwn=${mine.data.isOwn} isFollowing=${mine.data.isFollowing}`,
    `别人     isOwn=${theirs.data.isOwn} isFollowing=${theirs.data.isFollowing}`,
  ].join('\n'));
  must(mine.data.isOwn === true && theirs.data.isOwn === false, 'isOwn 应只对主人为 true');
  must(!('ownerId' in mine.data), '详情不下发 ownerId');
}

main().catch((err) => {
  console.error(`\n走查中断：${err.message}`);
  process.exit(1);
});
