import type { DecodeCoverage as Coverage } from '../../shared/types';

export default function DecodeCoverage({ coverage }: { coverage?: Coverage }) {
  if (!coverage) return null;
  const pending = coverage.unknownFields.filter(
    (field) => field.kind !== 'storage',
  );
  const storage = coverage.unknownFields.filter(
    (field) => field.kind === 'storage',
  );
  return (
    <div className="coverage-summary">
      <p className="record-count">
        {coverage.structureComplete ? '结构已解析' : '结构未完全解析'} · 已解析{' '}
        {coverage.knownFields.length} 类字段
        {pending.length ? ` · ${pending.length} 项含义或关联未确认` : ''}
        {storage.length ? ` · ${storage.length} 项存储细节未确认` : ''}
      </p>
      {(coverage.knownFields.length > 0 ||
        coverage.candidateFields.length > 0 ||
        coverage.unknownFields.length > 0) && (
        <details className="technical-details">
          <summary>解析范围与待确认字段</summary>
          {coverage.knownFields.length > 0 && (
            <>
              <h3>已解析字段</h3>
              <p className="diagnostic-note">
                {coverage.knownFields.join('、')}
              </p>
            </>
          )}
          {coverage.candidateFields.length > 0 && (
            <>
              <h3>待确认字段</h3>
              <p className="diagnostic-note">
                {coverage.candidateFields.join('、')}
              </p>
            </>
          )}
          {coverage.unknownFields.length > 0 && (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>字段</th>
                    <th>说明</th>
                  </tr>
                </thead>
                <tbody>
                  {coverage.unknownFields.map((field, index) => (
                    <tr key={index}>
                      <td>
                        {field.field}
                        {field.kind === 'storage' ? '（原始存储）' : ''}
                      </td>
                      <td>{field.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </details>
      )}
    </div>
  );
}
