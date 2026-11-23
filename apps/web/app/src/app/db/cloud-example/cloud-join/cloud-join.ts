import { DOCUMENT } from '@angular/common';
import { Component, DestroyRef, afterNextRender, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

import { Session } from '../../../auth/session/session';
import { DatabaseHttp } from '../../../shared/db/http';
import { NavigationHeading } from '../../../shared/navigation-heading';
import { Button, Heading, Text } from '../../../ui';

import { CloudJoinRequest } from './cloud-join-request';

const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const pendingLink = 'visomi-cloud-share-link';

@Component({
  selector: 'app-cloud-join',
  imports: [Button, Heading, NavigationHeading, Text],
  providers: [DatabaseHttp, CloudJoinRequest],
  templateUrl: './cloud-join.html',
})
export class CloudJoin {
  private readonly document = inject(DOCUMENT);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly request = inject(CloudJoinRequest);

  private readonly lifetime = new AbortController();
  private readonly cleanup = inject(DestroyRef).onDestroy(() => this.lifetime.abort());

  protected readonly session = inject(Session);

  protected readonly token = signal('');
  protected readonly ready = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal('');

  protected signIn(): void {
    try {
      this.document.defaultView?.sessionStorage.setItem(pendingLink, this.token());
    } catch {
      // Signing in still works when a storage policy requires reopening the original link.
    }

    void this.router.navigate(['/auth/sign-in'], { queryParams: { returnTo: '/db-example/cloud/join' } });
  }

  protected async join(): Promise<void> {
    if (this.busy() || !this.session.full() || !this.token()) {
      return;
    }

    this.busy.set(true);
    this.error.set('');

    try {
      const { tenantId, scopeId } = await this.request.redeem(this.token(), this.lifetime.signal);

      try {
        this.document.defaultView?.sessionStorage.removeItem(pendingLink);
      } catch {
        // Some browsers do not expose session storage.
      }

      await this.router.navigate(['/db-example/cloud', tenantId, scopeId], { replaceUrl: true });
    } catch {
      if (!this.lifetime.signal.aborted) {
        this.error.set($localize`:@@cloudJoinFailed:This link is unavailable or you don’t have access.`);
      }
    } finally {
      this.busy.set(false);
    }
  }

  private readonly initialize = afterNextRender(() => {
    let token = this.route.snapshot.fragment;

    if (!token) {
      try {
        token = this.document.defaultView?.sessionStorage.getItem(pendingLink) ?? null;
      } catch {
        token = null;
      }
    }

    this.token.set(token && tokenPattern.test(token) ? token : '');
    this.ready.set(true);
    void this.session.load();
  });
}
