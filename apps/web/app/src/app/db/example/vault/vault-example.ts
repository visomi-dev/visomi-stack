import { Component, effect, inject, untracked } from '@angular/core';
import { ActivatedRoute, RouterOutlet } from '@angular/router';

import { ExampleWorkspace } from '../../example-workspace';
import { exampleWorkspaceProviders } from '../../example-workspace-providers';

import { VaultExampleNavigation } from './vault-example-navigation';

@Component({
  selector: 'app-vault-example',
  imports: [RouterOutlet],
  providers: exampleWorkspaceProviders,
  templateUrl: './vault-example.html',
})
export class VaultExample {
  private readonly route = inject(ActivatedRoute);
  private readonly navigation = inject(VaultExampleNavigation);
  private readonly workspace = inject(ExampleWorkspace);

  private readonly showWorkspaceOrUnlock = effect(() => {
    if (!this.workspace.available() || this.workspace.busy() || !this.workspace.bindingLoaded()) {
      return;
    }

    const locked = this.workspace.enrolled() && this.workspace.hasBinding() && !this.workspace.vaultReady();
    const onUnlockPage = this.route.firstChild?.snapshot.data['vaultUnlock'] === true;

    const target = this.workspace.target();

    if (target && locked !== onUnlockPage) {
      untracked(() => void this.navigation.switchView(locked, target));
    }
  });
}
