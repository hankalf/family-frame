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
          // --kenburns-scale is set per-slide so the zoom depth is adjustable.
          '0%': { transform: 'scale(1) translate3d(0, 0, 0)' },
          '100%': {
            transform: 'scale(var(--kenburns-scale, 1.12)) translate3d(-1.5%, -1.5%, 0)',
          },
        },
        fadeUp: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        marquee: {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' },
        },
      },
      animation: {
        kenburns: 'kenburns var(--slide-duration, 25s) ease-out forwards',
        fadeUp: 'fadeUp 400ms ease-out both',
        marquee: 'marquee 22s linear infinite',
      },
    },
  },
  plugins: [],
};
