import type { DecodeCoverage } from '../../../shared/types.ts';

export interface DatDecodeResult {
  status: 'decoded' | 'partial' | 'unsupported';
  data: Record<string, unknown>;
  warnings: string[];
  coverage?: DecodeCoverage;
}

export interface DatSection {
  offset: number;
  tag: string;
  length: number;
  valueHex: string;
  text: string | null;
  nulTerminated: boolean;
}
