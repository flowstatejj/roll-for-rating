/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

// chess.com-inspired palette: deep charcoal surfaces + signature green.
export const Colors = {
  light: {
    text: '#1b1a17',
    background: '#f7f6f4',
    backgroundElement: '#ffffff',
    backgroundSelected: '#eceae6',
    textSecondary: '#6b6862',
    accent: '#2f81f7',
    accentDark: '#1c5fc2',
    accentText: '#ffffff',
    border: '#e2dfd9',
    success: '#5c9a3a',
    danger: '#ca3431',
    tile: 'rgba(255,255,255,0.72)',
    tileBorder: 'rgba(0,0,0,0.06)',
  },
  dark: {
    text: '#ffffff',
    background: '#262421',
    backgroundElement: '#312e2b',
    backgroundSelected: '#3d3a37',
    textSecondary: '#b6b3ad',
    accent: '#2f81f7',
    accentDark: '#1c5fc2',
    accentText: '#ffffff',
    border: '#3d3a37',
    success: '#9bce5b',
    danger: '#e0564b',
    // translucent panel that floats over the tatami texture
    tile: 'rgba(15,16,18,0.55)',
    tileBorder: 'rgba(255,255,255,0.08)',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
