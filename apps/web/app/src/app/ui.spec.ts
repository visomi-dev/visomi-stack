import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { disabled, form, FormField } from '@angular/forms/signals';
import { By } from '@angular/platform-browser';

import {
  UI_IMPORTS,
  Input,
  Checkbox,
  Radio,
  Toggle,
  Text,
  Description,
  ErrorMessage,
  Link,
  LinkButton,
  Dialog,
  Field,
  Table,
} from './ui';

import type { ControlSize, Tone } from '@visomi-stack/web-frontend-ui';

@Component({
  imports: [UI_IMPORTS, ReactiveFormsModule],
  template: `
    <app-shell contentId="catalog-main" skipLabel="Skip to content">
      <app-sidebar label="Primary"><a appUI="nav-item" href="#example" aria-current="page">Home</a></app-sidebar>
      <header app-topbar><span data-slot="title">Workspace</span></header>
      <nav appUI="navbar" aria-label="Primary"><a appUI="nav-item" placement="navbar" href="#example">Home</a></nav>
      <button appUI variant="danger" size="icon" aria-label="Delete">×</button>
      <a appUI="button" href="#example">Button link</a><a appUI href="#example">Text link</a>
      <h2 appUI uiSize="xl">Heading</h2>
      <p appUI>Text</p>
      <span appUI="text">Inline</span> <code appUI block>const value = 1;</code>
      <hr appUI soft />
      <span appUI="badge" [tone]="tone()">Ready</span>
      <span appUI="avatar" role="img" aria-label="Example person">EP</span>
      <table appUI density="compact" striped [mobileCards]="cards()" [stickyHeaders]="cards()">
        <caption>
          Example
        </caption>
        <tbody>
          <tr>
            <th scope="row">Item</th>
            <td>Ready</td>
          </tr>
        </tbody>
      </table>
      <dl appUI>
        <dt>State</dt>
        <dd>Ready</dd>
      </dl>
      <nav appUI="pagination" aria-label="Pages"></nav>
      <div appUI="container" width="sm"><article appUI padding="sm">Card</article></div>
      <header appUI>Header</header>
      <fieldset appUI>
        <legend appUI>Preferences</legend>
        <app-field
          #exampleField="appField"
          controlId="email"
          label="Email"
          description="Example address"
          error="Invalid address"
          [compact]="compact()"
          [manualError]="manualError()"
        >
          <input
            appUI
            type="email"
            [id]="exampleField.controlId()"
            [size]="24"
            [uiSize]="size()"
            [formControl]="email"
            [attr.aria-describedby]="exampleField.describedBy()"
            class="example-layout"
          />
        </app-field>
        <textarea appUI uiSize="sm" aria-label="Notes" rows="3"></textarea>
        <select appUI aria-label="Region">
          <option value="am">Americas</option>
        </select>
        <label appUI inline><input appUI type="checkbox" [formControl]="checked" /> Updates</label>
        <label appUI inline><input appUI type="radio" name="kind" value="one" /> One</label>
        <label appUI inline><input appUI="switch" type="checkbox" /> Notifications</label>
        <label appUI="radio-card"><input appUI type="radio" name="kind" value="two" /> Two</label>
        <div appUI="input-group"><span data-slot="prefix">$</span><input appUI aria-label="Amount" /></div>
      </fieldset>
      <div appUI="alert" tone="success" role="status">Ready</div>
      <span role="status"><span appUI="loader" aria-hidden="true"></span>Loading</span>
      <details appUI>
        <summary>More</summary>
        <p>Details</p>
      </details>
      <dialog appUI aria-label="Review">
        <form method="dialog"><button appUI type="submit">Close</button></form>
      </dialog>
      <input appUI type="file" aria-label="File" /><input type="text" aria-label="Unstyled" />
    </app-shell>
  `,
})
class Catalog {
  readonly cards = signal(false);
  readonly compact = signal(false);
  readonly manualError = signal<string | null>(null);
  readonly size = signal<ControlSize>('sm');
  readonly tone = signal<Tone>('success');

  readonly email = new FormControl('demo@example.test', { nonNullable: true });
  readonly checked = new FormControl(false, { nonNullable: true });
}

@Component({
  imports: [Input, Checkbox, FormField],
  template: `
    <input appUI type="email" [formField]="fields.email" aria-label="Email" />
    <input appUI type="checkbox" [formField]="fields.updates" aria-label="Updates" />
  `,
})
class SignalFields {
  readonly model = signal({ email: 'demo@example.test', updates: false });
  readonly locked = signal(false);

  readonly fields = form(this.model, (path) => {
    disabled(path.email, () => this.locked());
  });
}

@Component({
  imports: [Field, Input, ReactiveFormsModule],
  template: `
    <form [formGroup]="group">
      <app-field #emailField="appField" controlId="group-email" label="Email">
        <input appUI formControlName="email" [id]="emailField.controlId()" />
      </app-field>
    </form>
  `,
})
class ProjectedGroup {
  readonly group = new FormGroup({ email: new FormControl('demo@example.test', { nonNullable: true }) });
}

describe('native Angular UI catalog', () => {
  it('owns message structure and deterministic association IDs', async () => {
    const fixture = TestBed.createComponent(Field);

    fixture.componentRef.setInput('controlId', 'customer-email');
    fixture.componentRef.setInput('label', 'Email');
    fixture.componentRef.setInput('description', 'Example address');
    fixture.componentRef.setInput('error', 'Invalid example');

    await fixture.whenStable();

    const component = fixture.componentInstance;
    const element = fixture.nativeElement as HTMLElement;
    const message = element.querySelector('[data-slot=error]') as HTMLParagraphElement;

    expect(element.hasAttribute('data-control')).toBe(true);
    expect(element.querySelector('label')?.htmlFor).toBe('customer-email');
    expect(component.describedBy()).toBe('customer-email-help customer-email-error');
    expect(message.tagName).toBe('P');
    expect(message.children).toHaveLength(1);
    expect(message.firstElementChild?.tagName).toBe('SPAN');
    expect(message.textContent?.trim()).toBe('Invalid example');
    fixture.componentRef.setInput('error', '  ');
    fixture.componentRef.setInput('description', '');

    await fixture.whenStable();

    expect(component.describedBy()).toBeNull();
    expect(message.hidden).toBe(true);
    fixture.componentRef.setInput('controlId', 'updated-email');
    fixture.componentRef.setInput('manualError', 'Manual example error');

    await fixture.whenStable();

    expect(component.describedBy()).toBe('updated-email-error');
    expect(element.querySelector('label')?.htmlFor).toBe('updated-email');
    expect(message.id).toBe('updated-email-error');
    expect(message.hidden).toBe(false);
    expect(message.textContent?.trim()).toBe('Manual example error');
    expect(element.querySelector('[data-slot=error]')).toBe(message);
  });

  it('keeps projected controls connected to their parent FormGroup', async () => {
    const fixture = TestBed.createComponent(ProjectedGroup);

    await fixture.whenStable();

    const element = fixture.nativeElement.querySelector('input') as HTMLInputElement;

    expect(element.closest('app-field')).not.toBeNull();
    expect(element.value).toBe('demo@example.test');
    expect(element.labels?.[0].htmlFor).toBe(element.id);
    element.value = 'changed@example.test';
    element.dispatchEvent(new Event('input'));
    expect(fixture.componentInstance.group.getRawValue()).toEqual({ email: 'changed@example.test' });
  });

  it('composes with Signal Forms without a custom value accessor', async () => {
    const fixture = TestBed.createComponent(SignalFields);

    await fixture.whenStable();

    const element = fixture.nativeElement.querySelector('input[type=email]') as HTMLInputElement;
    const checkbox = fixture.nativeElement.querySelector('input[type=checkbox]') as HTMLInputElement;

    element.value = 'changed@example.test';
    element.dispatchEvent(new Event('input'));
    checkbox.click();

    await fixture.whenStable();

    expect(fixture.componentInstance.model()).toEqual({ email: 'changed@example.test', updates: true });
    fixture.componentInstance.locked.set(true);

    await fixture.whenStable();

    expect(element.disabled).toBe(true);
    expect(element.classList.contains('ui-focus-ring')).toBe(true);
  });
  it('compiles every adapter and keeps element selectors mutually exclusive', async () => {
    const fixture = TestBed.createComponent(Catalog);

    await fixture.whenStable();

    for (const primitive of UI_IMPORTS) {
      expect(fixture.debugElement.queryAll(By.directive(primitive)).length).toBeGreaterThan(0);
    }

    const instances = (type: Parameters<typeof By.directive>[0]) => fixture.debugElement.queryAll(By.directive(type));

    expect(instances(Input)).toHaveLength(2);
    expect(instances(Checkbox)).toHaveLength(1);
    expect(instances(Radio)).toHaveLength(2);
    expect(instances(Toggle)).toHaveLength(1);
    expect(instances(Text)).toHaveLength(2);
    expect(instances(Description)).toHaveLength(1);
    expect(instances(ErrorMessage)).toHaveLength(1);
    expect(instances(Link)).toHaveLength(1);
    expect(instances(LinkButton)).toHaveLength(1);
    expect(fixture.nativeElement.querySelector('input[type=file]').className).toBe('');
    expect(fixture.nativeElement.querySelector('input:not([appUI])').className).toBe('');
  });

  it('preserves native sizing, reactive forms, labels and custom layout classes', async () => {
    const fixture = TestBed.createComponent(Catalog);

    await fixture.whenStable();

    const element = fixture.nativeElement.querySelector('#email') as HTMLInputElement;
    const checkbox = fixture.nativeElement.querySelector('input[type=checkbox]') as HTMLInputElement;

    expect(element.size).toBe(24);
    expect(element.labels?.[0].textContent).toBe('Email');
    expect(element.getAttribute('aria-describedby')).toBe('email-help email-error');
    expect(element.classList.contains('example-layout')).toBe(true);
    element.value = 'changed@example.test';
    element.dispatchEvent(new Event('input'));
    checkbox.click();
    expect(fixture.componentInstance.email.value).toBe('changed@example.test');
    expect(fixture.componentInstance.checked.value).toBe(true);
    fixture.componentInstance.size.set('lg');
    fixture.componentInstance.tone.set('danger');
    fixture.componentInstance.email.disable();

    await fixture.whenStable();

    expect(element.disabled).toBe(true);
    expect(element.classList.contains('text-lg')).toBe(true);
    expect(element.classList.contains('text-sm')).toBe(false);
    expect(element.size).toBe(24);
    expect(fixture.nativeElement.querySelector('[appUI=badge]').className).toContain('bg-red-50');
    expect(fixture.nativeElement.querySelector('[appUI=switch]').getAttribute('role')).toBe('switch');
  });

  it('updates field state and responsive table options without replacing native controls', async () => {
    const fixture = TestBed.createComponent(Catalog);

    await fixture.whenStable();

    const field = fixture.debugElement.query(By.directive(Field)).nativeElement as HTMLElement;
    const table = fixture.debugElement.query(By.directive(Table)).nativeElement as HTMLTableElement;
    const input = fixture.nativeElement.querySelector('#email') as HTMLInputElement;

    expect(field.hasAttribute('data-control')).toBe(true);
    expect(field.hasAttribute('data-manual-invalid')).toBe(false);
    expect(input.dataset['slot']).toBe('control');
    expect(fixture.nativeElement.querySelector('#email-error').dataset.slot).toBe('error');
    fixture.componentInstance.compact.set(true);
    fixture.componentInstance.manualError.set('Synthetic validation error');
    fixture.componentInstance.cards.set(true);

    await fixture.whenStable();

    expect(field.hasAttribute('data-manual-invalid')).toBe(true);
    expect(field.classList.contains('gap-1.5')).toBe(true);
    expect(table.className).toContain('grid-cols-1');
    expect(table.className).toContain('sticky');
    expect(fixture.nativeElement.querySelector('#email')).toBe(input);
    fixture.componentInstance.manualError.set(null);
    fixture.componentInstance.cards.set(false);

    await fixture.whenStable();

    expect(field.hasAttribute('data-manual-invalid')).toBe(false);
    expect(table.className).not.toContain('grid-cols-1');
    expect(table.className).not.toContain('sticky');
  });

  it('delegates dialog behavior to the native element only when called', async () => {
    const fixture = TestBed.createComponent(Catalog);

    await fixture.whenStable();

    const node = fixture.debugElement.query(By.directive(Dialog));
    const element = node.nativeElement as HTMLDialogElement;
    const showModal = vi.fn(() => {
      element.open = true;
    });
    const close = vi.fn(() => {
      element.open = false;
    });

    element.showModal = showModal;
    element.close = close;
    const directive = node.injector.get(Dialog);

    expect(element.open).toBe(false);
    expect(showModal).not.toHaveBeenCalled();
    directive.showModal();
    directive.showModal();
    expect(showModal).toHaveBeenCalledOnce();
    directive.close();
    expect(close).toHaveBeenCalledOnce();
    expect(element.open).toBe(false);
  });
});
