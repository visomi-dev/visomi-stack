import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { DatabaseHttp } from '../../../shared/db/http';
import { ExampleAvailability } from '../../example-availability';

import { CloudExample } from './cloud-example';

it('resets native note validation after a successful save and retains the draft on failure', async () => {
  const params = convertToParamMap({
    tenantId: '11111111-1111-4111-8111-111111111111',
    scopeId: '22222222-2222-4222-8222-222222222222',
  });
  const notes = { items: [], next: null, canWrite: true };
  const cloud = vi
    .fn()
    .mockResolvedValueOnce(notes)
    .mockRejectedValueOnce(new Error('Synthetic save failure'))
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(notes);

  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: params }, paramMap: of(params) } },
      { provide: DatabaseHttp, useValue: { cloud } },
      { provide: ExampleAvailability, useValue: { checked: signal(true), enabled: signal(true) } },
    ],
  });
  const fixture = TestBed.createComponent(CloudExample);

  await fixture.whenStable();

  const host = fixture.nativeElement as HTMLElement;
  const title = host.querySelector<HTMLInputElement>('#cloud-note-title')!;
  const form = title.form!;
  const invalid = vi.fn();
  const reset = vi.fn();

  title.addEventListener('invalid', invalid);
  form.addEventListener('reset', reset);
  form.requestSubmit();

  expect(invalid).toHaveBeenCalledOnce();
  expect(cloud).toHaveBeenCalledTimes(1);

  title.value = 'Synthetic note';
  title.dispatchEvent(new Event('input'));
  form.requestSubmit();

  await fixture.whenStable();

  expect(cloud).toHaveBeenCalledTimes(2);
  expect(reset).not.toHaveBeenCalled();
  expect(title.value).toBe('Synthetic note');

  form.requestSubmit();

  await fixture.whenStable();

  expect(reset).toHaveBeenCalledOnce();
  expect(title.value).toBe('');
  expect(new FormData(form).get('cloud-audience')).toBe('owner');
  form.requestSubmit();

  expect(invalid).toHaveBeenCalledTimes(2);
  expect(cloud).toHaveBeenCalledTimes(4);
});
