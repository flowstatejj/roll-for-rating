// Named rating tiers (goal-gradient progression on top of the raw rating).
export interface Tier {
  /** stable key for i18n: t(`tier.${key}`). `name` is the English fallback. */
  key: string;
  name: string;
  min: number;
  color: string;
}

export const TIERS: Tier[] = [
  { key: 'novice', name: 'Novice', min: 0, color: '#9aa2ad' },
  { key: 'contender', name: 'Contender', min: 1100, color: '#4a90d9' },
  { key: 'challenger', name: 'Challenger', min: 1300, color: '#8b5cf6' },
  { key: 'elite', name: 'Elite', min: 1500, color: '#e0a32e' },
  { key: 'apex', name: 'Apex', min: 1700, color: '#e0564b' },
];

export function tierFor(rating: number): {
  tier: Tier;
  next: Tier | null;
  toNext: number;
  progress: number; // 0..1 within the current tier
} {
  let idx = 0;
  for (let i = 0; i < TIERS.length; i++) if (rating >= TIERS[i].min) idx = i;
  const tier = TIERS[idx];
  const next = TIERS[idx + 1] ?? null;
  const toNext = next ? Math.max(0, next.min - rating) : 0;
  const progress = next ? (rating - tier.min) / (next.min - tier.min) : 1;
  return { tier, next, toNext, progress: Math.max(0, Math.min(1, progress)) };
}
