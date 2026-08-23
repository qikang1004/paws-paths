import type { PetSpecies } from './pet';

export interface FilterOption {
  value: string;
  label: string;
}

export const DOG_BREEDS: string[] = [
  '金毛',
  '柯基',
  '柴犬',
  '边牧',
  '拉布拉多',
  '泰迪',
  '萨摩耶',
  '哈士奇',
  '博美',
  '法斗',
];

export const CAT_BREEDS: string[] = [
  '布偶',
  '英国短毛猫',
  '美国短毛猫',
  '中华田园猫',
  '暹罗',
  '缅因',
  '加菲',
  '橘猫',
];

export interface PetFilter {
  species: 'all' | PetSpecies;
  breed: string;
}
