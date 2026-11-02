import { Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { Heading, Text, Link } from '../../ui';
import { AuthHttp } from '../shared/http';
import { Action } from '../shared/action';
import { AuthFeedback } from '../shared/feedback';
import { EmailEntry } from '../shared/email-entry';
import { Journey } from '../shared/journey';

import { Recovery } from './recovery';

@Component({
  selector: 'app-recovery-request',
  imports: [Heading, Text, Link, RouterLink, AuthFeedback, EmailEntry],
  providers: [AuthHttp, Recovery],
  templateUrl: './request.html',
})
export class RecoveryRequest {
  private readonly api = inject(Recovery);
  private readonly journey = inject(Journey);
  private readonly router = inject(Router);

  readonly action = new Action();

  request(email: string): void {
    void this.action.run(async () => {
      const pending = await this.api.request(email);

      this.journey.start('recovery', pending);

      await this.router.navigate(['/auth/recovery/verify']);
    });
  }
}
