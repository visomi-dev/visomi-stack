export type ThemePreference = 'system' | 'light' | 'dark';
export type ColorScheme = Exclude<ThemePreference, 'system'>;

export const theme = {
  storageKey: 'visomi.theme',

  isPreference(value: unknown): value is ThemePreference {
    return value === 'system' || value === 'light' || value === 'dark';
  },

  preference(value: unknown): ThemePreference {
    return theme.isPreference(value) ? value : 'system';
  },

  resolve(preference: ThemePreference, systemDark: boolean): ColorScheme {
    return preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;
  },
} as const;
