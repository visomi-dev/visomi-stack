// This classic script runs before paint in both applications and never accesses browser APIs on the server.
(() => {
  if (typeof window === 'undefined') {
    return;
  }

  const key = 'visomi.theme';
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  let preference = 'system';

  try {
    const stored = window.localStorage.getItem(key);

    if (stored === 'light' || stored === 'dark') {
      preference = stored;
    }
  } catch {
    // Storage can be disabled independently of the browser's theme preference.
  }

  function apply() {
    document.documentElement.classList.toggle(
      'dark',
      preference === 'dark' || (preference === 'system' && media.matches),
    );
    for (const control of document.querySelectorAll('[data-theme-select]')) {
      control.value = preference;
    }
  }

  apply();
  document.addEventListener('DOMContentLoaded', apply, { once: true });
  media.addEventListener('change', apply);
  document.addEventListener('change', (event) => {
    const control = event.target;

    if (!(control instanceof HTMLSelectElement) || !control.matches('[data-theme-select]')) {
      return;
    }

    if (!['light', 'dark', 'system'].includes(control.value)) {
      return;
    }

    preference = control.value;

    try {
      window.localStorage.setItem(key, preference);
    } catch {
      // The selected theme still works for this page when persistence is unavailable.
    }
    apply();
  });
})();
