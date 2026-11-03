import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier/flat';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import ts from 'typescript-eslint';
import svelteConfig from './svelte.config.mjs';

export default defineConfig(
  globalIgnores(['.vite/**', 'out/**', 'dist/**', 'coverage/**']),
  js.configs.recommended,
  ts.configs.recommended,
  svelte.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        extraFileExtensions: ['.svelte'],
      },
    },
  },
  {
    files: [
      '*.{js,mjs,cjs,ts,mts,cts}',
      'src/{main,preload,game-directory-scanner}.ts',
      'tests/**/*.mjs',
    ],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['src/renderer.ts', 'src/**/*.svelte', 'src/**/*.svelte.{js,ts}'],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    files: ['**/*.svelte', '**/*.svelte.{js,ts}'],
    languageOptions: {
      parserOptions: {
        parser: ts.parser,
        svelteConfig,
      },
    },
  },
  prettier,
  svelte.configs.prettier,
);
