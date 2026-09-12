/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#EFF6FF',
          100: '#DBEAFE',
          500: '#3B82F6',
          600: '#2563EB',
          700: '#1D4ED8',
          800: '#1E40AF',
          900: '#1E3A8A',
        },
        risk: {
          low: '#16A34A',
          lowBg: '#DCFCE7',
          lowBorder: '#86EFAC',
          medium: '#D97706',
          mediumBg: '#FEF3C7',
          mediumBorder: '#FCD34D',
          high: '#DC2626',
          highBg: '#FEE2E2',
          highBorder: '#FCA5A5',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
