import { CAT_BREEDS, DOG_BREEDS } from '../shared/types/index';
import { breedsForSpecies } from '../shared/filter';

describe('breedsForSpecies', () => {
  it('狗与猫各回自己的品种表', () => {
    expect(breedsForSpecies('dog')).toEqual(DOG_BREEDS);
    expect(breedsForSpecies('cat')).toEqual(CAT_BREEDS);
  });

  it('其他与不限物种没有二级品种可选', () => {
    expect(breedsForSpecies('other')).toEqual([]);
    expect(breedsForSpecies('all')).toEqual([]);
  });
});
