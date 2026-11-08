import { expect, test } from '@playwright/test';

for (const [adapter, path] of [
  ['Astro', '/en/'],
  ['Angular', '/app/en/auth/sign-in'],
]) {
  test(`${adapter} theme icons always enter from below and leave above`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' });

    await page.goto(path);

    const switcher = page.locator('[data-theme-switcher]');

    await expect(switcher).toBeEnabled();

    const initialAnimations = await switcher
      .locator('svg')
      .evaluateAll((icons) => icons.flatMap((icon) => icon.getAnimations()).length);

    expect(initialAnimations).toBe(0);

    for (const dark of [true, false, true, false]) {
      const motion = await switcher.evaluate(async (button) => {
        (button as HTMLButtonElement).click();

        // Allow both adapters to commit their theme before sampling the actual rendered motion.
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

        const icons = Array.from(button.querySelectorAll('svg'));
        const animations = icons.flatMap((icon) => icon.getAnimations());

        for (const animation of animations) {
          animation.pause();
        }

        const samples = [0, 200, 399].map((time) => {
          for (const animation of animations) {
            animation.currentTime = time;
          }

          return icons.map((icon) => {
            const style = getComputedStyle(icon);

            return { y: Number.parseFloat(style.translate.split(' ')[1] ?? '0'), opacity: Number(style.opacity) };
          });
        });

        for (const animation of animations) {
          animation.finish();
        }

        return { count: animations.length, samples };
      });

      expect(motion.count).toBe(2);
      const incoming = dark ? 1 : 0;
      const outgoing = dark ? 0 : 1;

      expect(motion.samples[0][incoming].y).toBeGreaterThan(40);
      expect(motion.samples[1][incoming].y).toBeGreaterThan(0);
      expect(motion.samples[2][incoming].y).toBeCloseTo(0, 1);
      expect(motion.samples[0][outgoing].y).toBe(0);
      expect(motion.samples[1][outgoing].y).toBeLessThan(0);
      expect(motion.samples[2][outgoing].y).toBeLessThan(-40);
      expect(motion.samples[1][incoming].opacity).toBeGreaterThan(motion.samples[0][incoming].opacity);
      expect(motion.samples[1][outgoing].opacity).toBeLessThan(motion.samples[0][outgoing].opacity);

      await expect(switcher).toHaveAttribute('aria-pressed', String(dark));
    }

    await switcher.click();

    await page.reload();

    await expect(switcher).toBeEnabled();

    await expect(switcher).toHaveAttribute('aria-pressed', 'true');

    const restoredAnimations = await switcher
      .locator('svg')
      .evaluateAll((icons) => icons.flatMap((icon) => icon.getAnimations()).length);

    expect(restoredAnimations).toBe(0);

    await page.emulateMedia({ reducedMotion: 'reduce' });

    for (const dark of [false, true]) {
      await switcher.click();

      await expect(switcher).toHaveAttribute('aria-pressed', String(dark));

      const animations = await switcher
        .locator('svg')
        .evaluateAll((icons) => icons.flatMap((icon) => icon.getAnimations()).length);

      expect(animations).toBe(0);
    }
  });
}
