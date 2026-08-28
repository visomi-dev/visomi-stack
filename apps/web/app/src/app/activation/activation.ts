import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal, OnInit } from '@angular/core';
import { form, maxLength, required, type FieldTree, FormField } from '@angular/forms/signals';
import { Router } from '@angular/router';

import { Activation as ActivationService } from '../shared/activation/activation';
import type {
  ActivationApiKey,
  ActivationMilestone,
  ActivationState,
  CreatedApiKey,
} from '../shared/activation/activation.models';
import { Clipboard } from '../shared/clipboard/clipboard';
import { DASHBOARD_URL } from '../shared/constants/routes';
import { Alert } from '../shared/ui/overlays/alert/alert';
import { Badge } from '../shared/ui/data/badge/badge';
import { Button } from '../shared/ui/actions/button/button';
import { Card } from '../shared/ui/layout/card/card';
import { Container } from '../shared/ui/layout/container/container';
import { ErrorMessage } from '../shared/ui/forms/error-message/error-message';
import { Field } from '../shared/ui/forms/field/field';
import { Form as AppForm } from '../shared/ui/forms/form/form';
import { Heading } from '../shared/ui/typography/heading/heading';
import { Input } from '../shared/ui/forms/input/input';
import { Label } from '../shared/ui/forms/label/label';
import { Loader } from '../shared/ui/feedback/loader/loader';

type ApiKeyModel = {
  label: string;
};

type ConfigTab = 'env' | 'opencode' | 'themis';

@Component({
  host: {
    class: /* tw */ 'block min-h-full w-full',
  },
  imports: [
    Alert,
    AppForm,
    Badge,
    Button,
    Card,
    Container,
    ErrorMessage,
    Field,
    FormField,
    Heading,
    Input,
    Label,
    Loader,
  ],
  selector: 'app-activation',
  templateUrl: './activation.html',
  styleUrl: './activation.css',
})
export class Activation implements OnInit {
  private readonly activation = inject(ActivationService);
  private readonly clipboard = inject(Clipboard);
  private readonly router = inject(Router);

  readonly apiKeyModel = signal<ApiKeyModel>({ label: 'Primary workspace key' });

  readonly apiKeyForm: FieldTree<ApiKeyModel> = form(
    this.apiKeyModel,
    (p) => {
      required(p.label, { message: 'Enter a label for the API key.' });
      maxLength(p.label, 80, { message: 'Use 80 characters or fewer.' });
    },
    {
      submission: {
        action: async (field) => {
          await this.createApiKey(field);
        },
      },
    },
  );

  readonly activationData = signal<ActivationState | null>(null);
  readonly continuing = signal(false);
  readonly copyMessage = signal('');
  readonly creatingKey = signal(false);
  readonly errorMessage = signal('');
  readonly generatedKey = signal<CreatedApiKey | null>(null);
  readonly loading = signal(true);
  readonly revokingKeyId = signal('');
  readonly selectedConfigTab = signal<ConfigTab>('themis');
  readonly labelManualError = signal<string | null>(null);

  readonly labelError = computed(() => this.apiKeyForm.label().errors()[0]?.message ?? this.labelManualError() ?? '');

  async ngOnInit() {
    await this.loadActivationState();
  }

  private async createApiKey(field: FieldTree<ApiKeyModel>): Promise<void> {
    if (this.creatingKey()) {
      return;
    }

    this.creatingKey.set(true);
    this.errorMessage.set('');
    this.labelManualError.set(null);

    try {
      const createdKey = await this.activation.createApiKey(field().value());

      this.generatedKey.set(createdKey);
      await this.loadActivationState();
    } catch (error) {
      this.errorMessage.set(
        error instanceof HttpErrorResponse
          ? (error.error?.message ?? 'The API key could not be created.')
          : 'The API key could not be created.',
      );
      this.labelManualError.set('The API key could not be created.');
    } finally {
      this.creatingKey.set(false);
    }
  }

  async copyGeneratedKey() {
    const createdKey = this.generatedKey();

    if (!createdKey) {
      return;
    }

    await this.copyText(createdKey.plaintextToken, 'API key copied to your clipboard.');
  }

  async copySeedPrompt() {
    const activationData = this.activationData();

    if (!activationData) {
      return;
    }

    const copied = await this.copyText(activationData.seedPrompt, 'Seed prompt copied to your clipboard.');

    if (copied) {
      await this.recordMilestone('seed_prompt_copied');
    }
  }

  async copySelectedConfig() {
    const copied = await this.copyText(this.currentConfigText(), 'Configuration copied to your clipboard.');

    if (copied) {
      await this.recordMilestone('config_copied');
    }
  }

  async continueToWorkspace() {
    this.continuing.set(true);

    try {
      await this.recordMilestone('activation_completed');
      await this.router.navigate([DASHBOARD_URL]);
    } finally {
      this.continuing.set(false);
    }
  }

  async skipForNow() {
    this.continuing.set(true);

    try {
      await this.recordMilestone('activation_skipped');
      await this.router.navigate([DASHBOARD_URL]);
    } finally {
      this.continuing.set(false);
    }
  }

  async revokeApiKey(apiKeyId: string) {
    this.revokingKeyId.set(apiKeyId);
    this.errorMessage.set('');

    try {
      await this.activation.revokeApiKey(apiKeyId);

      if (this.generatedKey()?.id === apiKeyId) {
        this.generatedKey.set(null);
      }

      await this.loadActivationState();
    } catch (error) {
      this.errorMessage.set(
        error instanceof HttpErrorResponse
          ? (error.error?.message ?? 'The API key could not be revoked.')
          : 'The API key could not be revoked.',
      );
    } finally {
      this.revokingKeyId.set('');
    }
  }

  selectConfigTab(tab: ConfigTab) {
    this.selectedConfigTab.set(tab);
  }

  currentConfigPath() {
    switch (this.selectedConfigTab()) {
      case 'env':
        return '.env.production';
      case 'opencode':
        return '~/.config/opencode/opencode.json';
      default:
        return '~/.config/themis/core.json';
    }
  }

  currentConfigText() {
    const apiKeyValue = this.generatedKey()?.plaintextToken ?? '<paste-your-generated-key>';

    switch (this.selectedConfigTab()) {
      case 'env':
        return `THEMIS_API_KEY=${apiKeyValue}`;
      case 'opencode':
        return JSON.stringify(
          {
            integrations: {
              themis: {
                apiKeyEnv: 'THEMIS_API_KEY',
                seedPromptSource: 'themis-core-activation',
              },
            },
          },
          null,
          2,
        );
      default:
        return JSON.stringify(
          {
            workspace: 'themis',
            apiKeyEnv: 'THEMIS_API_KEY',
            promptPreset: 'themis-core-activation',
          },
          null,
          2,
        );
    }
  }

  keyCreatedAtLabel(apiKey: ActivationApiKey) {
    return new Date(apiKey.createdAt).toLocaleDateString();
  }

  plaintextTokenFor(apiKey: ActivationApiKey) {
    const generatedKey = this.generatedKey();

    return generatedKey?.id === apiKey.id ? generatedKey.plaintextToken : '';
  }

  hasMilestone(milestone: ActivationMilestone) {
    return this.activationData()?.milestones.includes(milestone) ?? false;
  }

  private async loadActivationState() {
    this.loading.set(true);
    this.errorMessage.set('');

    try {
      this.activationData.set(await this.activation.loadState());
    } catch (error) {
      this.errorMessage.set(
        error instanceof HttpErrorResponse
          ? (error.error?.message ?? 'Activation settings could not be loaded.')
          : 'Activation settings could not be loaded.',
      );
    } finally {
      this.loading.set(false);
    }
  }

  private async copyText(value: string, message: string) {
    const copied = await this.clipboard.writeText(value);

    if (!copied) {
      this.copyMessage.set('Clipboard access is not available in this browser.');

      return false;
    }

    this.copyMessage.set(message);

    return true;
  }

  private async recordMilestone(milestone: ActivationMilestone) {
    try {
      await this.activation.recordMilestone(milestone);
      await this.loadActivationState();
    } catch {
      // Milestone tracking should not block the primary action.
    }
  }
}
