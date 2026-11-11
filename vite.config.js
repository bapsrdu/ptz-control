import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The window's code lives in frontend/ and is built into dist-renderer/,
// which main.js loads from disk.
export default defineConfig({
    root: 'frontend',
    base: './',
    plugins: [react(), tailwindcss()],
    build: {
        outDir: '../dist-renderer',
        emptyOutDir: true,
    },
});
