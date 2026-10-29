import { button, type ButtonSize, type ButtonVariant } from '../index';

describe('button classes', () => {
  it('uses the same defaults for omitted and partially specified options', () => {
    expect(button.classes()).toBe(button.classes({ variant: 'primary', size: 'md' }));
    expect(button.classes({ variant: 'secondary' })).toBe(button.classes({ variant: 'secondary', size: 'md' }));
    expect(button.classes({ size: 'sm' })).toBe(button.classes({ variant: 'primary', size: 'sm' }));
  });

  it.each<ButtonVariant>(['primary', 'secondary'])(
    'composes %s with every size and shared interaction styles',
    (variant) => {
      for (const size of ['sm', 'md'] satisfies ButtonSize[]) {
        const classes = button.classes({ variant, size }).split(' ');

        expect(classes).not.toContain('undefined');
        expect(classes).not.toContain('');
        expect(new Set(classes).size).toBe(classes.length);
        expect(classes).toContain('ui-focus-ring');
        expect(classes).toContain('min-h-11');
        expect(classes).toContain('disabled:opacity-50');
        expect(classes.some((name) => name.startsWith('enabled:hover:'))).toBe(true);
      }
    },
  );
});
