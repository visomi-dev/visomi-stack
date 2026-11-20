import { DOCUMENT } from '@angular/common';
import { Service, inject } from '@angular/core';

import { DatabaseHttp } from '../shared/db/http';

import { readExampleProfile } from './example-contracts';

@Service({ autoProvided: false })
export class ExampleVaultProfile {
  private readonly api = inject(DatabaseHttp);
  private readonly document = inject(DOCUMENT);

  async relyingParty(): Promise<string> {
    try {
      const raw = await this.api.vault('/policy');
      const profile = readExampleProfile(raw, this.document.defaultView?.location.origin);

      return profile.rpId;
    } catch {
      // The reference action exists only in the explicit synthetic API composition.
      return '';
    }
  }
}
