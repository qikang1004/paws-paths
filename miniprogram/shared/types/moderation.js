// 由 packages/types 同步而来，禁止手改。
// 改动请改 packages/types，然后跑 npm run sync:types。
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AUDIT_ACTION_LABELS = exports.MODERATION_SOURCES = exports.AUDIT_ACTIONS = exports.REPORT_REASON_LABELS = exports.REPORT_REASONS = exports.MODERATION_TARGET_TYPES = exports.USER_ROLES = void 0;
/**
 * 举报与人工复核（spec §4.4）。
 *
 * 审核**状态机**不在这里 —— 它在 `audit.ts`，是唯一实现点（Global Constraint 15）。
 * 本阶段用到的三条边（`approved → pending_review`、`pending_review → approved`、
 * `pending_review → rejected`）阶段 0 就已定义并有单测，这里只加类型，不碰迁移表。
 */
/**
 * 运营角色。RBAC 的最小落法（spec §3.1：运营后台复用同一 API + RBAC 隔离）。
 *
 * 角色**不进 JWT**：令牌是阶段 0 签的，里面没有角色字段；而把角色塞进令牌会让
 * 「撤销运营权限」要等到令牌过期才生效。每次复核多一次 O(1) 查询，换即时可撤销。
 */
exports.USER_ROLES = ['user', 'moderator', 'admin'];
/**
 * 举报能指向的目标。**只有这两个**：它们是唯一带 `audit_status` 列的表。
 *
 * `pet_photos` 不在内 —— 它没有那一列（spec §4.1/§4.5 声称有，实际没有，是既往
 * 未记的偏差），且宠物照片上传路径压根不过机审，没有机审结论可撤。宠物相册的
 * 安全边界目前由取图路由兜着（私有档对他人 404）。
 *
 * 白名单在服务端校验，客户端传未知类型是 422（`MODERATION_TARGET_INVALID`）。
 */
exports.MODERATION_TARGET_TYPES = ['post', 'post_image'];
/**
 * 举报原因的固定白名单。
 *
 * 刻意**不做自由文本**：那本身是一条新的 UGC 入口，又要过一遍内容安全，
 * 本阶段不引入。运营在工单里看到的是这个枚举值加被举报内容的原文。
 */
exports.REPORT_REASONS = [
    'spam',
    'abuse',
    'porn',
    'fraud',
    'animal_abuse',
    'other',
];
/** 举报原因的展示文案。客户端的单选列表直接吃这个，不各自硬编码一份。 */
exports.REPORT_REASON_LABELS = {
    spam: '垃圾广告',
    abuse: '辱骂或人身攻击',
    porn: '色情低俗',
    fraud: '诈骗或虚假信息',
    animal_abuse: '虐待动物',
    other: '其他',
};
/**
 * 写进 `audit_log` 的动作。
 *
 * `auto_*` 两个是机审的动作，它们**没有操作人**（`actor_id` 为 NULL）——
 * 那不是人做的事。人工的三个动作一律带 `actor_id`。
 *
 * 没有 `delete`：审核不删内容，只改状态。撤下就是 `rejected`。
 */
exports.AUDIT_ACTIONS = [
    'report',
    'review_approve',
    'review_reject',
    'auto_approve',
    'auto_reject',
];
/** 工单来源。三个值与建表时的 CHECK 一致；本阶段机审不入队，`wx_auto` 是预留。 */
exports.MODERATION_SOURCES = ['wx_auto', 'user_report', 'manual'];
/** 审核动作的展示文案。客户端直接吃这个，不各自硬编码一份。 */
exports.AUDIT_ACTION_LABELS = {
    report: '用户举报',
    review_approve: '复核放行',
    review_reject: '复核撤下',
    auto_approve: '机审通过',
    auto_reject: '机审拒绝',
};
