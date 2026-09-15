import { Service } from '@angular/core';
import type { ZxcvbnFactory } from '@zxcvbn-ts/core';

@Service()
export class Deps {
  private passwordEstimator: Promise<ZxcvbnFactory> | undefined;

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
