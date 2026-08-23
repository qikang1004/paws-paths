// 由 packages/types 同步而来，禁止手改。
// 改动请改 packages/types，然后跑 npm run sync:types。
export type PetSpecies = 'dog' | 'cat' | 'other';
export type PetGender = 'male' | 'female' | 'unknown';
export interface PetSummary {
    id: string;
    name: string;
    species: PetSpecies;
    breed: string;
    gender: PetGender;
    birthDate: string;
    coverUrl: string;
    coverWidth: number;
    coverHeight: number;
    personalityTags: string[];
    distanceMeters: number | null;
    ownerNickname: string;
    ownerAvatarUrl: string | null;
    ownerVerified: boolean;
}
export interface PetPhoto {
    id: string;
    url: string;
    width: number;
    height: number;
}
export interface PetDetail {
    id: string;
    name: string;
    species: PetSpecies;
    breed: string;
    gender: PetGender;
    birthDate: string;
    bio: string;
    personalityTags: string[];
    distanceMeters: number | null;
    owner: {
        nickname: string;
        avatarUrl: string | null;
        ownerVerified: boolean;
    };
    photos: PetPhoto[];
}
export interface PetListResponse {
    items: PetSummary[];
    hasMore: boolean;
    page: number;
}
