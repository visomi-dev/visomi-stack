import { AuthMail } from '@visomi-stack/backend-shared';
import { expect, it } from 'vitest';

import { config, quietMail, storage } from '../../../tests/support/auth-state';
import { authService } from '../../../tests/support/injection';
import { SecurityNotifications } from '../shared/notifications';

it('skips a security notice when no previous email exists', async () => {
  const notifications = authService(SecurityNotifications, storage().db, config, [
    { provide: AuthMail, useValue: quietMail },
  ]);
  const sent = await notifications.notify(null, 'password_changed');

  expect(sent).toBe(false);
});
