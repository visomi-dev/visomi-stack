/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,html}'],
  darkMode: 'class',
  theme: {
    fontSize: {
      xs: ['0.75rem', { lineHeight: '1rem' }],
      sm: ['0.875rem', { lineHeight: '1.5rem' }],
      base: ['1rem', { lineHeight: '1.75rem' }],
      lg: ['1.125rem', { lineHeight: '2rem' }],
      xl: ['1.25rem', { lineHeight: '2rem' }],
      '2xl': ['1.5rem', { lineHeight: '2rem' }],
      '3xl': ['2rem', { lineHeight: '2.5rem' }],
      '4xl': ['2.5rem', { lineHeight: '3.5rem' }],
      '5xl': ['3rem', { lineHeight: '3.5rem' }],
      '6xl': ['3.75rem', { lineHeight: '1' }],
      '7xl': ['4.5rem', { lineHeight: '1.1' }],
      '8xl': ['6rem', { lineHeight: '1' }],
      '9xl': ['8rem', { lineHeight: '1' }],
    },
    extend: {
      spacing: {
        18: '4.5rem',
      },
      padding: {
        18: '4.5rem',
      },
      margin: {
        18: '4.5rem',
      },
      height: {
        18: '4.5rem',
      },
      width: {
        xl: '36rem',
      },
      maxWidth: {
        '2xl': '40rem',
        60: '15rem',
      },
      borderRadius: {
        '4xl': '2rem',
      },
      fontFamily: {
        sans: 'Poppins, sans-serif',
        display: 'Poppins, sans-serif',
      },
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
