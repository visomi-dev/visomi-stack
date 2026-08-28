const initThemeSwitcher = () => {
  const html = document.documentElement;

  const labels = document.querySelectorAll<HTMLElement>('.theme-switch-label');

  const savedTheme = localStorage.getItem('theme');

  const systemDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;

  let isDark = false;

  if (savedTheme === 'dark' || (!savedTheme && systemDark)) {
    html.classList.add('dark');
    isDark = true;
  } else {
    html.classList.remove('dark');
    isDark = false;
  }

  labels.forEach((label) => {
    const input = label.querySelector<HTMLInputElement>('.theme-switch-input');

    const iconLight = label.querySelector<HTMLElement>('.theme-icon-light');

    const iconDark = label.querySelector<HTMLElement>('.theme-icon-dark');

    if (!input || !iconLight || !iconDark) {
      return;
    }

    if (isDark) {
      input.checked = true;
      iconDark.classList.remove('hidden', 'upward-enter', 'upward-leave');
      iconLight.classList.add('hidden');
    } else {
      input.checked = false;
      iconLight.classList.remove('hidden', 'upward-enter', 'upward-leave');
      iconDark.classList.add('hidden');
    }

    function toggleTheme(event?: Event) {
      if (event?.type === 'click') {
        event.preventDefault();
      }

      isDark = !html.classList.contains('dark');
      html.classList.toggle('dark', isDark);
      localStorage.setItem('theme', isDark ? 'dark' : 'light');

      labels.forEach((currentLabel) => {
        const currentInput = currentLabel.querySelector<HTMLInputElement>('.theme-switch-input');

        const currentLightIcon = currentLabel.querySelector<HTMLElement>('.theme-icon-light');

        const currentDarkIcon = currentLabel.querySelector<HTMLElement>('.theme-icon-dark');

        if (!currentInput || !currentLightIcon || !currentDarkIcon) {
          return;
        }

        currentInput.checked = isDark;

        if (isDark) {
          currentLightIcon.classList.remove('upward-enter');
          currentLightIcon.classList.add('upward-leave');

          window.setTimeout(() => {
            currentLightIcon.classList.add('hidden');
            currentDarkIcon.classList.remove('hidden', 'upward-leave');
            currentDarkIcon.classList.add('upward-enter');
          }, 350);

          return;
        }

        currentDarkIcon.classList.remove('upward-enter');
        currentDarkIcon.classList.add('upward-leave');

        window.setTimeout(() => {
          currentDarkIcon.classList.add('hidden');
          currentLightIcon.classList.remove('hidden', 'upward-leave');
          currentLightIcon.classList.add('upward-enter');
        }, 350);
      });
    }

    label.addEventListener('click', toggleTheme);
    label.addEventListener('keyup', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggleTheme();
      }
    });
  });
};

initThemeSwitcher();
