/** @type {import('tailwindcss').Config} */
module.exports = {
  important: true,
  content: [
    './static/**/*.html',
    './static/**/*.js',
  ],
  theme: {
    extend: {
      colors: {
        darker: '#0f172a',
        light: '#f8fafc',
        primary: '#6366f1',
      },
    },
  },
  plugins: [],
}
