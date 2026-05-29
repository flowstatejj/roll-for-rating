/**
 * Learn more about light and dark modes:
 * https://docs.expo.dev/guides/color-schemes/
 */

import { Colors } from '@/constants/theme';

// RollCall ships dark-by-default (chess.com style). Swap this back to read
// useColorScheme() later if we want it to follow the device setting.
export function useTheme() {
  return Colors.dark;
}
