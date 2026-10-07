import { useColorScheme } from 'react-native';

const palette = {
  light: {
    bg: '#F6F7F5',
    surface: '#FFFFFF',
    surfaceAlt: '#EEF1EC',
    border: '#D9DED6',
    text: '#111814',
    textMuted: '#5B665F',
    primary: '#1B6B3A',
    primaryText: '#FFFFFF',
    danger: '#C62828',
    birdie: '#D32F2F',
    bogey: '#1565C0',
    selected: '#FFE9A8',
  },
  dark: {
    bg: '#0E1210',
    surface: '#171C19',
    surfaceAlt: '#202723',
    border: '#2E3631',
    text: '#EEF2EF',
    textMuted: '#9AA59E',
    primary: '#4CAF73',
    primaryText: '#0E1210',
    danger: '#EF5350',
    birdie: '#FF6B6B',
    bogey: '#64B5F6',
    selected: '#5C4B12',
  },
} as const;

export type Colors = { [K in keyof typeof palette.light]: string };

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 6, md: 10, lg: 16 } as const;
export const maxContentWidth = 860;

export function useColors(): Colors {
  return useColorScheme() === 'dark' ? palette.dark : palette.light;
}

/** Color for a score cell relative to par (red under, blue over — scorecard convention). */
export function scoreColor(c: Colors, strokes: number | null, par: number): string {
  if (strokes == null) return c.text;
  if (strokes < par) return c.birdie;
  if (strokes > par) return c.bogey;
  return c.text;
}
