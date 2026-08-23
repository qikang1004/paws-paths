// 由 packages/types 同步而来，禁止手改。
// 改动请改 packages/types，然后跑 npm run sync:types。
import type { PetSpecies } from './pet';
export interface FilterOption {
    value: string;
    label: string;
}
export declare const DOG_BREEDS: string[];
export declare const CAT_BREEDS: string[];
export interface PetFilter {
    species: 'all' | PetSpecies;
    breed: string;
}
