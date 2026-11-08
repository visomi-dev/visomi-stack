import { Service, signal } from '@angular/core';

import type { Pending } from '../session/models';

export type ChallengePurpose = 'password' | 'email' | 'google' | 'reset' | 'recovery';
export type Challenge = Pending & { purpose: ChallengePurpose; factor?: 'email' | 'totp'; sentAt: number };

@Service({ autoProvided: false })
export class Journey {
  private readonly current = signal<Challenge | null>(null);

  readonly challenge = this.current.asReadonly();

  start(purpose: ChallengePurpose, pending: Pending & { factor?: 'email' | 'totp' }): void {
    this.current.set({ ...pending, purpose, sentAt: Date.now() });
  }

  clear(): void {
    this.current.set(null);
  }
}
