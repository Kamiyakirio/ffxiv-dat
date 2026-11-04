export interface DatDecodeResult {
  status: 'decoded' | 'partial' | 'unsupported';
  data: Record<string, unknown>;
  warnings: string[];
}

export interface DatSection {
  offset: number;
  tag: string;
  length: number;
  valueHex: string;
  text: string | null;
  nulTerminated: boolean;
}
