import * as ui from '../index';

describe('portable UI recipes', () => {
  it('exports 37 recipes without requiring a browser or framework', () => {
    expect(Object.keys(ui)).toHaveLength(37);

    for (const recipe of Object.values(ui)) {
      const classes = recipe.classes().split(' ');

      expect(classes.length).toBeGreaterThan(0);
      expect(classes).not.toContain('');
      expect(classes).not.toContain('undefined');
    }
  });

  it('keeps button and link interaction semantics distinct', () => {
    expect(ui.button.classes()).toContain('enabled:hover:');
    expect(ui.linkButton.classes()).toContain(' hover:');
    expect(ui.linkButton.classes()).not.toContain('enabled:hover:');
    expect(ui.linkButton.classes()).toContain('aria-[current=page]:');
  });

  it('keeps tone independent from geometry across feedback and surfaces', () => {
    for (const tone of ['neutral', 'accent', 'success', 'warning', 'danger'] as const) {
      expect(ui.badge.classes({ tone })).toContain('rounded-md');
      expect(ui.alert.classes({ tone })).toContain('rounded-xl');
      expect(ui.alert.classes({ tone })).toContain('dark:');
    }

    expect(ui.card.classes({ tone: 'raised', padding: 'sm' })).toContain('p-3');
    expect(ui.card.classes({ tone: 'ghost', padding: 'lg' })).toContain('p-6');
    expect(ui.card.classes({ tone: 'ghost' })).not.toContain('shadow-xl');
  });

  it('supports control sizing without changing native state or value', () => {
    for (const recipe of [ui.input, ui.textarea, ui.select]) {
      for (const size of ['sm', 'md', 'lg'] as const) {
        const classes = recipe.classes({ size });

        expect(classes).toContain('ui-focus-ring');
        expect(classes).toContain('disabled:');
        expect(classes).toContain('aria-invalid:');
        expect(classes).not.toContain('undefined');
      }
    }

    expect(ui.radio.classes()).not.toContain('appearance-none');
    expect(ui.checkbox.classes()).not.toContain('appearance-none');
    expect(ui.toggle.classes()).toContain('checked:');
    expect(ui.toggle.classes()).toContain('forced-colors:appearance-auto');
  });

  it('keeps field spacing and table layout options independent of validation and density', () => {
    expect(ui.field.classes({ compact: true })).toContain('gap-1.5');
    expect(ui.field.classes({ compact: true })).not.toContain('gap-2');
    expect(ui.field.classes()).toContain('data-submitted');
    expect(ui.errorMessage.classes()).toContain('motion-reduce:transition-none');
    expect(ui.errorMessage.classes()).not.toContain('max-h-');
    const cards = ui.table.classes({ mobileCards: true, stickyHeaders: true, density: 'compact', striped: true });

    expect(cards).toContain('grid-cols-1');
    expect(cards).toContain('md:');
    expect(cards).toContain('sticky');
    expect(cards).toContain('[&_td]:py-2');
    expect(cards).toContain('nth-child(even)');
    expect(ui.table.classes()).not.toContain('grid-cols-1');
    expect(ui.table.classes()).not.toContain('sticky');
  });

  it('retains native dialog visibility and reduced-motion support', () => {
    for (const size of ['sm', 'md', 'lg'] as const) {
      expect(ui.dialog.classes({ size }).split(' ')).not.toEqual(expect.arrayContaining(['block']));
      expect(ui.dialog.classes({ size })).toContain('backdrop:');
    }

    expect(ui.loader.classes().split(' ')).toContain('motion-safe:animate-spin');
    expect(ui.loader.classes().split(' ')).not.toContain('animate-spin');
    expect(ui.disclosure.classes()).toContain('summary:focus-visible');
  });

  it('varies presentation without mixing incompatible class choices', () => {
    expect(ui.heading.classes({ size: 'xl' })).toContain('text-4xl');
    expect(ui.text.classes({ size: 'sm', tone: 'muted' })).toContain('text-zinc-600');
    expect(ui.code.classes({ block: true })).toContain('overflow-x-auto');
    expect(ui.code.classes()).not.toContain('overflow-x-auto');
    expect(ui.divider.classes({ soft: true })).not.toContain('border-zinc-200');
    expect(ui.avatar.classes({ size: 'lg', shape: 'rounded' })).not.toContain('rounded-full');
    expect(ui.table.classes({ density: 'compact', striped: true })).toContain('nth-child(even)');
    expect(ui.table.classes()).not.toContain('nth-child(even)');
    expect(ui.label.classes({ inline: true })).toContain('min-h-11');
    expect(ui.container.classes({ width: 'full' })).toContain('max-w-none');
  });
});
