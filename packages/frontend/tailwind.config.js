/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: { accent: { DEFAULT: "#0F766E", light: "#CCFBF1", dark: "#115E59" } },
    },
  },
  plugins: [],
};
