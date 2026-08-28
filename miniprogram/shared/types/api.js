// 由 packages/types 同步而来，禁止手改。
// 改动请改 packages/types，然后跑 npm run sync:types。
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.messageForCode = exports.ERROR_MESSAGES = exports.ERROR_CODES = void 0;
exports.ERROR_CODES = {
    OK: 0,
    UNAUTHORIZED: 40100,
    FORBIDDEN: 40300,
    NOT_FOUND: 40400,
    VALIDATION_FAILED: 42200,
    AUDIT_REJECTED: 42201,
    LOCATION_REQUIRED: 42202,
    FOLLOW_SELF: 42203,
    /**
     * 举报的 `target_type` 不在白名单里（本阶段只有 `post` / `post_image`）。
     * 与 `VALIDATION_FAILED` 分开是为了让客户端能认出「这个类型服务端压根不支持」，
     * 而不是「这次的参数填错了」——前者重试也没用。
     */
    MODERATION_TARGET_INVALID: 42204,
    /**
     * 工单已被别人处理。并发复核的败者拿这个（拿票的 UPDATE 影响行数为 0）。
     *
     * 刻意**没有** `ALREADY_REPORTED`：重复举报是幂等成功，不是错误 ——
     * 内容已经撤下、工单已在队列里，这就是期望状态。
     */
    MODERATION_TASK_HANDLED: 42205,
    RATE_LIMITED: 42900,
    INTERNAL: 50000,
    UPSTREAM_WECHAT: 50201,
    UPSTREAM_MAP: 50202,
    /**
     * 内容安全接口不可用。与 `UPSTREAM_WECHAT` 分开是因为处置不同：
     * 内容安全是 fail-closed（宁可拒发也不能放过未审内容），前端要提示「稍后重试」
     * 而不是当成一般的微信故障静默降级。
     */
    UPSTREAM_WECHAT_SECURITY: 50203,
};
const FALLBACK_MESSAGE = '服务异常，请稍后再试';
exports.ERROR_MESSAGES = {
    [exports.ERROR_CODES.UNAUTHORIZED]: '登录已过期，请重试',
    [exports.ERROR_CODES.FORBIDDEN]: '没有操作权限',
    [exports.ERROR_CODES.NOT_FOUND]: '内容不存在或已删除',
    [exports.ERROR_CODES.VALIDATION_FAILED]: '提交的信息有误，请检查后重试',
    [exports.ERROR_CODES.AUDIT_REJECTED]: '内容未通过审核',
    [exports.ERROR_CODES.LOCATION_REQUIRED]: '该功能需要位置信息',
    [exports.ERROR_CODES.FOLLOW_SELF]: '不能关注自己的宠物',
    [exports.ERROR_CODES.MODERATION_TARGET_INVALID]: '这类内容暂不支持举报',
    [exports.ERROR_CODES.MODERATION_TASK_HANDLED]: '这条工单已被处理',
    [exports.ERROR_CODES.RATE_LIMITED]: '操作太频繁，请稍后再试',
    [exports.ERROR_CODES.INTERNAL]: FALLBACK_MESSAGE,
    [exports.ERROR_CODES.UPSTREAM_WECHAT]: '微信服务暂时不可用',
    [exports.ERROR_CODES.UPSTREAM_MAP]: '地图服务暂时不可用',
    [exports.ERROR_CODES.UPSTREAM_WECHAT_SECURITY]: '内容审核服务暂时不可用，请稍后重试',
};
function messageForCode(code, fallbackFromServer) {
    return fallbackFromServer || exports.ERROR_MESSAGES[code] || FALLBACK_MESSAGE;
}
exports.messageForCode = messageForCode;
