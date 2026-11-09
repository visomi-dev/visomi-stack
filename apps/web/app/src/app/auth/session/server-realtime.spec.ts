import { TestBed } from '@angular/core/testing';

import { SessionRealtime } from './realtime';
import { ServerRealtime } from './server-realtime';

it('provides the disconnected realtime contract for rendering', async () => {
  TestBed.configureTestingModule({ providers: [{ provide: SessionRealtime, useClass: ServerRealtime }] });
  const realtime = TestBed.inject(SessionRealtime);
  const listener = vi.fn();
  const close = realtime.connectSession(listener);
  const unwatch = realtime.watchDeviceApproval('synthetic-request', listener);

  expect(realtime.connected()).toBe(false);

  await expect(realtime.checkSession()).resolves.toBe(false);

  close();
  unwatch();
  expect(listener).not.toHaveBeenCalled();
});
