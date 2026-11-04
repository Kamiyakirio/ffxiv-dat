export interface CharacterDirectory {
  path: string;
  contentId: string;
  names: string[];
  fileCount: number;
}

export interface GameDirectory {
  path: string;
  characters: CharacterDirectory[];
  fileCount: number;
}

export interface DecodeProgress {
  current: number;
  total: number;
  filename: string;
}

export interface DecodedFileSummary {
  id: string;
  name: string;
  relativePath: string;
  characterId: string | null;
  category: 'character' | 'shared' | 'backup' | 'config-copy';
  parentId: string | null;
  byteLength: number;
  status: 'decoded' | 'partial' | 'unsupported' | 'error';
  warningCount: number;
  error: string | null;
}

export interface DecodedFileDetail {
  summary: DecodedFileSummary;
  header: Record<string, unknown>;
  data: Record<string, unknown>;
  checks: Record<string, unknown>[];
  warnings: string[];
  sha256: string;
}

export interface DecodeReport {
  files: DecodedFileSummary[];
  processed: number;
  total: number;
  cancelled: boolean;
}

export interface GameDirectoryApi {
  scan: () => Promise<GameDirectory[]>;
  choose: () => Promise<GameDirectory | null>;
  reveal: (directory: string) => Promise<void>;
  decode: (directory: string) => Promise<DecodeReport>;
  cancel: () => Promise<void>;
  result: (id: string) => Promise<DecodedFileDetail>;
  onProgress: (callback: (progress: DecodeProgress) => void) => () => void;
}
