import type { Page } from '@playwright/test';

export const fillOtp = async (page: Page, code: string) => {
  const digits = code.split('');

  for (const [index, digit] of digits.entries()) {
    await page.locator('[data-slot=pin-input] input').nth(index).fill(digit);
  }
};
