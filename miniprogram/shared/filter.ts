import { CAT_BREEDS, DOG_BREEDS, type PetSpecies } from './types/index';

/**
 * 二级品种选项。'all' 与 'other' 没有可枚举的品种，返回空数组，
 * 页面据此隐藏第二层筛选。
 */
export function breedsForSpecies(species: 'all' | PetSpecies): string[] {
  if (species === 'dog') return DOG_BREEDS;
  if (species === 'cat') return CAT_BREEDS;
  return [];
}
