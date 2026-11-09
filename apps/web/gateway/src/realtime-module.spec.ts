import { expect, it } from 'vitest';

import { loadRealtime } from './realtime-module';

it('loads the compiled realtime factory without starting a listener', async () => {
  const entry = new URL('../../../../dist/apps/web/realtime/app.js', import.meta.url);
  const realtime = await loadRealtime(entry);

  expect(realtime.attachRealtimeServer).toBeTypeOf('function');
});
