import { Component, inject } from '@angular/core';
import { RouterLink, Router } from '@angular/router';

import { Button, Heading, Text, Link, Alert } from '../../ui';
import { Session } from '../session/session';
import { AuthHttp } from '../shared/http';
import { Action } from '../shared/action';
import { AuthFeedback } from '../shared/feedback';
import { AuthNavigation } from '../shared/navigation';
import { Journey } from '../shared/journey';
import { GoogleButton } from '../google/google-button';
import type { Pending, SessionView } from '../session/models';

import { Passkeys } from './passkeys';

@Component({
  selector: 'app-sign-in',
  imports: [Button, Heading, Text, Link, Alert, RouterLink, AuthFeedback, GoogleButton],
  providers: [AuthHttp, Passkeys],
  template: `<section class="space-y-6">
    <header class="space-y-3">
      <p class="text-sm font-medium text-blue-600 dark:text-blue-400" i18n="@@authWelcomeBack">WELCOME BACK</p>
      <h1 appUI i18n="@@authSignInHeading">Sign in to your space.</h1>
      <p appUI tone="muted" i18n="@@authSignInDescription">
        Choose how you want to sign in. Your passkey can use your device's screen lock.
      </p>
    </header>
    @if (session.status() === 'unavailable') {
      <div appUI="alert" tone="warning" role="status" i18n="@@authUnavailable">
        We could not connect to authentication. Check your connection and try again.
      </div>
      <button appUI class="w-full" (click)="retry()" i18n="@@authRetry">Try again</button>
    } @else if (session.snapshot().access !== 'anonymous') {
      <button appUI class="w-full" (click)="navigation.complete()" i18n="@@authContinue">Continue</button>
    } @else {
      <button appUI class="min-h-12 w-full" (click)="passkey()" [disabled]="action.busy()" i18n="@@authSignInPasskey">
        Sign in with a passkey
      </button>
      @if (session.providers()?.google?.enabled) {
        <app-google-button
          [disabled]="action.busy()"
          (processing)="action.busy.set($event)"
          (completed)="google($event)"
        />
      }
      <a
        appUI
        routerLink="/auth/sign-in/password"
        [queryParams]="navigation.returnQuery()"
        class="block py-2 text-center"
        i18n="@@authUsePassword"
        >Use a password</a
      >
    }
    <app-auth-feedback [action]="action" />
    <div class="space-y-3 border-t border-zinc-200 pt-5 text-center text-sm dark:border-zinc-800">
      <p class="flex flex-wrap justify-center gap-x-1">
        <span i18n="@@authNewHere">New here?</span>
        <a appUI routerLink="/auth/sign-up" [queryParams]="navigation.returnQuery()" i18n="@@authCreateAccount"
          >Create an account</a
        >
      </p>
      <a appUI variant="muted" routerLink="/auth/recovery" i18n="@@authCannotAccess">Can't access your account?</a>
    </div>
  </section>`,
})
export class SignIn {
  readonly session = inject(Session);
  readonly navigation = inject(AuthNavigation);
  private readonly keys = inject(Passkeys);
  private readonly router = inject(Router);
  private readonly journey = inject(Journey);

  readonly action = new Action();

  retry(): void {
    void this.action.run(async () => {
      await this.session.load(true);

      await this.session.loadProviders();

      if (this.session.status() === 'ready' && this.session.snapshot().access !== 'anonymous') {
        await this.navigation.complete();
      }
    });
  }

  passkey(): void {
    void this.action.run(async () => {
      await this.keys.authenticate();

      await this.navigation.complete();
    });
  }

  google(result: SessionView | (Pending & { factor: 'email' })): void {
    void this.action.run(async () => {
      if ('access' in result) {
        await this.navigation.complete();
      } else {
        this.journey.start('google', result);

        await this.router.navigate(['/auth/google/verify-email'], { queryParams: this.navigation.returnQuery() });
      }
    });
  }
}
