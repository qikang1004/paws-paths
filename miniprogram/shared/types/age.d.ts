// 由 packages/types 同步而来，禁止手改。
// 改动请改 packages/types，然后跑 npm run sync:types。
export type AgeUnit = 'year' | 'month';
export interface PetAge {
    value: number;
    unit: AgeUnit;
    text: string;
}
/**
 * 宠物年龄按月计算：不足 12 个月显示月龄，满 12 个月显示岁数（向下取整）。
 * 原型上「8个月」「2岁」是同一规则的两种渲染，不可落库为文本。
 */
export declare function formatPetAge(birthDate: string, now?: Date): PetAge;
