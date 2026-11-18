import { expect, type Locator } from '@playwright/test';

export async function expectCenteredDigits(widget: Locator): Promise<void> {
  // Highlight only the synthetic digits so the slot borders are excluded from the ink bounds.
  const input = widget.locator('input');
  const previousColor = await input.evaluate((element: HTMLInputElement) => {
    const color = element.style.color;

    element.style.color = '#f00';

    return color;
  });

  const frame = await widget
    .screenshot({ scale: 'css' })
    .finally(() => input.evaluate((element: HTMLInputElement, color) => (element.style.color = color), previousColor));
  const offsets = await widget.evaluate(async (element, bytes) => {
    const bitmap = await createImageBitmap(new Blob([Uint8Array.from(bytes)], { type: 'image/png' }));
    const context = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d')!;

    context.drawImage(bitmap, 0, 0);
    const { left, top } = element.getBoundingClientRect();

    return Array.from(element.querySelectorAll('.slot'), (slot) => {
      const box = slot.getBoundingClientRect();
      const x = Math.round(box.left - left);
      const y = Math.round(box.top - top);
      const width = Math.round(box.right - left) - x;
      const height = Math.round(box.bottom - top) - y;
      const { data } = context.getImageData(x, y, width, height);
      const xs: number[] = [];
      const ys: number[] = [];

      for (let index = 0; index < width * height; index++) {
        if (data[4 * index] > 150 && data[4 * index + 1] < 120 && data[4 * index + 2] < 120) {
          xs.push(index % width);
          ys.push(Math.floor(index / width));
        }
      }

      return {
        horizontal: xs.length ? Math.abs(Math.min(...xs) + Math.max(...xs) + 1 - width) / 2 : Infinity,
        vertical: ys.length ? Math.abs(Math.min(...ys) + Math.max(...ys) + 1 - height) / 2 : Infinity,
      };
    });
  }, Array.from(frame));

  for (const [index, offset] of offsets.entries()) {
    expect(offset.horizontal, `Horizontal ink center for slot ${index + 1}`).toBeLessThanOrEqual(2);
    expect(offset.vertical, `Vertical ink center for slot ${index + 1}`).toBeLessThanOrEqual(2);
  }
}
