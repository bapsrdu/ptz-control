import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([
    globalIgnores(['dist-renderer', 'node_modules', 'release']),
    {
        files: ['**/*.{js,cjs}'],
        ignores: ['frontend/**'],
        extends: [js.configs.recommended],
        languageOptions: { globals: globals.node },
        rules: {
            'no-unused-vars': ['warn', { caughtErrors: 'none', argsIgnorePattern: '^_' }],
            'no-empty': ['error', { allowEmptyCatch: true }],
        },
    },
    {
        // Code passed to page.waitForFunction runs in the window.
        files: ['e2e/**'],
        languageOptions: { globals: { ...globals.node, ...globals.browser } },
    },
    {
        files: ['preload.cjs'],
        languageOptions: { sourceType: 'commonjs' },
    },
    {
        files: ['frontend/**/*.{js,jsx}'],
        extends: [js.configs.recommended, reactHooks.configs.flat.recommended, reactRefresh.configs.vite],
        languageOptions: {
            globals: globals.browser,
            parserOptions: { ecmaFeatures: { jsx: true } },
        },
        rules: {
            'react-hooks/set-state-in-effect': 'off',
            'react-hooks/refs': 'off',
            'no-unused-vars': ['warn', { caughtErrors: 'none', argsIgnorePattern: '^_', varsIgnorePattern: '^[A-Z]' }],
            'no-empty': ['error', { allowEmptyCatch: true }],
        },
    },
]);
