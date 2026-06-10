import Svg, { Circle, Ellipse, G, Path, Rect } from 'react-native-svg';

import { DEFAULT_AVATAR_COLOR, type WarriorKey } from '@/lib/warriors';

const W = '#ffffff';

/** Each emblem is a stylized white headgear silhouette; `c` (the disc colour)
 * shows through cut-outs (visor slits, mask bands) for a 2-tone look. */
function Emblem({ k, c }: { k: WarriorKey; c: string }) {
  switch (k) {
    case 'samurai':
      return (
        <G>
          <Path d="M28 64 C28 40 72 40 72 64 Z" fill={W} />
          <Path d="M50 40 C46 31 40 25 30 22 C40 27 46 33 50 42 C54 33 60 27 70 22 C60 25 54 31 50 40 Z" fill={W} />
          <Circle cx="50" cy="34" r="4" fill={W} />
        </G>
      );
    case 'ninja':
      return (
        <G>
          <Path d="M26 60 C26 32 74 32 74 60 C74 70 64 76 50 76 C36 76 26 70 26 60 Z" fill={W} />
          <Rect x="26" y="48" width="48" height="10" fill={c} />
          <Ellipse cx="40" cy="53" rx="4" ry="2.4" fill={W} />
          <Ellipse cx="60" cy="53" rx="4" ry="2.4" fill={W} />
        </G>
      );
    case 'viking':
      return (
        <G>
          <Path d="M30 60 C30 38 70 38 70 60 Z" fill={W} />
          <Rect x="47" y="50" width="6" height="18" rx="2" fill={W} />
          <Path d="M32 52 C20 50 14 38 18 32 C20 40 26 48 34 50 Z" fill={W} />
          <Path d="M68 52 C80 50 86 38 82 32 C80 40 74 48 66 50 Z" fill={W} />
        </G>
      );
    case 'roman':
      return (
        <G>
          <Path d="M32 64 C32 42 68 42 68 64 Z" fill={W} />
          <Path d="M34 44 C40 26 60 26 66 44 C58 40 42 40 34 44 Z" fill={W} />
        </G>
      );
    case 'spartan':
      return (
        <G>
          <Path d="M30 32 C30 24 70 24 70 32 L70 62 C70 74 60 80 50 80 C40 80 30 74 30 62 Z" fill={W} />
          <Path d="M34 26 C40 8 60 8 66 26 C58 22 42 22 34 26 Z" fill={W} />
          <Rect x="36" y="40" width="28" height="6" fill={c} />
          <Rect x="47" y="40" width="6" height="30" fill={c} />
        </G>
      );
    case 'knight':
      return (
        <G>
          <Path d="M33 30 C33 26 67 26 67 30 L67 70 C67 75 60 78 50 78 C40 78 33 75 33 70 Z" fill={W} />
          <Rect x="37" y="45" width="26" height="5" rx="2" fill={c} />
          <Circle cx="44" cy="60" r="1.6" fill={c} />
          <Circle cx="50" cy="60" r="1.6" fill={c} />
          <Circle cx="56" cy="60" r="1.6" fill={c} />
        </G>
      );
    case 'gladiator':
      return (
        <G>
          <Path d="M50 38 C56 24 52 13 50 11 C48 13 44 24 50 38 Z" fill={W} />
          <Circle cx="50" cy="56" r="19" fill={W} />
          <Rect x="42" y="56" width="1.8" height="16" fill={c} />
          <Rect x="49" y="56" width="1.8" height="16" fill={c} />
          <Rect x="56" y="56" width="1.8" height="16" fill={c} />
        </G>
      );
    case 'mongol':
      return (
        <G>
          <Path d="M47 24 L53 24 L50 15 Z" fill={W} />
          <Path d="M50 26 L67 62 L33 62 Z" fill={W} />
          <Rect x="31" y="59" width="38" height="8" rx="4" fill={W} />
        </G>
      );
    case 'cossack':
      return (
        <G>
          <Path d="M34 32 C34 21 66 21 66 32 L66 64 L34 64 Z" fill={W} />
          <Rect x="34" y="57" width="32" height="7" fill={c} />
        </G>
      );
    case 'gunslinger':
      return (
        <G>
          <Ellipse cx="50" cy="60" rx="30" ry="7" fill={W} />
          <Path d="M37 60 C37 41 63 41 63 60 Z" fill={W} />
          <Rect x="37" y="56" width="26" height="4" fill={c} />
        </G>
      );
    case 'pirate':
      return (
        <G>
          <Path d="M22 60 C26 42 74 42 78 60 C70 56 64 52 50 52 C36 52 30 56 22 60 Z" fill={W} />
          <Path d="M43 46 L50 36 L57 46 Z" fill={W} />
        </G>
      );
    case 'musketeer':
      return (
        <G>
          <Path d="M58 42 C75 30 85 36 89 41 C78 41 68 47 60 51 Z" fill={W} />
          <Ellipse cx="48" cy="58" rx="28" ry="6" fill={W} />
          <Path d="M36 58 C36 41 60 41 60 58 Z" fill={W} />
        </G>
      );
    default:
      return null;
  }
}

export function WarriorAvatar({
  warrior,
  color = DEFAULT_AVATAR_COLOR,
  size = 72,
}: {
  warrior: WarriorKey;
  color?: string | null;
  size?: number;
}) {
  const c = color || DEFAULT_AVATAR_COLOR;
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Circle cx="50" cy="50" r="50" fill={c} />
      <Emblem k={warrior} c={c} />
    </Svg>
  );
}
