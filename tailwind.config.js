/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{html,ts}'],
  darkMode: 'class',
  theme: {
    extend: {
      transitionDuration: {
        400: '400ms',
      },
      colors: {
        black: '#1D1E25',
        'soft-gray': '#F5F5F5',
        primary: '#1D1E25',
      },
      animation: {
        'fade-in': 'fade-in 1000ms forwards',
        'fade-out': 'fade-out 1000ms forwards',
        fade: 'fade 400ms ease-in-out forwards',
        slide: 'slide 1000ms linear infinite',
      },
      keyframes: {
        fade: {
          '0%': { opacity: '0' },
          '99.99%': { opacity: '0.9' },
        },
        'fade-in': {
          from: { opacity: 0 },
          to: { opacity: 1 },
        },
        'fade-out': {
          from: { opacity: 1 },
          to: { opacity: 0 },
        },
        slide: {
          from: { transform: 'translateX(-100%)' },
          to: { transform: 'translateX(100vw)' },
        },
      },
    },
  },
  plugins: [],
};
