declare module '*.css';

interface Window {
  gameDirectory: import('../shared/types').GameDirectoryApi;
  characterManager: import('../shared/management').CharacterManagerApi;
}
