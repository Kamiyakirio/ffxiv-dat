import type {
  DecodedFileDetail,
  DecodedFileSummary,
} from '../../src/shared/types.ts';

type DetailFixture = Partial<Omit<DecodedFileDetail, 'summary'>> & {
  summary: Pick<DecodedFileSummary, 'name'> & Partial<DecodedFileSummary>;
};

export function decodedDetail(fixture: DetailFixture): DecodedFileDetail {
  return {
    data: {},
    header: {},
    checks: [],
    warnings: [],
    sha256: '',
    ...fixture,
    summary: {
      id: fixture.summary.name,
      relativePath: fixture.summary.name,
      characterId: null,
      category: 'character',
      parentId: null,
      byteLength: 0,
      status: 'decoded',
      warningCount: 0,
      error: null,
      ...fixture.summary,
    },
  };
}
