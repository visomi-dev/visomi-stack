import { expect, test } from '@playwright/test';

import { authenticateViaDeterministicTestSession, createCredentials } from '../support/auth';

test('supports native radio keyboard navigation and disabled options in both presentations', async ({
  page,
  request,
}) => {
  const credentials = createCredentials();

  await authenticateViaDeterministicTestSession(page, request, credentials.email, credentials.password);
  await page.goto('/app/en/gallery');
  await page.getByRole('searchbox', { name: 'Filter components' }).fill('radio');
  const group = page.getByRole('group', { name: 'Choose a plan' });
  const starter = group.getByRole('radio', { name: 'Starter', exact: true });
  const team = group.getByRole('radio', { name: 'Team', exact: true });

  await starter.check();
  await starter.press('ArrowRight');
  await expect(team).toBeChecked();
  await expect(team).toBeFocused();
  await expect(group.getByRole('radio', { name: 'Enterprise', exact: true })).toBeDisabled();
  await team.press('ArrowRight');
  await expect(starter).toBeChecked();
  await page.screenshot({ path: 'tmp/auth-captures/radio-controls-desktop.png', fullPage: true });

  const cards = page.locator('app-radio-card');
  const firstCard = cards.nth(0).getByRole('radio');
  const secondCard = cards.nth(1).getByRole('radio');

  await firstCard.focus();
  await firstCard.press('ArrowRight');
  await expect(secondCard).toBeChecked();
  await expect(team).toBeChecked();
  await secondCard.press('Space');
  await expect(secondCard).toBeChecked();
  await expect(cards.nth(2).getByRole('radio')).toBeDisabled();
  await expect(cards.locator('label[tabindex]')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await group.screenshot({ path: 'tmp/auth-captures/radio-controls-mobile.png' });
});
