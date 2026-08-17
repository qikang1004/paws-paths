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
    RATE_LIMITED: 42900,
    INTERNAL: 50000,
    UPSTREAM_WECHAT: 50201,
    UPSTREAM_MAP: 50202,
};
const FALLBACK_MESSAGE = '服务异常，请稍后再试';
exports.ERROR_MESSAGES = {
    [exports.ERROR_CODES.UNAUTHORIZED]: '登录已过期，请重试',
    [exports.ERROR_CODES.FORBIDDEN]: '没有操作权限',
    [exports.ERROR_CODES.NOT_FOUND]: '内容不存在或已删除',
    [exports.ERROR_CODES.VALIDATION_FAILED]: '提交的信息有误，请检查后重试',
    [exports.ERROR_CODES.AUDIT_REJECTED]: '内容未通过审核',
    [exports.ERROR_CODES.LOCATION_REQUIRED]: '该功能需要位置信息',
    [exports.ERROR_CODES.RATE_LIMITED]: '操作太频繁，请稍后再试',
    [exports.ERROR_CODES.INTERNAL]: FALLBACK_MESSAGE,
    [exports.ERROR_CODES.UPSTREAM_WECHAT]: '微信服务暂时不可用',
    [exports.ERROR_CODES.UPSTREAM_MAP]: '地图服务暂时不可用',
};
function messageForCode(code, fallbackFromServer) {
    return fallbackFromServer || exports.ERROR_MESSAGES[code] || FALLBACK_MESSAGE;
}
exports.messageForCode = messageForCode;
