import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { email, form, required, type FieldTree, FormField } from '@angular/forms/signals';
import { Router } from '@angular/router';

import { Auth } from '../../shared/auth/auth';
import { RESET_PASSWORD_URL, SIGN_IN_URL } from '../../shared/constants/routes';
import { Alert } from '../../shared/ui/overlays/alert/alert';
import { AuthCard } from '../../shared/ui/layout/auth-card/auth-card';
import { AuthLayout } from '../../shared/ui/layout/auth-layout/auth-layout';
import { Button } from '../../shared/ui/actions/button/button';
import { ErrorMessage } from '../../shared/ui/forms/error-message/error-message';
import { Field } from '../../shared/ui/forms/field/field';
import { Form as AppForm } from '../../shared/ui/forms/form/form';
import { Input } from '../../shared/ui/forms/input/input';
import { Label } from '../../shared/ui/forms/label/label';
import { Link } from '../../shared/ui/typography/link/link';

type ForgottenPasswordModel = {
  email: string;
};

@Component({
  host: {
    class: /* tw */ 'block min-h-full w-full',
  },
  imports: [Alert, AppForm, AuthCard, AuthLayout, Button, ErrorMessage, Field, FormField, Input, Label, Link],
  selector: 'app-forgotten-password',
  templateUrl: './forgotten-password.html',
  styleUrl: './forgotten-password.css',
})
export class ForgottenPassword {
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);

  readonly forgottenPasswordModel = signal<ForgottenPasswordModel>({ email: '' });

  readonly forgottenPasswordForm: FieldTree<ForgottenPasswordModel> = form(
    this.forgottenPasswordModel,
    (p) => {
      required(p.email, { message: $localize`:@@forgottenPasswordEmailErrorRequired:Enter your email address.` });
      email(p.email, {
        message: $localize`:@@forgottenPasswordEmailErrorInvalid:Enter a valid email address (e.g. you@company.com).`,
      });
    },
    {
      submission: {
        action: async (field) => {
          await this.submit(field);
        },
      },
    },
  );

  readonly submitting = signal(false);
  readonly successEmail = signal('');
  readonly errorMessage = signal('');

  readonly emailError = computed(() => this.forgottenPasswordForm.email().errors()[0]?.message ?? '');

  private async submit(field: FieldTree<ForgottenPasswordModel>): Promise<void> {
    if (this.submitting()) {
      return;
    }

    this.errorMessage.set('');
    this.submitting.set(true);

    const email = field().value().email;

    try {
      const challenge = await this.auth.requestPasswordReset(email);

      if (challenge) {
        this.successEmail.set(email);
        await this.router.navigate([RESET_PASSWORD_URL]);
      } else {
        this.successEmail.set(email);
      }
    } catch (error) {
      this.errorMessage.set(
        error instanceof HttpErrorResponse
          ? (error.error?.message ?? $localize`:@@forgottenPasswordRequestFailed:Request failed.`)
          : $localize`:@@forgottenPasswordRequestFailed:Request failed.`,
      );
    } finally {
      this.submitting.set(false);
    }
  }

  protected readonly signInUrl = SIGN_IN_URL;
}
