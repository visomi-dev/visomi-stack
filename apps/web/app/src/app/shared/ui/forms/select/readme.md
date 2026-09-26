# Select content

Use native options projected with `ng-content` for ordinary selects. The parent owns the options and can use `@for`, `@if`, and i18n.

```html
<app-select controlId="role" [formField]="roleForm.role">
  <option value="member">Member</option>
  <option value="admin">Admin</option>
</app-select>
```

For a template fragment, import `SelectOptions` alongside `Select`. The component instantiates the fragment using `NgTemplateOutlet` inside the native select.

```html
<app-select controlId="role" [formField]="roleForm.role">
  <ng-template appSelectOptions>
    @for (role of roles(); track role.id) {
    <option [value]="role.id">{{ role.label }}</option>
    }
  </ng-template>
</app-select>
```

Projection is unconditional. If both forms are supplied, projected options appear first, followed by the template's options. Do not repeat options in both forms. Only one `appSelectOptions` fragment is supported per select.

Selection is synchronized after rendering, including when options arrive after the field value. Both forms share the native disabled/touched/invalid states and label association.

References: [Angular content projection](https://angular.dev/guide/components/content-projection), [template fragments](https://angular.dev/guide/templates/ng-template), and [DOM APIs](https://angular.dev/guide/components/dom-apis).
