import { Service, inject } from '@angular/core';
import { Router, type UrlTree } from '@angular/router';

import type { ExampleTarget } from '../../db/example-contracts';

@Service({ autoProvided: false })
export class VaultExampleNavigation {
  private readonly router = inject(Router);

  private destination: { tree: UrlTree; target: ExampleTarget } | undefined;
  private viewNavigationId: number | undefined;

  async switchView(locked: boolean, target: ExampleTarget): Promise<void> {
    const path = locked ? '/vault/unlock' : '/db-example/vault';
    const tree = this.router.createUrlTree([path], { queryParams: target });
    const destination = { tree, target };

    this.destination = destination;

    try {
      await this.router.navigateByUrl(tree, { replaceUrl: true });
    } finally {
      if (this.destination === destination) {
        this.destination = undefined;
      }
    }
  }

  acceptView(target: ExampleTarget | null, eligible: boolean): boolean {
    const navigation = this.router.currentNavigation();
    const destination = this.destination;

    if (
      !eligible ||
      !navigation ||
      !destination ||
      destination.target !== target ||
      destination.tree.toString() !== navigation.extractedUrl.toString()
    ) {
      return false;
    }

    // A prepared navigation may reuse only the already authorized target for this navigation ID.
    this.viewNavigationId = navigation.id;

    return true;
  }

  preservesTarget(id: number): boolean {
    return id === this.viewNavigationId;
  }
}
