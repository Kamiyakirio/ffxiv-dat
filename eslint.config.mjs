import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier/flat';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import ts from 'typescript-eslint';

export default defineConfig(
  globalIgnores(['.vite/**', 'out/**', 'dist/**', 'coverage/**']),
  js.configs.recommended,
  ts.configs.recommended,
  reactHooks.configs.flat.recommended,
  {
    files: [
      '*.{js,mjs,cjs,ts,mts,cts}',
      'src/{main,preload}/**/*.ts',
      'tests/**/*.{mjs,ts,tsx}',
    ],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    languageOptions: {
      globals: globals.browser,
    },
  },
  prettier,
);
