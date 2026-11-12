import { expect, test } from '@playwright/test';

for (const [adapter, path] of [
  ['Astro', '/en/'],
  ['Angular', '/app/en/auth/sign-in'],
]) {
  test(`${adapter} page colors follow the theme icon timing`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' });

    await page.goto(path);

    const switcher = page.locator('[data-theme-switcher]');
    const active = page.locator('[data-theme-transition]');

    await expect(switcher).toBeEnabled();

    await expect(active).toHaveCount(0);

    const idleDuration = await switcher.evaluate((element) => getComputedStyle(element).transitionDuration);
    const initialBackground = await page
      .locator('body')
      .evaluate((element) => getComputedStyle(element).backgroundColor);

    for (const dark of [true, false]) {
      const motion = await switcher.evaluate(async (button) => {
        const probes = [
          document.body,
          document.querySelector('h1')!,
          document.querySelector('[appUI="card"]') ?? document.querySelector('header')!,
        ];
        const values = () =>
          probes.map((element) => {
            const style = getComputedStyle(element);

            return { background: style.backgroundColor, text: style.color, border: style.borderBottomColor };
          });

        (button as HTMLButtonElement).click();

        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

        const icons = Array.from(button.querySelectorAll('svg'))
          .flatMap((icon) => icon.getAnimations())
          .filter((animation) => animation instanceof CSSAnimation);
        const colors = document.getAnimations().filter((animation) => animation instanceof CSSTransition);
        const animations = [...icons, ...colors];
        const timing = animations.map((animation) => ({
          duration: animation.effect!.getTiming().duration,
          easing:
            animation instanceof CSSAnimation
              ? (animation.effect as KeyframeEffect).getKeyframes()[0].easing
              : animation.effect!.getTiming().easing,
        }));

        for (const animation of animations) {
          animation.pause();
        }

        const samples = [0, 200, 399].map((time) => {
          for (const animation of animations) {
            animation.currentTime = time;
          }

          return values();
        });

        for (const animation of animations) {
          animation.finish();
        }

        return { icons: icons.length, colors: colors.length, timing, samples };
      });

      expect(motion.icons).toBe(2);
      expect(motion.colors).toBeGreaterThan(0);
      expect(motion.timing.every((timing) => timing.duration === 400 && timing.easing === 'ease-in-out')).toBe(true);
      expect(motion.samples[1][0].background).not.toBe(motion.samples[0][0].background);
      expect(motion.samples[1][0].background).not.toBe(motion.samples[2][0].background);
      expect(motion.samples[1][1].text).not.toBe(motion.samples[0][1].text);
      expect(motion.samples[1][1].text).not.toBe(motion.samples[2][1].text);
      expect(motion.samples[1][2].border).not.toBe(motion.samples[0][2].border);
      expect(motion.samples[1][2].border).not.toBe(motion.samples[2][2].border);

      await expect(switcher).toHaveAttribute('aria-pressed', String(dark));

      await expect(active).toHaveCount(0);

      await expect(switcher).toHaveCSS('transition-duration', idleDuration);
    }

    await switcher.evaluate(async (button) => {
      (button as HTMLButtonElement).click();

      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

      (button as HTMLButtonElement).click();
    });

    await expect(switcher).toHaveAttribute('aria-pressed', 'false');

    await expect(active).toHaveCount(0);

    await expect(page.locator('body')).toHaveCSS('background-color', initialBackground);

    await page.emulateMedia({ reducedMotion: 'reduce' });

    await switcher.click();

    await expect(switcher).toHaveAttribute('aria-pressed', 'true');

    const animations = await page.evaluate(() => document.getAnimations().length);

    expect(animations).toBe(0);
  });

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
        const animations = icons
          .flatMap((icon) => icon.getAnimations())
          .filter((animation) => animation instanceof CSSAnimation);

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
