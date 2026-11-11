import { Service, inject } from '@angular/core';
import { Router } from '@angular/router';

import { Action } from '../shared/action';
import { AuthHttp } from '../shared/http';

import { Session } from './session';

type LogoutOptions = {
  clearFlowState?: () => void;
  checkSessionOnFailure?: boolean;
};

@Service({ autoProvided: false })
export class Logout {
  private readonly action = inject(Action);
  private readonly http = inject(AuthHttp);
  private readonly router = inject(Router);
  private readonly session = inject(Session);

  run({ clearFlowState, checkSessionOnFailure = false }: LogoutOptions = {}): Promise<void> {
    return this.action.run(
      async () => {
        try {
          this.session.cancelOperations();

          await this.http.request('POST', '/logout', {});

          this.session.clear();
          clearFlowState?.();
        } catch (error) {
          if (!checkSessionOnFailure) {
            throw error;
          }

          await this.session.load(true);

          if (this.session.snapshot().access !== 'anonymous' || this.session.status() !== 'ready') {
            throw error;
          }
        }

        await this.router.navigate(['/auth/sign-in']);
      },
      { name: 'logout' },
    );
  }
}
