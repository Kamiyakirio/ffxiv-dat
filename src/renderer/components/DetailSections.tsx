import type { ReadableSection } from '../../shared/types';
function propertyValue(
  key: string,
  value: ReadableSection['rows'][number][string],
) {
  const dimensions: Record<string, string[]> = {
    cameraPosition: ['X', 'Y', 'Z'],
    cameraTarget: ['X', 'Y', 'Z'],
    headDirection: ['X', 'Y'],
    eyeDirection: ['X', 'Y'],
    directionalLightingAngles: ['垂直', '水平'],
  };
  if (!dimensions[key] || typeof value !== 'string') return value;
  const parts = value.split('/').map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return value;
  return parts
    .map((n, i) => `${dimensions[key][i] ?? i + 1} ${Number(n.toFixed(3))}`)
    .join(' · ');
}
export default function DetailSections({
  sections,
}: {
  sections: ReadableSection[];
}) {
  if (!sections.some((section) => section.rows.length > 0)) return null;
  return (
    <div className="detail-sections">
      {sections
        .filter((section) => section.rows.length > 0)
        .map((section) => {
          const pairs =
            section.columns.some((c) => c.key === 'field') &&
            section.columns.some((c) => c.key === 'value');
          const entries = pairs
            ? section.rows.map((row) => ({
                label: String(row.field),
                value: row.value,
              }))
            : section.rows.length === 1
              ? section.columns.map((column) => ({
                  label: column.label,
                  value: propertyValue(column.key, section.rows[0][column.key]),
                }))
              : null;
          return (
            <section
              className="detail-section"
              key={section.id}
              aria-label={section.title}
            >
              <h3>{section.title}</h3>
              {section.note && <p className="section-note">{section.note}</p>}
              {entries ? (
                <dl className="property-grid">
                  {entries.map((entry, index) => (
                    <div key={index}>
                      <dt>{entry.label}</dt>
                      <dd>
                        {typeof entry.value === 'string' &&
                          /^#[0-9a-f]{6}$/i.test(entry.value) && (
                            <span
                              className="color-swatch"
                              style={{ backgroundColor: entry.value }}
                              aria-hidden="true"
                            />
                          )}
                        {entry.value ?? '未记录'}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        {section.columns.map((c) => (
                          <th key={c.key}>{c.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {section.rows.map((row, i) => (
                        <tr key={i}>
                          {section.columns.map((c) => (
                            <td key={c.key}>{row[c.key] ?? '未记录'}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          );
        })}
    </div>
  );
}
