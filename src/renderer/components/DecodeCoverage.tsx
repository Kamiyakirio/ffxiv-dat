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
        {coverage.structureComplete
          ? '记录结构已完整读取'
          : '记录结构尚有未识别部分'}{' '}
        · 已解释 {coverage.knownFields.length} 类字段
        {pending.length ? ` · ${pending.length} 项含义或关联待核对` : ''}
        {storage.length ? ` · ${storage.length} 个原始存储字段已保留` : ''}
      </p>
      {(coverage.knownFields.length > 0 ||
        coverage.candidateFields.length > 0 ||
        coverage.unknownFields.length > 0) && (
        <details className="technical-details">
          <summary>逐项解析范围与剩余缺口</summary>
          {coverage.knownFields.length > 0 && (
            <>
              <h3>已读取并可解释</h3>
              <p className="diagnostic-note">
                {coverage.knownFields.join('、')}
              </p>
            </>
          )}
          {coverage.candidateFields.length > 0 && (
            <>
              <h3>已读取，业务对应仍需核对</h3>
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
                    <th>具体字段</th>
                    <th>剩余问题</th>
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
