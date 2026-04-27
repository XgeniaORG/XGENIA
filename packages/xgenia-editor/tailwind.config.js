/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/editor/src/**/*.{js,jsx,ts,tsx}',
    './src/frames/**/*.{js,jsx,ts,tsx}',
    './src/shared/**/*.{js,jsx,ts,tsx}',
    './src/main/**/*.{js,jsx,ts,tsx}',
    './src/assets/**/*.{js,jsx,ts,tsx}',
    './src/editor/src/views/**/*.{js,jsx,ts,tsx}',
    './src/editor/src/components/**/*.{js,jsx,ts,tsx}',
    './src/editor/src/services/**/*.{js,jsx,ts,tsx}',
    './src/editor/src/lib/**/*.{js,jsx,ts,tsx}',
    './src/editor/src/styles/**/*.{js,jsx,ts,tsx,css,scss}',
    './src/editor/src/**/*.html',
    './src/editor/app.tsx',
    './src/editor/index.ts',
    '../../private/xgenia-image-editor/src/**/*.{js,jsx,ts,tsx}',
    '../../private/xgenia-ai/src/**/*.{js,jsx,ts,tsx}'
  ],
  theme: {
    extend: {
      colors: {
        // You can add custom colors here
      },
      fontFamily: {
        // You can add custom fonts here
      }
    }
  },
  plugins: []
};
