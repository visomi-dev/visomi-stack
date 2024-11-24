import {
  Injectable,
  PLATFORM_ID,
  computed,
  inject,
  signal,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { lastValueFrom } from 'rxjs';
import { isPlatformBrowser } from '@angular/common';

import { ACCESS_TOKEN_KEY, REFRESH_TOKEN_KEY } from '../../config/storage';

import { User } from './user';

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  loadPromise: Promise<void> | null = null;

  private readonly http = inject(HttpClient);
  private readonly platform = inject(PLATFORM_ID);

  readonly loading = signal(false);
  readonly signing = signal(false);
  readonly user = signal<User | null>(null);
  readonly authenticated = computed(() => this.user() != null);
  readonly verified = computed(() => !!this.user()?.emailVerified);

  constructor() {
    if (isPlatformBrowser(this.platform)) {
      this.initialize().catch((error: unknown) => {
        console.error(error);
      });
    }
  }

  async load() {
    const script = document.createElement('script');

    script.src = 'https://accounts.google.com/gsi/client';

    document.body.appendChild(script);

    await new Promise<void>((resolve) => {
      script.onload = () => {
        resolve();
      };
    });
  }

  async initialize() {
    if (this.loadPromise) {
      return this.loadPromise;
    }

    this.loadPromise = this.load();

    return this.loadPromise;
  }

  async signIn(username: string, password: string) {
    try {
      this.signing.set(true);

      const { session, user } = await lastValueFrom(
        this.http.post<{
          session: {
            idToken: string;
            accessToken: string;
            refreshToken: string;
          };
          user: User;
        }>('/auth/sign-in', {
          username,
          password,
        }),
      );

      this.user.set(user);

      localStorage.setItem(ACCESS_TOKEN_KEY, session.accessToken);
      localStorage.setItem(REFRESH_TOKEN_KEY, session.refreshToken);

      return { session, user };
    } finally {
      this.signing.set(false);
    }
  }

  async getUser() {
    try {
      this.loading.set(true);

      const user = await lastValueFrom(this.http.get<User>('/auth/me'));

      this.user.set(user);

      return user;
    } finally {
      this.loading.set(false);
    }
  }
}
