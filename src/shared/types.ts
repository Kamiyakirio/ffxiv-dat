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
  readable?: ReadableSection[];
  coverage?: DecodeCoverage;
}

export interface DecodeCoverage {
  structureComplete: boolean;
  knownFields: string[];
  candidateFields: string[];
  unknownFields: {
    field: string;
    reason: string;
    kind?: 'meaning' | 'storage' | 'reference';
  }[];
}

export interface ReadableSection {
  id: string;
  title: string;
  sourceId?: string;
  sourceKeys?: string[];
  note?: string;
  columns: { key: string; label: string }[];
  rows: Record<string, string | number | null>[];
}

export interface DecodeReport {
  files: DecodedFileSummary[];
  processed: number;
  total: number;
  cancelled: boolean;
}

export type EditValue = string | number | boolean;
export interface EditTarget {
  label: string;
  prefixes?: string[];
  ids?: string[];
}
export interface EditableField {
  id: string;
  group: string;
  label: string;
  type: 'text' | 'number' | 'boolean';
  value: EditValue;
  min?: number;
  max?: number;
  step?: number;
  maxBytes?: number;
  reference?: string;
  referenceType?: { fieldId: string; sheets: Record<string, string> };
  displayValue?: string;
  choices?: { value: number; label: string }[];
}
export interface DatEditModel {
  id: string;
  sha256: string;
  fields: EditableField[];
  notes: string[];
}
export interface DatEditRequest {
  id: string;
  sha256: string;
  changes: { id: string; value: EditValue }[];
}
export interface DatSaveResult {
  report: DecodeReport;
  selectedId: string;
  backupPath: string;
}

export interface GameDirectoryApi {
  scan: () => Promise<GameDirectory[]>;
  choose: () => Promise<GameDirectory | null>;
  reveal: (directory: string) => Promise<void>;
  decode: (directory: string) => Promise<DecodeReport>;
  cancel: () => Promise<void>;
  result: (id: string) => Promise<DecodedFileDetail>;
  edit: (id: string) => Promise<DatEditModel>;
  names: (
    sheet: string,
    query: string,
  ) => Promise<{ value: number; label: string }[]>;
  save: (request: DatEditRequest) => Promise<DatSaveResult>;
  onProgress: (callback: (progress: DecodeProgress) => void) => () => void;
}
