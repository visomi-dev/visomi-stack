import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

import { Heading, Text, LinkButton } from '../../ui';

@Component({
  selector: 'app-private-home',
  imports: [Heading, Text, LinkButton, RouterLink],
  template: `<section class="max-w-2xl space-y-5 py-6">
    <p class="text-sm font-medium text-blue-600 dark:text-blue-400" i18n="@@authWelcomeEyebrow">YOUR SPACE</p>
    <h1 appUI i18n="@@authWelcome">Welcome home.</h1>
    <p appUI tone="muted" i18n="@@authWelcomeDescription">
      You are signed in. Manage your account and choose how you access it.
    </p>
    <div class="flex flex-wrap gap-3">
      <a appUI="button" routerLink="/account" i18n="@@authManageAccount">Manage account</a
      ><a appUI="button" variant="secondary" routerLink="/security" i18n="@@authReviewSecurity">Review security</a>
    </div>
  </section>`,
})
export class Home {}
