// Geography helpers for leaderboard levels. Location comes from a member's
// profile (city / state / country) with gym fallback; continent is taken from
// the stored value (country picker) or derived from the country.
import { continentForCountryName } from './countries';

export type GeoLevel = 'city' | 'state' | 'country' | 'continent' | 'world';

export const GEO_LEVELS: { key: GeoLevel; label: string }[] = [
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State' },
  { key: 'country', label: 'Country' },
  { key: 'continent', label: 'Continent' },
  { key: 'world', label: 'World' },
];

export interface Geo {
  city: string | null;
  state: string | null;
  country: string | null;
  continent: string | null;
}

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

/** Best-effort continent for a country name (canonical or common alias); null if unknown. */
export function continentForCountry(country: string | null | undefined): string | null {
  return continentForCountryName(country);
}

/**
 * Build a member's geography, preferring their own profile fields and falling
 * back to their gym's. Continent prefers the value stored on the profile (set
 * by the country picker), then derives from the resolved country, then the gym.
 */
export function resolveGeo(
  profile: { city: string | null; state: string | null; country: string | null; continent?: string | null } | null | undefined,
  gym: Geo | null | undefined,
): Geo {
  const city = profile?.city || gym?.city || null;
  const state = profile?.state || gym?.state || null;
  const country = profile?.country || gym?.country || null;
  const continent = profile?.continent || continentForCountry(country) || gym?.continent || null;
  return { city, state, country, continent };
}

/** Does `target` share `viewer`'s location at the given level? World = always. */
export function geoMatches(viewer: Geo | null, target: Geo | null, level: GeoLevel): boolean {
  if (level === 'world') return true;
  if (!viewer || !target) return false;
  const v = viewer[level];
  const t = target[level];
  if (!v || !t) return false;
  return norm(v) === norm(t);
}
