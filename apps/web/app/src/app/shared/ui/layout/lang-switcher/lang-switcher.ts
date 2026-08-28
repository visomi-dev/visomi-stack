import { Component, computed, input, signal } from '@angular/core';

import { Icon } from '../../media/icon/icon';

export type LanguageOption = Readonly<{ code: string; label: string }>;

const DEFAULT_LANG_STORAGE_KEY = 'tm-lang';

@Component({
  host: {
    class: /* tw */ 'relative',
  },
  imports: [Icon],
  selector: 'app-lang-switcher',
  templateUrl: './lang-switcher.html',
  styleUrl: './lang-switcher.css',
})
export class LangSwitcher {
  readonly default = input<string>('EN');
  readonly options = input.required<ReadonlyArray<LanguageOption>>();
  readonly storageKey = input<string>(DEFAULT_LANG_STORAGE_KEY);

  readonly current = signal<string>('');
  readonly open = signal(false);

  readonly labelFor = computed(() => {
    const code = this.current();

    return this.options().find((option) => option.code === code)?.code ?? code;
  });

  constructor() {
    if (typeof globalThis !== 'undefined' && typeof globalThis.localStorage !== 'undefined') {
      const stored = globalThis.localStorage.getItem(this.storageKey());

      this.current.set(stored ?? this.default());

      return;
    }

    this.current.set(this.default());
  }

  toggle(): void {
    this.open.update((value) => !value);
  }

  close(): void {
    this.open.set(false);
  }

  select(code: string): void {
    this.current.set(code);

    if (typeof globalThis !== 'undefined' && typeof globalThis.localStorage !== 'undefined') {
      globalThis.localStorage.setItem(this.storageKey(), code);
    }

    this.close();
  }
}
