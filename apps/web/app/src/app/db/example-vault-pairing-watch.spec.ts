import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { watchVaultPairing } from './example-vault-pairing-watch';

function pairingWindow() {
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const view = Object.assign(new EventTarget(), { document, setTimeout, clearTimeout }) as unknown as Window;

  return { view, document };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

it('coalesces socket and page events without postponing the queued refresh', async () => {
  const { view, document } = pairingWindow();
  const refresh = vi.fn(async () => undefined);
  const watch = watchVaultPairing(view, refresh, () => true);

  watch.wake();
  view.dispatchEvent(new Event('pageshow'));

  await vi.advanceTimersByTimeAsync(0);

  expect(refresh).toHaveBeenCalledTimes(1);

  watch.wake();
  document.dispatchEvent(new Event('visibilitychange'));

  await vi.advanceTimersByTimeAsync(4_999);

  expect(refresh).toHaveBeenCalledTimes(1);

  watch.wake();

  await vi.advanceTimersByTimeAsync(1);

  expect(refresh).toHaveBeenCalledTimes(2);

  watch.stop();
});

it('retains one follow-up when hints arrive during a slow request', async () => {
  const { view } = pairingWindow();
  const refresh = vi
    .fn<() => Promise<void>>()
    .mockImplementationOnce(() => new Promise((resolve) => view.setTimeout(resolve, 6_000)))
    .mockResolvedValue(undefined);
  const watch = watchVaultPairing(view, refresh, () => true);

  await vi.advanceTimersByTimeAsync(0);

  watch.wake();
  watch.wake();

  await vi.advanceTimersByTimeAsync(5_999);

  expect(refresh).toHaveBeenCalledTimes(1);

  await vi.advanceTimersByTimeAsync(2);

  expect(refresh).toHaveBeenCalledTimes(2);

  await vi.advanceTimersByTimeAsync(5_000);

  expect(refresh).toHaveBeenCalledTimes(2);

  watch.stop();
});

it('keeps the connected and disconnected fallback intervals and wakes on reconnect', async () => {
  const { view } = pairingWindow();
  const refresh = vi.fn(async () => undefined);
  const connected = vi.fn(() => true);
  const watch = watchVaultPairing(view, refresh, connected);

  await vi.advanceTimersByTimeAsync(29_999);

  expect(refresh).toHaveBeenCalledTimes(1);

  await vi.advanceTimersByTimeAsync(1);

  expect(refresh).toHaveBeenCalledTimes(2);

  connected.mockReturnValue(false);
  watch.wake();

  await vi.advanceTimersByTimeAsync(14_999);

  expect(refresh).toHaveBeenCalledTimes(3);

  await vi.advanceTimersByTimeAsync(1);

  expect(refresh).toHaveBeenCalledTimes(4);

  connected.mockReturnValue(true);
  watch.wake();

  await vi.advanceTimersByTimeAsync(5_000);

  expect(refresh).toHaveBeenCalledTimes(5);

  watch.stop();
});

it('waits after a write, resumes when visible, and drops queued work when stopped', async () => {
  const { view, document } = pairingWindow();
  const refresh = vi.fn(async () => undefined);
  const watch = watchVaultPairing(view, refresh, () => true, { delayFirstCheck: true });

  view.dispatchEvent(new Event('pageshow'));

  await vi.advanceTimersByTimeAsync(4_999);

  expect(refresh).not.toHaveBeenCalled();

  document.visibilityState = 'hidden';

  await vi.advanceTimersByTimeAsync(1);

  expect(refresh).not.toHaveBeenCalled();

  document.visibilityState = 'visible';
  document.dispatchEvent(new Event('visibilitychange'));

  await vi.advanceTimersByTimeAsync(0);

  expect(refresh).toHaveBeenCalledOnce();

  watch.wake();
  watch.stop();
  view.dispatchEvent(new Event('pageshow'));
  document.dispatchEvent(new Event('visibilitychange'));

  await vi.advanceTimersByTimeAsync(30_000);

  expect(refresh).toHaveBeenCalledOnce();
});
