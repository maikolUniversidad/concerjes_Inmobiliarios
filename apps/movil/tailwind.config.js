/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          green: '#2E7D32',
          'green-dark': '#1B5E20',
          'green-mid': '#43A047',
        },
      },
    },
  },
  plugins: [],
}
