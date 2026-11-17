import { DOCUMENT } from '@angular/common';
import { Service, afterNextRender, inject, signal } from '@angular/core';

/** Client support is advisory; only a successful PRF ceremony proves authenticator support. */
@Service()
export class UnlockCapabilities {
  private readonly document = inject(DOCUMENT);

  private readonly support = signal<'checking' | 'available' | 'unknown' | 'unavailable'>('checking');

  readonly prf = this.support.asReadonly();

  unavailable(): void {
    this.support.set('unavailable');
  }

  private readonly initialize = afterNextRender(async () => {
    const view = this.document.defaultView;
    const credential = view?.PublicKeyCredential;

    if (!view?.navigator.credentials?.create || !view.navigator.credentials.get || !credential) {
      this.unavailable();

      return;
    }

    try {
      const capabilities = await credential.getClientCapabilities?.();

      this.support.set(
        capabilities ? (capabilities['extension:prf'] === true ? 'available' : 'unavailable') : 'unknown',
      );
    } catch {
      // A failed capability probe is not proof that a credential cannot perform PRF.
      this.support.set('unknown');
    }
  });
}
