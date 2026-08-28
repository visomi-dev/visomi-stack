import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import type { Signal } from '@angular/core';
import { form, FormField } from '@angular/forms/signals';

import { Avatar } from '../shared/ui/data/avatar/avatar';
import { Badge } from '../shared/ui/data/badge/badge';
import { Pagination } from '../shared/ui/data/pagination/pagination';
import { Table } from '../shared/ui/data/table/table';
import { Loader } from '../shared/ui/feedback/loader/loader';
import { Checkbox } from '../shared/ui/forms/checkbox/checkbox';
import { Input } from '../shared/ui/forms/input/input';
import { RadioCard } from '../shared/ui/forms/radio-card/radio-card';
import { RadioGroup } from '../shared/ui/forms/radio-group/radio-group';
import { Select } from '../shared/ui/forms/select/select';
import { Switch } from '../shared/ui/forms/switch/switch';
import { Textarea } from '../shared/ui/forms/textarea/textarea';
import { Button } from '../shared/ui/actions/button/button';
import { IconButton } from '../shared/ui/actions/icon-button/icon-button';
import { LinkButton } from '../shared/ui/actions/link-button/link-button';
import { Heading } from '../shared/ui/typography/heading/heading';
import { Text } from '../shared/ui/typography/text/text';
import { Divider } from '../shared/ui/typography/divider/divider';
import { Card } from '../shared/ui/layout/card/card';
import { Icon } from '../shared/ui/media/icon/icon';
import { Listbox, type ListboxOption } from '../shared/ui/overlays/listbox/listbox';
import { Dropdown } from '../shared/ui/overlays/dropdown/dropdown';
import { Alert } from '../shared/ui/overlays/alert/alert';
import { Tooltip } from '../shared/ui/overlays/tooltip/tooltip';
import { Dialog } from '../shared/ui/overlays/dialog/dialog';

type TextForm = { value: string };
type BooleanForm = { value: boolean };
type ListboxForm = { value: string };

const textFormModel = signal<TextForm>({ value: '' });
const booleanFormModel = signal<BooleanForm>({ value: false });
const listboxFormModel = signal<ListboxForm>({ value: '' });

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    Alert,
    Avatar,
    Badge,
    Button,
    Card,
    Checkbox,
    Dialog,
    Divider,
    Dropdown,
    FormField,
    Heading,
    Icon,
    IconButton,
    Input,
    LinkButton,
    Listbox,
    Loader,
    Pagination,
    RadioCard,
    RadioGroup,
    Select,
    Switch,
    Table,
    Text,
    Textarea,
    Tooltip,
  ],
  selector: 'app-gallery',
  templateUrl: './gallery.html',
  styleUrl: './gallery.css',
})
export class Gallery {
  readonly filter = signal('');
  readonly activeSection = signal<string | null>(null);

  readonly inputForm = form(textFormModel);
  readonly textareaForm = form(textFormModel);
  readonly selectForm = form(listboxFormModel);
  readonly checkboxForm = form(booleanFormModel);
  readonly switchForm = form(booleanFormModel);
  readonly radioForm = form(listboxFormModel);

  readonly sections = [
    {
      id: 'actions',
      title: 'Actions',
      description: 'Buttons, icon buttons, and link buttons share the Catalyst optical border pattern.',
      examples: [
        {
          title: 'Solid button',
          description: 'Primary call to action with a tone color and disabled state.',
          host: 'button' as const,
        },
        {
          title: 'Outline button',
          description: 'Secondary action that sits on tinted surfaces without competing with the primary tone.',
          host: 'button' as const,
        },
        { title: 'Plain button', description: 'Tertiary, low-emphasis action.', host: 'button' as const },
        {
          title: 'Icon button',
          description: 'Square button for icon-only controls. Always set an `ariaLabel`.',
          host: 'icon-button' as const,
        },
        {
          title: 'Link button',
          description: 'Anchor styled as a button for navigation.',
          host: 'link-button' as const,
        },
      ],
    },
    {
      id: 'forms',
      title: 'Forms',
      description:
        'Field, input, and choice controls. All controls implement `ControlValueAccessor` and bind to Signal Forms via `[formField]`.',
      examples: [
        {
          title: 'Text input',
          description: 'Single-line text input bound to a Signal Forms `Field<string>`.',
          host: 'input' as const,
        },
        {
          title: 'Textarea',
          description: 'Multi-line text input with `minLength` and `maxLength` pass-through.',
          host: 'textarea' as const,
        },
        { title: 'Select', description: 'Native `<select>` styled to match inputs.', host: 'select' as const },
        {
          title: 'Checkbox',
          description: 'Boolean checkbox that toggles a `Field<boolean>`.',
          host: 'checkbox' as const,
        },
        { title: 'Switch', description: 'Binary toggle with the same CVA contract.', host: 'switch' as const },
        { title: 'Radio group', description: 'Single selection from a list of options.', host: 'radio-group' as const },
        {
          title: 'Radio card',
          description: 'Selection card that doubles as a description.',
          host: 'radio-card' as const,
        },
      ],
    },
    {
      id: 'overlays',
      title: 'Overlays',
      description:
        'Dropdowns, listboxes, dialogs, alerts, and tooltips. The listbox delegates behavior to `@angular/cdk/listbox`.',
      examples: [
        {
          title: 'Listbox',
          description: 'Single-select list with roving focus and `aria-activedescendant`.',
          host: 'listbox' as const,
        },
        {
          title: 'Dropdown',
          description: 'Connected overlay for the listbox and other menus.',
          host: 'dropdown' as const,
        },
        { title: 'Alert', description: 'Inline status message with a tone accent.', host: 'alert' as const },
        { title: 'Tooltip', description: 'Keyboard-accessible disclosure tooltip.', host: 'tooltip' as const },
        { title: 'Dialog', description: 'Modal dialog with CDK focus trap.', host: 'dialog' as const },
      ],
    },
    {
      id: 'data',
      title: 'Data',
      description: 'Display primitives: avatars, badges, pagination, tables.',
      examples: [
        { title: 'Avatar', description: 'Initials avatar with three sizes.', host: 'avatar' as const },
        { title: 'Badge', description: 'Tone badge for status and counts.', host: 'badge' as const },
        { title: 'Pagination', description: 'Numbered pagination control.', host: 'pagination' as const },
        { title: 'Table', description: 'Declarative table with projected cells.', host: 'table' as const },
      ],
    },
    {
      id: 'layout',
      title: 'Layout',
      description: 'Cards and the design-system building blocks.',
      examples: [{ title: 'Card', description: 'Padded surface with tonal shift.', host: 'card' as const }],
    },
    {
      id: 'typography',
      title: 'Typography',
      description: 'Headings, text, and dividers using the Catalyst font stack.',
      examples: [
        { title: 'Heading', description: 'Manrope heading with a level input.', host: 'heading' as const },
        { title: 'Text', description: 'Inter body text with tone and size modifiers.', host: 'text' as const },
        { title: 'Divider', description: 'Horizontal divider for stacked layouts.', host: 'divider' as const },
      ],
    },
    {
      id: 'media',
      title: 'Media',
      description: 'Icon component renders the static SVG set defined in `icon-paths.ts`.',
      examples: [
        { title: 'Icons', description: 'A representative set of the available icon paths.', host: 'icon' as const },
      ],
    },
    {
      id: 'feedback',
      title: 'Feedback',
      description: 'Loaders for async UI states.',
      examples: [{ title: 'Loader', description: 'The Nive four-dot loader in tone colors.', host: 'loader' as const }],
    },
  ] as const;

  readonly filteredSections = computed(() => {
    const filter = this.filter().trim().toLowerCase();
    const sections = this.sections.map((section) => ({
      ...section,
      examples: [...section.examples],
    }));

    if (!filter) {
      return sections;
    }

    return sections
      .map((section) => ({
        ...section,
        examples: section.examples.filter(
          (example) =>
            example.title.toLowerCase().includes(filter) ||
            example.description.toLowerCase().includes(filter) ||
            example.host.toLowerCase().includes(filter),
        ),
      }))
      .filter((section) => section.examples.length > 0);
  });

  readonly listboxOptions: ListboxOption[] = [
    { label: 'Active projects', value: 'active' },
    { label: 'Archived projects', value: 'archived' },
    { label: 'All projects', value: 'all' },
  ];

  readonly selectOptions: ListboxOption[] = [
    { label: 'Active projects', value: 'active' },
    { label: 'Archived projects', value: 'archived' },
    { label: 'All projects', value: 'all' },
  ];

  readonly tableRows = [
    { id: 1, name: 'Atlas', tone: 'success', count: 12 },
    { id: 2, name: 'Beacon', tone: 'accent', count: 4 },
    { id: 3, name: 'Citadel', tone: 'danger', count: 0 },
  ];

  readonly radioOptions = [
    { value: 'starter', label: 'Starter', description: 'For solo founders and weekend builds.' },
    { value: 'team', label: 'Team', description: 'For small product teams up to 10 people.' },
    { value: 'enterprise', label: 'Enterprise', description: 'For organizations with audit and SSO requirements.' },
  ];

  readonly radioGroupValue = signal('team');

  readonly dialogOpen = signal(false);

  readonly iconNames = [
    'angle-down',
    'angle-left',
    'angle-right',
    'angle-up',
    'bars',
    'bell',
    'check',
    'chevron-down',
    'circle-alert',
    'circle-check',
    'circle-info',
    'close',
    'eye',
    'eye-off',
    'folder',
    'globe',
    'grid',
    'logo-mark',
    'moon',
    'plus',
    'question-circle',
    'search',
    'sign-out',
    'sun',
    'user',
    'wallet',
  ] as const;

  readonly filteredIconNames: Signal<readonly string[]> = computed(() => this.iconNames);

  setFilter(value: string): void {
    this.filter.set(value);
  }

  scrollTo(id: string): void {
    this.activeSection.set(id);

    if (typeof document === 'undefined') {
      return;
    }

    document.getElementById(`section-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  openDialog() {
    this.dialogOpen.set(true);
  }

  closeDialog() {
    this.dialogOpen.set(false);
  }

  readonly inputField = this.inputForm.value;
  readonly textareaField = this.textareaForm.value;
  readonly selectField = this.selectForm.value;
  readonly checkboxField = this.checkboxForm.value;
  readonly switchField = this.switchForm.value;
  readonly radioField = this.radioForm.value;
}
