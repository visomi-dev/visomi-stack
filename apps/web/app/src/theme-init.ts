import { theme } from '@visomi-stack/web-frontend-ui';

// The head entry runs before paint; Angular owns controls and listeners after hydration.
let stored: unknown;

try {
  stored = window.localStorage.getItem(theme.storageKey);
} catch {
  // The system preference remains available when storage is blocked.
}

document.documentElement.classList.toggle(
  'dark',
  theme.resolve(theme.preference(stored), window.matchMedia('(prefers-color-scheme: dark)').matches) === 'dark',
);
