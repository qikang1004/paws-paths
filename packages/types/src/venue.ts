export type VenueCategory = 'hospital' | 'shop' | 'grooming' | 'park' | 'cafe' | 'other';

export interface Venue {
  poiId: string;
  name: string;
  address: string;
  category: VenueCategory;
  categoryLabel: string;
  distanceMeters: number | null;
  rating: number | null;
  avgPrice: number | null;
  tags: string[];
  coverUrl: string | null;
  isFavorite: boolean;
  lat: number | null;
  lng: number | null;
}
