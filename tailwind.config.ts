import type { Config } from 'tailwindcss';
export default {
  darkMode: ['class'],
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          orange: '#F97316',
          'orange-dark': '#EA580C',
          'orange-light': '#FFF7ED',
          black: '#111111',
          'black-soft': '#1F1F1F',
          white: '#FFFFFF',
        }
      }
    }
  },
  plugins: []
} satisfies Config;
