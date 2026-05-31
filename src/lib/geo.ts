// Geography helpers for leaderboard levels. A member's location comes from
// their gym (city / state / country); continent is derived from country here so
// the app can store it and the DB can filter on it cheaply.

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

// Common country names + aliases → continent. Unknown countries map to null
// (they'll only show at the World level). Case-insensitive lookup.
const COUNTRY_CONTINENT: Record<string, string> = {
  // North America
  'united states': 'North America', 'usa': 'North America', 'us': 'North America',
  'united states of america': 'North America', 'canada': 'North America', 'mexico': 'North America',
  'guatemala': 'North America', 'costa rica': 'North America', 'panama': 'North America',
  'cuba': 'North America', 'dominican republic': 'North America', 'jamaica': 'North America',
  // South America
  'brazil': 'South America', 'brasil': 'South America', 'argentina': 'South America',
  'chile': 'South America', 'colombia': 'South America', 'peru': 'South America',
  'uruguay': 'South America', 'paraguay': 'South America', 'venezuela': 'South America',
  'ecuador': 'South America', 'bolivia': 'South America',
  // Europe
  'united kingdom': 'Europe', 'uk': 'Europe', 'england': 'Europe', 'scotland': 'Europe',
  'wales': 'Europe', 'ireland': 'Europe', 'france': 'Europe', 'germany': 'Europe',
  'spain': 'Europe', 'portugal': 'Europe', 'italy': 'Europe', 'netherlands': 'Europe',
  'belgium': 'Europe', 'switzerland': 'Europe', 'austria': 'Europe', 'sweden': 'Europe',
  'norway': 'Europe', 'denmark': 'Europe', 'finland': 'Europe', 'poland': 'Europe',
  'czech republic': 'Europe', 'czechia': 'Europe', 'greece': 'Europe', 'russia': 'Europe',
  'ukraine': 'Europe', 'romania': 'Europe', 'hungary': 'Europe', 'iceland': 'Europe',
  'croatia': 'Europe', 'serbia': 'Europe', 'bulgaria': 'Europe',
  // Asia
  'japan': 'Asia', 'china': 'Asia', 'south korea': 'Asia', 'korea': 'Asia',
  'india': 'Asia', 'thailand': 'Asia', 'vietnam': 'Asia', 'philippines': 'Asia',
  'indonesia': 'Asia', 'malaysia': 'Asia', 'singapore': 'Asia', 'taiwan': 'Asia',
  'hong kong': 'Asia', 'kazakhstan': 'Asia', 'pakistan': 'Asia', 'israel': 'Asia',
  'turkey': 'Asia', 'saudi arabia': 'Asia', 'united arab emirates': 'Asia', 'uae': 'Asia',
  'qatar': 'Asia', 'jordan': 'Asia', 'lebanon': 'Asia',
  // Oceania
  'australia': 'Oceania', 'new zealand': 'Oceania', 'fiji': 'Oceania',
  // Africa
  'south africa': 'Africa', 'egypt': 'Africa', 'morocco': 'Africa', 'nigeria': 'Africa',
  'kenya': 'Africa', 'ghana': 'Africa', 'tunisia': 'Africa', 'algeria': 'Africa',
  'angola': 'Africa',
};

/** Best-effort continent for a free-typed country name; null if unknown. */
export function continentForCountry(country: string | null | undefined): string | null {
  const key = norm(country);
  if (!key) return null;
  return COUNTRY_CONTINENT[key] ?? null;
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
