import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { disabled, form, FormField } from '@angular/forms/signals';
import { By } from '@angular/platform-browser';

import {
  UI_DIRECTIVES,
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
} from './ui';

import type { ControlSize, Tone } from '@visomi-stack/web-frontend-ui';

@Component({
  imports: [UI_DIRECTIVES, ReactiveFormsModule],
  template: `
    <button appUI variant="danger" size="icon" aria-label="Delete">×</button>
    <a appUI="button" href="#example">Button link</a><a appUI href="#example">Text link</a>
    <h2 appUI uiSize="xl">Heading</h2>
    <p appUI>Text</p>
    <span appUI="text">Inline</span> <code appUI block>const value = 1;</code>
    <hr appUI soft />
    <span appUI="badge" [tone]="tone()">Ready</span>
    <span appUI="avatar" role="img" aria-label="Example person">EP</span>
    <table appUI density="compact" striped>
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
      <div appUI="field">
        <label appUI for="email">Email</label>
        <input
          appUI
          type="email"
          id="email"
          [size]="24"
          [uiSize]="size()"
          [formControl]="email"
          aria-describedby="email-help"
          class="example-layout"
        />
        <p appUI="description" id="email-help">Example address</p>
        <p appUI="error" id="email-error">Invalid address</p>
      </div>
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
  `,
})
class Catalog {
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

describe('native Angular UI catalog', () => {
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

    for (const directive of UI_DIRECTIVES) {
      expect(fixture.debugElement.queryAll(By.directive(directive)).length).toBeGreaterThan(0);
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
    expect(element.getAttribute('aria-describedby')).toBe('email-help');
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
