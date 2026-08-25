// 由 packages/types 同步而来，禁止手改。
// 改动请改 packages/types，然后跑 npm run sync:types。
export interface ApiResponse<T> {
    code: number;
    message: string;
    data: T | null;
}
export declare const ERROR_CODES: {
    readonly OK: 0;
    readonly UNAUTHORIZED: 40100;
    readonly FORBIDDEN: 40300;
    readonly NOT_FOUND: 40400;
    readonly VALIDATION_FAILED: 42200;
    readonly AUDIT_REJECTED: 42201;
    readonly LOCATION_REQUIRED: 42202;
    readonly FOLLOW_SELF: 42203;
    readonly RATE_LIMITED: 42900;
    readonly INTERNAL: 50000;
    readonly UPSTREAM_WECHAT: 50201;
    readonly UPSTREAM_MAP: 50202;
    /**
     * 内容安全接口不可用。与 `UPSTREAM_WECHAT` 分开是因为处置不同：
     * 内容安全是 fail-closed（宁可拒发也不能放过未审内容），前端要提示「稍后重试」
     * 而不是当成一般的微信故障静默降级。
     */
    readonly UPSTREAM_WECHAT_SECURITY: 50203;
};
export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
export declare const ERROR_MESSAGES: Record<number, string>;
export declare function messageForCode(code: number, fallbackFromServer?: string): string;
