import { DOCUMENT } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Service, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { createOperationId } from '@visomi-stack/shared-db';
import { z } from 'zod';

import { Session } from '../../auth/session/session';
import { DatabaseHttp } from '../../shared/db/http';
import { PersistenceDemos } from '../persistence-demos';

const workspaceSchema = z.strictObject({ tenantId: z.uuid(), scopeId: z.uuid() });
const noteSchema = z.strictObject({
  id: z.uuid(),
  title: z.string(),
  body: z.string(),
  audience: z.enum(['owner', 'scope']),
  revision: z.number().int().positive(),
});
const pageSchema = z.strictObject({ items: z.array(noteSchema), next: z.null(), canWrite: z.boolean() });

type Workspace = z.infer<typeof workspaceSchema>;
type Note = z.infer<typeof noteSchema>;

const prefix = '/cloud-example/tenants';
const scopePath = ({ tenantId, scopeId }: Workspace) => `${prefix}/${tenantId}/scopes/${scopeId}`;
const notesPath = (target: Workspace) => `${scopePath(target)}/domains/cloud-notes/records`;

@Service({ autoProvided: false })
export class CloudWorkspace {
  private readonly api = inject(DatabaseHttp);
  private readonly document = inject(DOCUMENT);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly session = inject(Session);

  private readonly params = toSignal(this.route.paramMap, { initialValue: this.route.snapshot.paramMap });

  private readonly page = signal<z.infer<typeof pageSchema> | null>(null);

  private controller?: AbortController;

  readonly demos = inject(PersistenceDemos);

  readonly busy = signal(false);
  readonly status = signal('');
  readonly error = signal('');
  readonly selected = signal<Note | null>(null);
  readonly title = signal('');
  readonly body = signal('');
  readonly audience = signal<Note['audience']>('owner');

  readonly memberId = computed(() => this.session.user()?.id);
  readonly target = computed(() => {
    const params = this.params();
    const parsed = workspaceSchema.safeParse({ tenantId: params.get('tenantId'), scopeId: params.get('scopeId') });

    return parsed.success ? parsed.data : undefined;
  });
  readonly hasTarget = computed(() => this.params().has('tenantId'));
  readonly notes = computed(() => this.page()?.items ?? []);
  readonly canWrite = computed(() => this.page()?.canWrite === true);
  readonly loaded = computed(() => this.page() !== null);

  async createWorkspace(): Promise<void> {
    await this.run(async (signal) => {
      const rawRoot = await this.api.request(prefix, {}, signal);
      const root = workspaceSchema.parse(rawRoot);
      const rawWorkspace = await this.api.request(`${scopePath(root)}/children`, { kind: 'resource' }, signal);
      const workspace = workspaceSchema.parse(rawWorkspace);

      signal.throwIfAborted();

      await this.router.navigate(['/cloud-example', workspace.tenantId, workspace.scopeId]);
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

      await this.api.request(
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
      await this.api.request(
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

  async setAccess(raw: string, active: boolean): Promise<void> {
    const target = this.target();
    const user = z.uuid().safeParse(raw.trim());

    if (!target || !this.canWrite() || this.busy()) {
      return;
    }

    if (!user.success || user.data === this.memberId()) {
      this.error.set($localize`:@@cloudExampleMemberError:Enter the ID of another test account.`);

      return;
    }

    await this.run(async (signal) => {
      const userId = user.data;
      const root = scopePath({ tenantId: target.tenantId, scopeId: target.tenantId });

      await this.api.request(`${root}/members`, { userId, active }, signal, 'PUT');

      if (active) {
        await this.api.request(`${scopePath(target)}/grants`, { userId, role: 'viewer' }, signal, 'PUT');
      }

      this.status.set(
        active
          ? $localize`:@@cloudExampleShared:Read access granted.`
          : $localize`:@@cloudExampleRevoked:Access removed.`,
      );
    });
  }

  async refresh(): Promise<void> {
    const target = this.target();

    if (target) {
      await this.run((signal) => this.load(target, signal));
    }
  }

  private async load(target: Workspace, signal: AbortSignal): Promise<void> {
    const raw = await this.api.request(`${notesPath(target)}?limit=20`, undefined, signal);
    const page = pageSchema.parse(raw);

    signal.throwIfAborted();
    this.page.set(page);
  }

  private async run(work: (signal: AbortSignal) => Promise<void>): Promise<void> {
    const signal = this.controller?.signal;

    if (!this.demos.enabled() || !signal || signal.aborted || this.busy()) {
      return;
    }

    this.busy.set(true);
    this.status.set('');
    this.error.set('');

    try {
      await work(signal);
    } catch (error) {
      if (!signal.aborted) {
        const denied = error instanceof HttpErrorResponse && error.status === 403;

        if (denied) {
          this.page.set(null);
          this.edit(null);
        }

        this.error.set(
          denied
            ? $localize`:@@cloudExampleDenied:This account doesn’t have access to the test workspace.`
            : $localize`:@@cloudExampleError:We couldn’t complete that action. Try again.`,
        );
      }
    } finally {
      if (!signal.aborted) {
        this.busy.set(false);
      }
    }
  }

  private readonly loadWorkspace = effect((cleanup) => {
    const enabled = this.demos.enabled();
    const target = this.target();

    untracked(() => {
      const controller = new AbortController();

      this.controller = controller;
      cleanup(() => controller.abort());
      this.busy.set(false);
      this.page.set(null);
      this.edit(null);
      this.status.set('');
      this.error.set('');

      if (enabled && target) {
        void this.refresh();
      }
    });
  });
}
