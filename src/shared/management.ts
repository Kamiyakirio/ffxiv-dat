export interface PortraitSummary {
  id: number;
  name: string;
  background: string;
  frame: string;
  decoration: string;
  timeline: string;
  expression: string;
  updatedAt: number | null;
  usesDefault: boolean;
  fields: Record<string, string | number>;
  linkedGearsets: string[];
}

export interface PortraitCollection {
  characterPath: string;
  revision: string;
  portraits: PortraitSummary[];
  capacity: number;
  available: boolean;
  warnings: string[];
}

export interface PortraitImportPreview {
  portraits: PortraitSummary[];
  version: number;
}

export type PortraitChange =
  | {
      type: 'import';
      code: string;
      mode: 'create' | 'overwrite';
      targetIds?: number[];
    }
  | { type: 'delete'; ids: number[] }
  | { type: 'rename'; id: number; name: string };

export interface PortraitWriteRequest {
  characterPath: string;
  revision: string;
  change: PortraitChange;
}

export interface FolderBackup {
  id: string;
  characterId: string;
  characterName: string;
  sourcePath: string;
  createdAt: string;
  fileCount: number;
  byteLength: number;
  reason: 'manual' | 'portrait-change' | 'before-restore';
}

export interface BackupLibrary {
  path: string;
  custom: boolean;
  backups: FolderBackup[];
  warnings: string[];
}

export interface CharacterManagerApi {
  portraits: (characterPath: string) => Promise<PortraitCollection>;
  exportPortraits: (
    characterPath: string,
    revision: string,
    ids: number[],
  ) => Promise<string>;
  previewImport: (code: string) => Promise<PortraitImportPreview>;
  writePortraits: (
    request: PortraitWriteRequest,
  ) => Promise<PortraitCollection>;
  backups: (gamePath: string) => Promise<BackupLibrary>;
  createBackups: (characterPaths: string[]) => Promise<FolderBackup[]>;
  restoreBackup: (gamePath: string, backupId: string) => Promise<void>;
  deleteBackups: (gamePath: string, backupIds: string[]) => Promise<void>;
  chooseBackupLocation: (gamePath: string) => Promise<BackupLibrary | null>;
  resetBackupLocation: (gamePath: string) => Promise<BackupLibrary>;
  revealBackupLocation: (gamePath: string) => Promise<void>;
}
