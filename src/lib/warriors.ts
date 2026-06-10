export type WarriorKey =
  | 'samurai' | 'ninja' | 'viking' | 'roman' | 'spartan' | 'knight'
  | 'gladiator' | 'mongol' | 'cossack' | 'gunslinger' | 'pirate' | 'musketeer';

export const WARRIORS: { key: WarriorKey; name: string }[] = [
  { key: 'samurai', name: 'Samurai' },
  { key: 'ninja', name: 'Ninja' },
  { key: 'viking', name: 'Viking' },
  { key: 'roman', name: 'Roman' },
  { key: 'spartan', name: 'Spartan' },
  { key: 'knight', name: 'Knight' },
  { key: 'gladiator', name: 'Gladiator' },
  { key: 'mongol', name: 'Mongol' },
  { key: 'cossack', name: 'Cossack' },
  { key: 'gunslinger', name: 'Gunslinger' },
  { key: 'pirate', name: 'Pirate' },
  { key: 'musketeer', name: 'Musketeer' },
];

export const AVATAR_COLORS = [
  '#2f6fed', '#d4452f', '#2e9e5b', '#7d3cc6', '#e0a020',
  '#178f87', '#e07b39', '#4b5563', '#c2406e', '#0f172a',
];

export const DEFAULT_WARRIOR: WarriorKey = 'samurai';
export const DEFAULT_AVATAR_COLOR = AVATAR_COLORS[0];

export function isWarrior(x: string | null | undefined): x is WarriorKey {
  return !!x && WARRIORS.some((w) => w.key === x);
}
