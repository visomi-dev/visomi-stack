const THEME_KEY = 'themis.theme';

const initThemeSwitcher = () => {
  const html = document.documentElement;
  const buttons = document.querySelectorAll<HTMLButtonElement>('.theme-switch-label');

  const render = (isDark: boolean) => {
    html.classList.toggle('dark', isDark);
    html.style.colorScheme = isDark ? 'dark' : 'light';

    buttons.forEach((button) => {
      const lightIcon = button.querySelector<SVGElement>('.theme-icon-light');
      const darkIcon = button.querySelector<SVGElement>('.theme-icon-dark');

      button.setAttribute('aria-pressed', String(isDark));
      button.setAttribute('aria-label', isDark ? 'Switch to light theme' : 'Switch to dark theme');

      lightIcon?.classList.toggle('hidden', isDark);
      darkIcon?.classList.toggle('hidden', !isDark);
    });
  };

  render(html.classList.contains('dark'));

  buttons.forEach((button) => {
    button.addEventListener('click', () => {
      const isDark = !html.classList.contains('dark');

      localStorage.setItem(THEME_KEY, isDark ? 'dark' : 'light');

      render(isDark);
    });
  });
};

initThemeSwitcher();
