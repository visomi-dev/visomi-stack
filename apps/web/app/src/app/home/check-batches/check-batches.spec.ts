import { TestBed } from '@angular/core/testing';

import { sampleDays } from '../sample-checks';

import { CheckBatches } from './check-batches';

const recentDays = sampleDays.slice(-7);

async function renderBatches() {
  const fixture = TestBed.createComponent(CheckBatches);
  const root = fixture.nativeElement as HTMLElement;

  fixture.componentRef.setInput(
    'batches',
    sampleDays.flatMap(({ batches }) => batches),
  );

  await fixture.whenStable();

  return {
    fixture,
    root,
    batchIds: () => Array.from(root.querySelectorAll('tbody th'), (cell) => cell.id),
    pageStatus: () => root.querySelector('[role="status"]')?.textContent?.replace(/\s+/g, ' ').trim(),
  };
}

it('combines check type, batch ID and failure filters and shows an empty result', async () => {
  const { fixture, root, batchIds, pageStatus } = await renderBatches();
  const type = root.querySelector('select')!;
  const search = root.querySelector<HTMLInputElement>('input[type="search"]')!;
  const failures = root.querySelector<HTMLInputElement>('[role="switch"]')!;

  type.value = 'availability';
  type.dispatchEvent(new Event('change'));
  search.value = ' demo-040 ';
  search.dispatchEvent(new Event('input'));
  failures.click();

  await fixture.whenStable();

  expect(batchIds()).toEqual(['DEMO-040']);
  expect(root.querySelector('tbody')?.textContent).toContain('Has failures');
  expect(pageStatus()).toBe('Page 1 of 1 · 1 total');
  expect(root.querySelector('nav')).toBeNull();

  search.value = '';
  search.dispatchEvent(new Event('input'));
  type.value = 'certificate';
  type.dispatchEvent(new Event('change'));

  await fixture.whenStable();

  expect(root.querySelector('table')).toBeNull();
  expect(pageStatus()).toContain('No sample batches match these filters.');

  failures.click();

  await fixture.whenStable();

  expect(batchIds()).toEqual(['DEMO-042', 'DEMO-039', 'DEMO-036', 'DEMO-033', 'DEMO-030']);
  expect(root.querySelector('tbody')?.textContent).toContain('All passed');
});

it('bounds pagination, clears details on page change, and restarts at page one when the range or sort changes', async () => {
  const { fixture, root, batchIds, pageStatus } = await renderBatches();
  const [previous, next] = root.querySelectorAll<HTMLButtonElement>('nav button');
  const details = root.querySelector<HTMLButtonElement>('tbody button')!;

  expect(pageStatus()).toBe('Page 1 of 9 · 42 total');
  expect(previous.getAttribute('aria-disabled')).toBe('true');
  previous.click();
  details.click();

  await fixture.whenStable();

  expect(details.getAttribute('aria-expanded')).toBe('true');
  expect(root.querySelector('dl')?.id).toBe(details.getAttribute('aria-controls'));
  expect(root.querySelector('dl')?.textContent).toContain('Demo Bot');

  next.click();

  await fixture.whenStable();

  expect(pageStatus()).toBe('Page 2 of 9 · 42 total');
  expect(batchIds()[0]).toBe('DEMO-039');
  expect(root.querySelector('dl')).toBeNull();

  for (let page = 2; page < 9; page++) {
    next.click();

    await fixture.whenStable();
  }

  expect(next.getAttribute('aria-disabled')).toBe('true');
  next.click();

  await fixture.whenStable();

  expect(batchIds()).toEqual(['DEMO-002', 'DEMO-003']);
  expect(pageStatus()).toBe('Page 9 of 9 · 42 total');

  fixture.componentRef.setInput(
    'batches',
    recentDays.flatMap(({ batches }) => batches),
  );

  await fixture.whenStable();

  expect(pageStatus()).toBe('Page 1 of 5 · 21 total');
  expect(batchIds()[0]).toBe('DEMO-040');

  next.click();
  root.querySelector<HTMLInputElement>('input[value="oldest"]')!.click();

  await fixture.whenStable();

  expect(pageStatus()).toBe('Page 1 of 5 · 21 total');
  expect(batchIds()[0]).toBe('DEMO-022');
});
