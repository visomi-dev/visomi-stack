import { Service } from '@angular/core';
import type { ZxcvbnFactory } from '@zxcvbn-ts/core';

@Service()
export class Deps {
  private passwordEstimator: Promise<ZxcvbnFactory> | undefined;

  operationContracts(): Promise<typeof import('./realtime/operation-contract')> {
    return import('./realtime/operation-contract');
  }

  vaultUnlock(): Promise<
    Pick<
      typeof import('shared-crypto'),
      | 'VaultKeySession'
      | 'decodeRecoveryBytes'
      | 'openVaultKey'
      | 'openBrowserVaultKey'
      | 'vaultPinProfile'
      | 'verifyVaultPinProfileKey'
    >
  > {
    return import('shared-crypto').then(
      ({
        VaultKeySession,
        decodeRecoveryBytes,
        openVaultKey,
        openBrowserVaultKey,
        vaultPinProfile,
        verifyVaultPinProfileKey,
      }) => ({
        VaultKeySession,
        decodeRecoveryBytes,
        openVaultKey,
        openBrowserVaultKey,
        vaultPinProfile,
        verifyVaultPinProfileKey,
      }),
    );
  }

  async approvalQr(text: string): Promise<string> {
    const { default: encoder } = await import('qrcode');

    return encoder.toDataURL(text, { width: 256, margin: 4, errorCorrectionLevel: 'M' });
  }

  loadPasswordEstimator(): Promise<ZxcvbnFactory> {
    this.passwordEstimator ??= Promise.all([
      import('@zxcvbn-ts/core'),
      import('@zxcvbn-ts/language-common'),
      import('@zxcvbn-ts/language-en'),
    ])
      .then(
        ([core, common, english]) =>
          new core.ZxcvbnFactory({
            dictionary: { ...common.dictionary, ...english.dictionary },
            graphs: common.adjacencyGraphs,
            translations: english.translations,
            maxLength: 128,
          }),
      )
      .catch((error: unknown) => {
        this.passwordEstimator = undefined;
        throw error;
      });

    return this.passwordEstimator;
  }
}
