/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      keyframes: {
        kenburns: {
          '0%': { transform: 'scale(1.06) translate3d(0, 0, 0)' },
          '100%': { transform: 'scale(1.18) translate3d(-1.5%, -1.5%, 0)' },
        },
        fadeUp: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        kenburns: 'kenburns var(--slide-duration, 25s) ease-out forwards',
        fadeUp: 'fadeUp 400ms ease-out both',
      },
    },
  },
  plugins: [],
};
