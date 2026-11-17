import { TestBed } from '@angular/core/testing';

import { VaultUnlock } from './vault-unlock';

function mount(id: string) {
  const view = TestBed.createComponent(VaultUnlock);

  view.componentRef.setInput('control-id', id);
  view.componentRef.setInput('method', 'pin-argon2id');
  view.detectChanges();

  return view;
}

afterEach(() => TestBed.resetTestingModule());

it('presents native PIN controls and emits an explicit unlock without session, Router or database providers', () => {
  const view = mount('local-vault');
  const form = view.nativeElement.querySelector('form') as HTMLFormElement;
  const input = view.nativeElement.querySelector('input') as HTMLInputElement;
  const requested = vi.fn();

  view.componentInstance.unlock.subscribe(requested);
  input.value = '012345';
  input.dispatchEvent(new Event('input'));
  expect(view.componentInstance.pin()).toBe('012345');
  expect(input.type).toBe('password');
  expect(input.inputMode).toBe('numeric');
  expect(input.autocomplete).toBe('off');
  expect(input.id).toBe('local-vault-pin');
  expect(view.nativeElement.querySelector('label').htmlFor).toBe(input.id);
  const event = new Event('submit', { cancelable: true });

  form.dispatchEvent(event);

  expect(event.defaultPrevented).toBe(true);
  expect(requested).toHaveBeenCalledExactlyOnceWith(undefined);
});

it('isolates caller-supplied IDs and clears drafts on context changes while blocking duplicate busy submissions', () => {
  const first = mount('first-vault');
  const second = mount('second-vault');
  const requested = vi.fn();

  first.componentInstance.unlock.subscribe(requested);
  first.componentInstance.pin.set('012345');
  second.componentInstance.pin.set('654321');
  first.componentRef.setInput('busy', true);
  first.detectChanges();
  first.nativeElement.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
  expect(requested).not.toHaveBeenCalled();
  expect(first.nativeElement.querySelector('input').disabled).toBe(true);
  expect(first.nativeElement.querySelector('button').disabled).toBe(true);
  expect(first.nativeElement.querySelector('input').id).not.toBe(second.nativeElement.querySelector('input').id);
  first.componentRef.setInput('control-id', 'another-context');
  first.detectChanges();
  expect(first.componentInstance.pin()).toBe('');
  expect(second.componentInstance.pin()).toBe('654321');
  first.componentInstance.pin.set('012345');
  first.componentRef.setInput('method', 'passkey-prf');
  first.detectChanges();
  expect(first.componentInstance.pin()).toBe('');
  expect(first.nativeElement.querySelector('input')).toBeNull();
  expect(first.nativeElement.querySelector('button').textContent).toContain('Unlock with passkey');
  first.componentRef.setInput('method', undefined);
  first.detectChanges();
  expect(first.nativeElement.querySelector('form')).toBeNull();
});
