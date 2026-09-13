import { Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { AuthCard } from '../../shared/ui/layout/auth-card/auth-card';
import { AuthLayout } from '../../shared/ui/layout/auth-layout/auth-layout';

@Component({
  imports: [AuthCard, AuthLayout, RouterLink],
  selector: 'app-unsupported-auth-intent',
  templateUrl: './unsupported.html',
  styleUrl: './unsupported.css',
})
export class UnsupportedAuthIntent {
  private readonly route = inject(ActivatedRoute);

  protected readonly title = this.route.snapshot.data['title'] as string;
  protected readonly description = this.route.snapshot.data['description'] as string;
}
