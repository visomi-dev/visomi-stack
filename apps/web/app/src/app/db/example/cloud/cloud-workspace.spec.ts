import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { BrowserRealtimeSession } from '../../../auth/session/browser-realtime-session';
import { DatabaseHttp } from '../../../shared/db/http';
import { ExampleAvailability } from '../../example-availability';
import type { ExampleWorkspacePage } from '../../example-contracts';

import { CloudWorkspace } from './cloud-workspace';

const workspace = (position: number) => ({
  tenantId: '11111111-1111-4111-8111-111111111111',
  scopeId: `22222222-2222-4222-8222-${String(position).padStart(12, '0')}`,
  createdAt: '2026-01-01T00:00:00.000Z',
  owner: false,
});

function deferredPage() {
  let resolve!: (page: ExampleWorkspacePage) => void;
  const promise = new Promise<ExampleWorkspacePage>((done) => {
    resolve = done;
  });

  return { promise, resolve };
}

afterEach(() => TestBed.resetTestingModule());

it('refreshes the visible UUID range after pagination, removing revoked workspaces without dropping later pages', async () => {
  const [addedFirst, first, addedSecond, revoked, third, addedThird, last] = [5, 10, 15, 20, 30, 35, 40].map(workspace);
  const pagination = deferredPage();
  const lastRefreshPage = deferredPage();
  const cloudChanges = signal(0);
  const params = convertToParamMap({});
  const cloud = vi
    .fn<(path: string, body: undefined, signal: AbortSignal) => Promise<ExampleWorkspacePage>>()
    .mockResolvedValueOnce({ items: [first, revoked], next: revoked.scopeId })
    .mockReturnValueOnce(pagination.promise)
    .mockResolvedValueOnce({ items: [addedFirst, first], next: first.scopeId })
    .mockResolvedValueOnce({ items: [addedSecond, third], next: third.scopeId })
    .mockReturnValueOnce(lastRefreshPage.promise);

  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      CloudWorkspace,
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: params }, paramMap: of(params) } },
      { provide: DatabaseHttp, useValue: { cloud } },
      { provide: ExampleAvailability, useValue: { enabled: signal(true) } },
      { provide: BrowserRealtimeSession, useValue: { cloudChanges } },
    ],
  });
  const directory = TestBed.inject(CloudWorkspace);

  TestBed.tick();

  await vi.waitFor(() => expect(directory.workspaces()?.items).toEqual([first, revoked]));

  const loading = directory.loadMoreWorkspaces(revoked.scopeId);

  cloudChanges.set(1);
  TestBed.tick();
  expect(cloud).toHaveBeenCalledTimes(2);
  pagination.resolve({ items: [third, last], next: last.scopeId });

  await loading;

  await vi.waitFor(() => expect(cloud).toHaveBeenCalledTimes(5));

  expect(cloud.mock.calls.map(([path]) => path)).toEqual([
    '/workspaces',
    `/workspaces?after=${revoked.scopeId}`,
    '/workspaces',
    `/workspaces?after=${first.scopeId}`,
    `/workspaces?after=${third.scopeId}`,
  ]);

  expect(directory.workspaces()?.items).toEqual([first, revoked, third, last]);

  lastRefreshPage.resolve({ items: [addedThird, last], next: last.scopeId });

  await vi.waitFor(() =>
    expect(directory.workspaces()).toEqual({
      items: [addedFirst, first, addedSecond, third, addedThird, last],
      next: last.scopeId,
    }),
  );

  expect(cloud).toHaveBeenCalledTimes(5);
});
