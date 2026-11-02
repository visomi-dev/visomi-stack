import { Service, signal } from '@angular/core';

import type { Pending } from '../session/models';

export type ChallengePurpose = 'password' | 'email' | 'google' | 'reset' | 'recovery' | 'replacement';
export type Challenge = Pending & { purpose: ChallengePurpose; factor?: 'email' | 'totp'; sentAt: number };
@Service({ autoProvided: false })
export class Journey {
  readonly challenge = signal<Challenge | null>(null);

  start(purpose: ChallengePurpose, pending: Pending & { factor?: 'email' | 'totp' }): void {
    this.challenge.set({ ...pending, purpose, sentAt: Date.now() });
  }

  clear(): void {
    this.challenge.set(null);
  }
}
