// Weight classes (IBJJF-style, in pounds) for profiles and the leaderboard
// filters. 'absolute' is open weight — everyone, including members who haven't
// set a weight.

export type WeightClassKey =
  | 'absolute'
  | 'rooster'
  | 'lightFeather'
  | 'feather'
  | 'light'
  | 'middle'
  | 'mediumHeavy'
  | 'heavy'
  | 'superHeavy'
  | 'ultraHeavy';

export interface WeightClass {
  key: WeightClassKey;
  /** Upper bound in lbs (inclusive); null = no limit. */
  maxLbs: number | null;
}

/** In ascending order; a member belongs to the first class whose max they fit. */
export const WEIGHT_CLASSES: WeightClass[] = [
  { key: 'rooster', maxLbs: 127 },
  { key: 'lightFeather', maxLbs: 141 },
  { key: 'feather', maxLbs: 154 },
  { key: 'light', maxLbs: 168 },
  { key: 'middle', maxLbs: 182 },
  { key: 'mediumHeavy', maxLbs: 195 },
  { key: 'heavy', maxLbs: 208 },
  { key: 'superHeavy', maxLbs: 222 },
  { key: 'ultraHeavy', maxLbs: null },
];

/** Filter chips for the leaderboard: Absolute first, then the classes. */
export const WEIGHT_FILTERS: WeightClassKey[] = [
  'absolute',
  ...WEIGHT_CLASSES.map((c) => c.key),
];

/** The class a given weight falls in, or null when no weight is set. */
export function weightClassFor(weightLbs: number | null | undefined): WeightClassKey | null {
  if (weightLbs == null || !(weightLbs > 0)) return null;
  for (const c of WEIGHT_CLASSES) {
    if (c.maxLbs === null || weightLbs <= c.maxLbs) return c.key;
  }
  return 'ultraHeavy';
}

/** Whether a weight belongs on the given leaderboard filter. */
export function inWeightClass(weightLbs: number | null | undefined, filter: WeightClassKey): boolean {
  if (filter === 'absolute') return true;
  return weightClassFor(weightLbs) === filter;
}

/** Current age from an ISO birthdate, or null when unknown. */
export function ageFrom(birthdate: string | null | undefined): number | null {
  if (!birthdate) return null;
  const [y, m, d] = birthdate.split('-').map(Number);
  if (!y || !m || !d) return null;
  const now = new Date();
  let age = now.getFullYear() - y;
  if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

/** Full years old at now() from an ISO birthdate (0 when unknown/invalid). */
export function ageFromBirthdate(birthdate: string | null | undefined): number {
  return ageFrom(birthdate) ?? 0;
}

// Canonical pounds<->kilograms conversion (matches the DB's division bounds).
const LBS_PER_KG = 0.45359237;

/** Pounds to kilograms. */
export function lbsToKg(lbs: number): number {
  return lbs * LBS_PER_KG;
}

/** Kilograms to pounds. */
export function kgToLbs(kg: number): number {
  return kg / LBS_PER_KG;
}
