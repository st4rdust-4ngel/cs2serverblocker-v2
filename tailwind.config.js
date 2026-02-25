/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        dark: {
          bg: '#0f1118',
          panel: '#12141c',
          border: '#232832',
        },
        neon: {
          cyan: '#00ffff',
          purple: '#bf00ff',
          pink: '#ff1493',
        }
      }
    },
  },
  plugins: [],
}
