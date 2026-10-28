import { authSchema, DATABASE, inject, type Database } from '@visomi-stack/backend-shared';
import { and, eq, isNull } from 'drizzle-orm';

import { requireFull } from '../shared/identity';
import { Factors } from '../totp/service';

const { users, federatedIdentities, credentials } = authSchema;

export class Methods {
  private readonly database = inject<Database>(DATABASE);
  readonly factors = inject(Factors);

  async overview(current: Express.User) {
    requireFull(current);
    const [user] = await this.database.select().from(users).where(eq(users.id, current.id));
    const providers = await this.database
      .select({ id: federatedIdentities.id })
      .from(federatedIdentities)
      .where(and(eq(federatedIdentities.userId, current.id), isNull(federatedIdentities.revokedAt)));
    const keys = await this.database
      .select({ id: credentials.id, label: credentials.label })
      .from(credentials)
      .where(
        and(eq(credentials.userId, current.id), isNull(credentials.revokedAt), isNull(credentials.pendingGrantId)),
      );
    const totp = await this.factors.active(this.database, current.id);

    return { password: Boolean(user.passwordHash), google: providers, passkeys: keys, totp: Boolean(totp) };
  }
}
