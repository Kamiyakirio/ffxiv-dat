import assert from 'node:assert/strict';
import type { DecodeCoverage } from '../../src/shared/types.ts';

// Decoder payloads are intentionally unknown. Check their shape before tests
// inspect fields so a malformed result fails at the boundary being exercised.
export function expectRecord(value: unknown): Record<string, unknown> {
  assert.ok(
    value !== null && typeof value === 'object' && !Array.isArray(value),
  );
  return value as Record<string, unknown>;
}

export function expectArray(value: unknown): unknown[] {
  assert.ok(Array.isArray(value));
  return value;
}

export function expectRecords(value: unknown): Record<string, unknown>[] {
  const records = expectArray(value);
  records.forEach(expectRecord);
  return records as Record<string, unknown>[];
}

export function expectString(value: unknown): string {
  assert.ok(typeof value === 'string');
  return value;
}

export function expectStrings(value: unknown): string[] {
  const strings = expectArray(value);
  strings.forEach(expectString);
  return strings as string[];
}

export function expectCoverage(value: unknown): DecodeCoverage {
  const coverage = expectRecord(value);
  assert.ok(typeof coverage.structureComplete === 'boolean');
  expectStrings(coverage.knownFields);
  expectStrings(coverage.candidateFields);
  for (const field of expectRecords(coverage.unknownFields)) {
    expectString(field.field);
    expectString(field.reason);
    assert.ok(
      field.kind === undefined ||
        ['meaning', 'storage', 'reference'].some((kind) => kind === field.kind),
    );
  }
  return value as DecodeCoverage;
}

export function expectNumber(value: unknown): number {
  assert.ok(typeof value === 'number');
  return value;
}

export function expectDefined<T>(value: T): NonNullable<T> {
  assert.ok(value !== undefined && value !== null);
  return value;
}
