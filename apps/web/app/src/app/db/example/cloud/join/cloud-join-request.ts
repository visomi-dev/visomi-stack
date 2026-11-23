import { Service, inject } from '@angular/core';
import { z } from 'zod';

import { DatabaseHttp } from '../../../../shared/db/http';

const workspace = z.strictObject({ tenantId: z.uuid(), scopeId: z.uuid() });

@Service({ autoProvided: false })
export class CloudJoinRequest {
  private readonly api = inject(DatabaseHttp);

  async redeem(token: string, signal: AbortSignal) {
    const raw = await this.api.cloud('/sharing/join', { token }, signal);

    return workspace.parse(raw);
  }
}
