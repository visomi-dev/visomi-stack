import { DOCUMENT, Location } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { LOCALE_ID, Service, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { createOperationId, exampleWorkspacePageSchema, exampleWorkspaceTargetSchema } from '@visomi-stack/shared-db';
import { z } from 'zod';

import { BrowserRealtimeSession } from '../../auth/session/browser-realtime-session';
import { DatabaseHttp } from '../../shared/db/http';
import { ExampleAvailability } from '../example-availability';
import type { ExampleWorkspacePage } from '../example-contracts';

const noteSchema = z.strictObject({
  id: z.uuid(),
  title: z.string(),
  body: z.string(),
  audience: z.enum(['owner', 'scope']),
  revision: z.number().int().positive(),
});
const pageSchema = z.strictObject({ items: z.array(noteSchema), next: z.null(), canWrite: z.boolean() });
const sharingSchema = z.strictObject({
  linkExpiresAt: z.iso.datetime().nullable(),
  readers: z.array(z.strictObject({ id: z.uuid(), email: z.email() })),
});
const linkSchema = z.strictObject({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/), expiresAt: z.iso.datetime() });
const deliverySchema = z.strictObject({ sent: z.boolean() });

type Workspace = z.infer<typeof exampleWorkspaceTargetSchema>;
type Note = z.infer<typeof noteSchema>;

const prefix = '/tenants';
const scopePath = ({ tenantId, scopeId }: Workspace) => `${prefix}/${tenantId}/scopes/${scopeId}`;
const notesPath = (target: Workspace) => `${scopePath(target)}/domains/cloud-notes/records`;
const sharingPath = (target: Workspace) => `${scopePath(target)}/sharing`;

@Service({ autoProvided: false })
export class CloudWorkspace {
  private readonly api = inject(DatabaseHttp);
  private readonly document = inject(DOCUMENT);
  private readonly location = inject(Location);
  private readonly locale = inject(LOCALE_ID);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly realtime = inject(BrowserRealtimeSession, { optional: true });

  private readonly params = toSignal(this.route.paramMap, { initialValue: this.route.snapshot.paramMap });
  private readonly readError = signal('');
  private readonly actionError = signal('');

  private readonly page = signal<z.infer<typeof pageSchema> | null>(null);

  private controller?: AbortController;
  private refreshRequest?: AbortController;
  private refreshPending = false;
  private lastCloudChange = this.realtime?.cloudChanges() ?? 0;

  readonly examples = inject(ExampleAvailability);

  readonly busy = signal(false);
  readonly workspaces = signal<ExampleWorkspacePage | null>(null);
  readonly status = signal('');
  readonly selected = signal<Note | null>(null);
  readonly title = signal('');
  readonly body = signal('');
  readonly audience = signal<Note['audience']>('owner');
  readonly shareMode = signal<'link' | 'email' | null>(null);
  readonly shareLink = signal('');
  readonly shareEmail = signal('');

  readonly target = computed(() => {
    const params = this.params();
    const parsed = exampleWorkspaceTargetSchema.safeParse({
      tenantId: params.get('tenantId'),
      scopeId: params.get('scopeId'),
    });

    return parsed.success ? parsed.data : undefined;
  });
  readonly hasTarget = computed(() => this.params().has('tenantId'));
  readonly notes = computed(() => this.page()?.items ?? []);
  readonly canWrite = computed(() => this.page()?.canWrite === true);
  readonly loaded = computed(() => this.page() !== null);
  readonly error = computed(() => this.readError() || this.actionError());

  readonly sharing = signal<z.infer<typeof sharingSchema> | null>(null);

  retryWorkspaces(): void {
    this.readError.set('');
    this.refreshPending = true;
    this.flushRefresh();
  }

  async loadMoreWorkspaces(after: string): Promise<void> {
    await this.run((signal) => this.loadWorkspaces(signal, after));
  }

  async createWorkspace(): Promise<void> {
    await this.run(async (signal) => {
      const rawRoot = await this.api.cloud(prefix, {}, signal);
      const root = exampleWorkspaceTargetSchema.parse(rawRoot);
      const rawWorkspace = await this.api.cloud(`${scopePath(root)}/children`, { kind: 'resource' }, signal);
      const workspace = exampleWorkspaceTargetSchema.parse(rawWorkspace);

      signal.throwIfAborted();

      await this.router.navigate(['/db-example/cloud', workspace.tenantId, workspace.scopeId]);
    });
  }

  edit(note: Note | null): void {
    this.selected.set(note);
    this.title.set(note?.title ?? '');
    this.body.set(note?.body ?? '');
    this.audience.set(note?.audience ?? 'owner');
  }

  async save(): Promise<void> {
    const target = this.target();

    if (!target || !this.canWrite()) {
      return;
    }

    await this.run(async (signal) => {
      const current = this.selected();
      const payload = {
        operationId: createOperationId(this.document.defaultView!.crypto),
        title: this.title(),
        body: this.body(),
        audience: this.audience(),
      };

      await this.api.cloud(
        notesPath(target),
        current
          ? { ...payload, kind: 'update', id: current.id, expectedRevision: current.revision }
          : { ...payload, kind: 'create' },
        signal,
      );

      await this.load(target, signal);

      this.edit(null);
      this.status.set($localize`:@@cloudExampleSaved:Note saved.`);
    });
  }

  async remove(note: Note): Promise<void> {
    const target = this.target();

    if (!target || !this.canWrite()) {
      return;
    }

    await this.run(async (signal) => {
      await this.api.cloud(
        notesPath(target),
        {
          kind: 'delete',
          id: note.id,
          expectedRevision: note.revision,
          operationId: createOperationId(this.document.defaultView!.crypto),
        },
        signal,
      );

      await this.load(target, signal);

      if (this.selected()?.id === note.id) {
        this.edit(null);
      }

      this.status.set($localize`:@@cloudExampleDeleted:Note deleted.`);
    });
  }

  async openSharing(mode: 'link' | 'email'): Promise<void> {
    const target = this.target();

    if (!target || !this.canWrite()) {
      return;
    }

    this.shareMode.set(mode);

    await this.run((signal) => this.loadSharing(target, signal), true);
  }

  async createLink(): Promise<void> {
    const target = this.target();

    if (!target || !this.canWrite()) {
      return;
    }

    await this.run(async (signal) => {
      const raw = await this.api.cloud(`${sharingPath(target)}/link`, {}, signal);
      const link = linkSchema.parse(raw);
      const url = new URL(this.location.prepareExternalUrl('/db-example/cloud/join'), this.document.location.origin);

      url.hash = link.token;
      this.shareLink.set(url.href);

      await this.loadSharing(target, signal);
    });
  }

  async copyLink(input: HTMLInputElement): Promise<void> {
    try {
      await this.document.defaultView!.navigator.clipboard.writeText(input.value);

      this.status.set($localize`:@@cloudLinkCopied:Link copied.`);
    } catch {
      input.focus();
      input.select();
      this.status.set($localize`:@@cloudLinkCopyManually:Copy the selected link.`);
    }
  }

  async disableLink(): Promise<void> {
    const target = this.target();

    if (!target || !this.canWrite()) {
      return;
    }

    await this.run(async (signal) => {
      await this.api.cloud(`${sharingPath(target)}/link`, undefined, signal, 'DELETE');

      this.shareLink.set('');

      await this.loadSharing(target, signal);

      this.status.set($localize`:@@cloudLinkDisabled:Link disabled.`);
    });
  }

  async sendEmail(): Promise<void> {
    const target = this.target();

    if (!target || !this.canWrite()) {
      return;
    }

    await this.run(async (signal) => {
      const raw = await this.api.cloud(
        `${sharingPath(target)}/email`,
        { email: this.shareEmail().trim(), locale: this.locale.startsWith('es') ? 'es' : 'en' },
        signal,
      );
      const { sent } = deliverySchema.parse(raw);

      await this.loadSharing(target, signal);

      if (sent) {
        this.shareEmail.set('');
        this.status.set($localize`:@@cloudShareSent:Email sent.`);
      } else {
        this.actionError.set(
          $localize`:@@cloudShareNotSent:Access was granted, but the email couldn’t be sent. Try sending it again.`,
        );
      }
    });
  }

  async removeReader(userId: string): Promise<void> {
    const target = this.target();

    if (!target || !this.canWrite()) {
      return;
    }

    await this.run(async (signal) => {
      await this.api.cloud(`${sharingPath(target)}/readers/${userId}`, undefined, signal, 'DELETE');

      await this.loadSharing(target, signal);

      this.status.set($localize`:@@cloudExampleRevoked:Access removed.`);
    });
  }

  private async loadSharing(target: Workspace, signal: AbortSignal): Promise<void> {
    const raw = await this.api.cloud(sharingPath(target), undefined, signal);
    const sharing = sharingSchema.parse(raw);

    signal.throwIfAborted();
    this.sharing.set(sharing);
  }

  private flushRefresh(): void {
    const target = this.target();
    const scope = this.controller;

    if (
      !this.refreshPending ||
      this.busy() ||
      this.refreshRequest ||
      (this.hasTarget() && !target) ||
      !this.examples.enabled() ||
      !scope
    ) {
      return;
    }

    const request = new AbortController();
    const signal = AbortSignal.any([scope.signal, request.signal]);

    this.refreshPending = false;
    this.refreshRequest = request;
    void (target ? this.load(target, signal) : this.loadWorkspaces(signal))
      .catch((error: unknown) => {
        if (!signal.aborted) {
          if (!target) {
            this.workspaces.set(null);
          }

          this.readError.set(this.message(error));
        }
      })
      .finally(() => {
        if (this.refreshRequest === request) {
          this.refreshRequest = undefined;
          this.flushRefresh();
        }
      });
  }

  private async load(target: Workspace, signal: AbortSignal): Promise<void> {
    const raw = await this.api.cloud(`${notesPath(target)}?limit=20`, undefined, signal);
    const page = pageSchema.parse(raw);

    signal.throwIfAborted();
    this.page.set(page);
    this.readError.set('');
  }

  private async loadWorkspaces(signal: AbortSignal, after?: string): Promise<void> {
    const current = this.workspaces();
    // Keep the visible UUID range even if sharing changes move its page boundaries.
    const lastVisible = after ? undefined : current?.items.at(-1)?.scopeId;
    const items = after ? [...(current?.items ?? [])] : [];
    let cursor = after;

    do {
      const raw = await this.api.cloud(cursor ? `/workspaces?after=${cursor}` : '/workspaces', undefined, signal);
      const page = exampleWorkspacePageSchema.parse(raw);

      signal.throwIfAborted();
      items.push(...page.items);
      cursor = page.next ?? undefined;
    } while (cursor && lastVisible && cursor < lastVisible);

    this.workspaces.set({ items, next: cursor ?? null });
    this.readError.set('');
  }

  private async run(work: (signal: AbortSignal) => Promise<void>, background = false): Promise<void> {
    const signal = this.controller?.signal;

    if (!this.examples.enabled() || !signal || signal.aborted || this.busy()) {
      return;
    }

    this.busy.set(true);

    if (this.refreshRequest) {
      this.refreshRequest.abort();
      this.refreshRequest = undefined;
      this.refreshPending = true;
    }

    if (!background) {
      this.status.set('');
    }

    this.actionError.set('');

    try {
      await work(signal);
    } catch (error) {
      if (!signal.aborted) {
        this.actionError.set(this.message(error));
      }
    } finally {
      if (!signal.aborted) {
        this.busy.set(false);

        this.flushRefresh();
      }
    }
  }

  private message(error: unknown): string {
    const status = error instanceof HttpErrorResponse ? error.status : undefined;
    const code = error instanceof HttpErrorResponse ? error.error?.error : undefined;
    const denied = status === 403;

    if (denied || status === 401) {
      this.page.set(null);
      this.workspaces.set(null);
      this.edit(null);
    }

    switch (code) {
      case 'cloud_recipient_unavailable':
        return $localize`:@@cloudShareRecipient:Use the email address of another verified Stack account.`;
      case 'cloud_mail_unavailable':
        return $localize`:@@cloudShareMailUnavailable:Email is unavailable right now. You can share a link.`;
      default:
        return denied
          ? $localize`:@@cloudExampleDenied:This account doesn’t have access to the test workspace.`
          : status === 503
            ? $localize`:@@cloudExampleStorageUnavailable:Cloud storage is unavailable right now. Try again later.`
            : $localize`:@@cloudExampleError:We couldn’t complete that action. Try again.`;
    }
  }

  private readonly loadWorkspace = effect((cleanup) => {
    const enabled = this.examples.enabled();
    const target = this.target();
    const hasTarget = this.hasTarget();

    untracked(() => {
      const controller = new AbortController();

      this.controller = controller;
      cleanup(() => controller.abort());
      this.refreshRequest = undefined;
      this.refreshPending = false;
      this.busy.set(false);
      this.page.set(null);
      this.workspaces.set(null);
      this.edit(null);
      this.status.set('');
      this.readError.set('');
      this.actionError.set('');
      this.shareMode.set(null);
      this.sharing.set(null);
      this.shareLink.set('');
      this.shareEmail.set('');

      if (enabled && (!hasTarget || target)) {
        this.refreshPending = true;
        this.flushRefresh();
      }
    });
  });

  private readonly refreshOnCloudChange = effect(() => {
    const revision = this.realtime?.cloudChanges() ?? 0;

    if (revision !== this.lastCloudChange) {
      this.lastCloudChange = revision;
      untracked(() => {
        this.refreshPending = true;
        this.flushRefresh();
      });
    }
  });
}
