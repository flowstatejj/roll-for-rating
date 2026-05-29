import { StyleSheet, View } from 'react-native';
import Svg, { Defs, Line, Pattern, Rect } from 'react-native-svg';

/**
 * Full-screen woven "tatami mat" texture, drawn as a tiling vector pattern so
 * it stays crisp at any size. Cards on top are translucent, so this grain
 * shows through (the chess.com "texture behind everything" trick).
 *
 * 🎨 PLACEHOLDER COLORS — change these five values to recolor the whole mat.
 * (Neutral slate for now; not brown/green.)
 */
const MAT_BASE = '#3a4350'; // overall mat colour
const MAT_BASE_ALT = '#363f4b'; // alternating woven block (slightly darker)
const STRAND_SHADOW = '#2f3742'; // the gaps between straw strands
const STRAND_LIGHT = '#454f5d'; // highlight on each strand
const EDGE = '#2b323c'; // seam between woven blocks

const TILE = 48; // size of one full basketweave repeat
const CELL = TILE / 2; // each weave block
const PITCH = 4; // spacing between individual strands

// Straw strands inside one CELL×CELL block, running horizontally or vertically.
function Strands({ orient, ox, oy }: { orient: 'h' | 'v'; ox: number; oy: number }) {
  const lines = [];
  for (let p = PITCH / 2; p < CELL; p += PITCH) {
    if (orient === 'h') {
      lines.push(
        <Line key={`s${p}`} x1={ox} y1={oy + p} x2={ox + CELL} y2={oy + p} stroke={STRAND_SHADOW} strokeWidth={1.1} />,
        <Line key={`l${p}`} x1={ox} y1={oy + p - 1} x2={ox + CELL} y2={oy + p - 1} stroke={STRAND_LIGHT} strokeWidth={0.5} />,
      );
    } else {
      lines.push(
        <Line key={`s${p}`} x1={ox + p} y1={oy} x2={ox + p} y2={oy + CELL} stroke={STRAND_SHADOW} strokeWidth={1.1} />,
        <Line key={`l${p}`} x1={ox + p - 1} y1={oy} x2={ox + p - 1} y2={oy + CELL} stroke={STRAND_LIGHT} strokeWidth={0.5} />,
      );
    }
  }
  return <>{lines}</>;
}

export function TatamiBackground() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width="100%" height="100%">
        <Defs>
          <Pattern id="tatami" width={TILE} height={TILE} patternUnits="userSpaceOnUse">
            {/* base + alternating woven blocks (checkerboard of weave direction) */}
            <Rect x={0} y={0} width={TILE} height={TILE} fill={MAT_BASE} />
            <Rect x={0} y={0} width={CELL} height={CELL} fill={MAT_BASE} />
            <Rect x={CELL} y={0} width={CELL} height={CELL} fill={MAT_BASE_ALT} />
            <Rect x={0} y={CELL} width={CELL} height={CELL} fill={MAT_BASE_ALT} />
            <Rect x={CELL} y={CELL} width={CELL} height={CELL} fill={MAT_BASE} />

            {/* straw strands — over/under basketweave */}
            <Strands orient="h" ox={0} oy={0} />
            <Strands orient="v" ox={CELL} oy={0} />
            <Strands orient="v" ox={0} oy={CELL} />
            <Strands orient="h" ox={CELL} oy={CELL} />

            {/* seams between the woven blocks */}
            <Line x1={CELL} y1={0} x2={CELL} y2={TILE} stroke={EDGE} strokeWidth={1} />
            <Line x1={0} y1={CELL} x2={TILE} y2={CELL} stroke={EDGE} strokeWidth={1} />
          </Pattern>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#tatami)" />
      </Svg>
    </View>
  );
}
