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
export function formatPetAge(birthDate: string, now: Date = new Date()): PetAge {
  const birth = new Date(`${birthDate}T00:00:00Z`);
  let months =
    (now.getUTCFullYear() - birth.getUTCFullYear()) * 12 +
    (now.getUTCMonth() - birth.getUTCMonth());
  if (now.getUTCDate() < birth.getUTCDate()) {
    months -= 1;
  }
  if (months < 0) {
    months = 0;
  }
  if (months < 12) {
    return { value: months, unit: 'month', text: `${months}个月` };
  }
  const years = Math.floor(months / 12);
  return { value: years, unit: 'year', text: `${years}岁` };
}
