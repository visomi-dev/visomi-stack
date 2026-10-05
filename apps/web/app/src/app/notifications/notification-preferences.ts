import { HttpClient } from '@angular/common/http';
import { Component, DestroyRef, inject, input, linkedSignal, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { disabled, form, submit } from '@angular/forms/signals';
import type { FieldTree } from '@angular/forms/signals';
import { firstValueFrom } from 'rxjs';

import { Button } from '../shared/ui/actions/button/button';
import { Checkbox } from '../shared/ui/forms/checkbox/checkbox';
import { Field } from '../shared/ui/forms/field/field';
import { Form } from '../shared/ui/forms/form/form';
import { Label } from '../shared/ui/forms/label/label';

@Component({
  selector: 'app-notification-preferences',
  imports: [Button, Checkbox, Field, Form, Label],
  templateUrl: './notification-preferences.html',
  styleUrl: './notification-preferences.css',
})
export class NotificationPreferences {
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);

  readonly servicePush = input.required<boolean>();
  readonly pushAvailable = input(false);

  protected readonly model = linkedSignal(() => ({ servicePush: this.servicePush() }));
  protected readonly saved = signal(false);
  protected readonly error = signal(false);

  protected readonly preferences: FieldTree<{ servicePush: boolean }> = form(this.model, (path) => {
    disabled(path.servicePush, { when: () => this.preferences().submitting() });
  });

  protected clearFeedback(): void {
    this.saved.set(false);
    this.error.set(false);
  }

  protected async save(): Promise<void> {
    if (this.preferences().submitting()) return;
    await submit(this.preferences, async () => {
      this.saved.set(false);
      this.error.set(false);
      try {
        await firstValueFrom(
          this.http
            .post<void>('/api/notifications/preferences', this.model())
            .pipe(takeUntilDestroyed(this.destroyRef)),
        );
        if (!this.destroyRef.destroyed) this.saved.set(true);
      } catch {
        if (!this.destroyRef.destroyed) this.error.set(true);
      }
    });
  }
}
