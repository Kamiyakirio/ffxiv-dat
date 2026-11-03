/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />
/// <reference types="svelte" />
declare module '*.css';

interface Window {
  gameDirectory: {
    scan: () => Promise<string | null>;
  };
}
