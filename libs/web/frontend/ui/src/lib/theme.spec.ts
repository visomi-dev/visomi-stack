import { theme } from './theme';

describe('theme preferences', () => {
  it.each(['system', 'light', 'dark'] as const)('preserves the %s preference', (preference) => {
    expect(theme.preference(preference)).toBe(preference);
  });

  it.each([null, undefined, '', 'DARK', 'invalid', {}])(
    'uses the system for an invalid stored preference: %s',
    (value) => {
      expect(theme.preference(value)).toBe('system');
    },
  );

  it('follows the system only when the preference is system', () => {
    expect(theme.resolve('system', true)).toBe('dark');
    expect(theme.resolve('system', false)).toBe('light');
    expect(theme.resolve('light', true)).toBe('light');
    expect(theme.resolve('dark', false)).toBe('dark');
  });
});
