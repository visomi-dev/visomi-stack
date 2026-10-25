# Tailwind CSS Configuration

## CSS-First Configuration (v4.1+)

Use the `@theme` directive for CSS-based configuration:

```css
/* src/styles.css */
@import 'tailwindcss';

@theme {
  /* Custom colors */
  --color-brand-50: #f0f9ff;
  --color-brand-500: #3b82f6;
  --color-brand-900: #1e3a8a;

  /* Custom fonts */
  --font-display: 'Inter', system-ui, sans-serif;
  --font-mono: 'Fira Code', monospace;

  /* Custom spacing */
  --spacing-128: 32rem;

  /* Custom animations */
  --animate-fade-in: fadeIn 0.5s ease-in-out;

  /* Custom breakpoints */
  --breakpoint-3xl: 1920px;
}

/* Define custom animations */
@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

/* Custom utilities */
@utility content-auto {
  content-visibility: auto;
}
```

---

## JavaScript Configuration (Legacy)

This is for an existing v3 setup or a deliberately retained compatible JavaScript config. Tailwind v4 does not discover this file automatically; load it explicitly with `@config` only when needed. Prefer v4 CSS-first tokens and automatic source detection/`@source`, and check unsupported legacy options in the [upgrade guide](https://tailwindcss.com/docs/upgrade-guide#using-a-javascript-config-file). Do not introduce this file as a second configuration.

```javascript
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{html,js,ts,jsx,tsx,vue,svelte}'],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#f0f9ff',
          500: '#3b82f6',
          900: '#1e3a8a',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      spacing: {
        128: '32rem',
      },
    },
  },
  plugins: [],
};
```

---

## Vite Integration (v4.1+)

Only for a project with a real Vite configuration and an approved installed integration. Angular/Nx builder internals do not imply that this plugin belongs in a standalone Vite config; preserve the project's supported integration.

```javascript
// vite.config.ts
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [tailwindcss()],
});
```

---

## Advanced v4.1 Features

### Native CSS Custom Properties

```html
<div class="bg-[var(--color-brand-500)] text-[var(--color-white)]">Using CSS custom properties directly</div>
```

### Enhanced Arbitrary Values

```html
<!-- Complex grid with custom tracks -->
<div class="grid grid-cols-[repeat(auto-fit,minmax(250px,1fr))] gap-4">Responsive grid without custom CSS</div>

<!-- Custom animation timing -->
<div class="animate-bounce ease-[cubic-bezier(0.68,-0.55,0.265,1.55)]">Bounce with custom easing</div>
```

### Custom Utilities

```css
@utility content-auto {
  content-visibility: auto;
}

@utility text-shadow {
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}
```

---

## Plugins

The JavaScript plugin/preset examples below are legacy compatibility references, not instructions to install packages or replace CSS-first v4 configuration.

### Custom Plugin Example

```javascript
// tailwind.config.js
const plugin = require('tailwindcss/plugin');

module.exports = {
  plugins: [
    plugin(function ({ addUtilities, addComponents, e, config }) {
      // Add custom utilities
      addUtilities({
        '.content-auto': {
          contentVisibility: 'auto',
        },
      });

      // Add custom components
      addComponents({
        '.btn': {
          padding: '.5rem 1rem',
          borderRadius: '.25rem',
          fontWeight: '600',
        },
      });
    }),
  ],
};
```

---

## Presets

### Creating a Reusable Preset

```javascript
// tailwind-preset.js
module.exports = {
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#3b82f6',
          light: '#60a5fa',
          dark: '#1d4ed8',
        },
      },
    },
  },
  plugins: [require('@tailwindcss/forms'), require('@tailwindcss/typography')],
};
```

### Using a Preset

```javascript
// tailwind.config.js
module.exports = {
  presets: [require('./tailwind-preset.js')],
};
```
