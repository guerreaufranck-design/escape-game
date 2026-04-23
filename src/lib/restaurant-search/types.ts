/**
 * Shared types for restaurant search providers.
 * Provider-agnostic — Google Places, The Fork, TripAdvisor all map to this.
 */

export type RestaurantProvider = "google_places" | "thefork" | "tripadvisor";

export interface Restaurant {
  id: string;
  name: string;
  cuisine?: string | null;
  rating: number; // 0-5
  reviewCount?: number;
  priceLevel?: number | null; // 1-4
  distanceMeters: number;
  bookingUrl: string;
  /** Partner discount % (0 if none / unknown) */
  discountPercent: number;
  latitude?: number;
  longitude?: number;
  address?: string | null;
  provider: RestaurantProvider;
}

export interface SearchParams {
  lat: number;
  lon: number;
  radiusMeters: number;
  minRating?: number;
  maxResults?: number;
  openNow?: boolean;
}
