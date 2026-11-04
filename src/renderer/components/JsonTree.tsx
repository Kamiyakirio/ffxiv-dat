import { useState } from 'react';

interface JsonTreeProps {
  value: unknown;
  label?: string;
  depth?: number;
  presentation?: boolean;
}

const names: Record<string, string> = {
  records: '记录',
  entries: '配置项',
  slots: '槽位',
  items: '装备',
  header: '文件头',
  metadataHex: '未知元数据',
  fields: '字段',
  recordCount: '记录数',
  count: '数量',
  name: '名称',
  offset: '数据偏移',
  itemIds: '物品 ID',
  itemCounts: '物品数量',
  retainers: '雇员',
  presets: '预设',
  markers: '标点',
  history: '历史记录',
  favorites: '收藏',
  chunks: '数据块',
  objects: '对象',
  title: '标题',
  text: '文字',
  position: '位置',
  angle: '角度',
  scale: '缩放',
  rgba: '颜色',
  rawHex: '原始字节',
  decodedHex: '解码字节',
  note: '说明',
  contentId: '角色 ID',
  characterContentId: '角色 ID',
  version: '版本',
  contactCount: '联系人数量',
  contacts: '联系人',
  groups: '分组',
  decks: '卡组',
  cardIds: '卡牌 ID',
  containers: '物品排序',
  completeContainer: '容器边界完整',
  segmentCount: '子段数量',
  data: '内容',
  warnings: '解析说明',
  status: '状态',
};
const technicalKeys = new Set([
  'interpretation',
  'layoutBasis',
  'offsetBasis',
  'note',
  'offset',
  'contentOffset',
  'decodedContentOffset',
  'capacity',
  'reserved',
  'completeFieldStream',
  'completeChunkStream',
  'completePartition',
  'dataType',
  'itemWidth',
]);

export default function JsonTree({
  value,
  label = '数据',
  depth = 0,
  presentation = false,
}: JsonTreeProps) {
  const [expanded, setExpanded] = useState(false);
  const [limit, setLimit] = useState(40);
  const [textLimit, setTextLimit] = useState(300);
  const isContainer = value !== null && typeof value === 'object';
  const entries = isContainer
    ? Object.entries(value as Record<string, unknown>).filter(
        ([key]) =>
          !presentation ||
          (!technicalKeys.has(key) &&
            (!key.endsWith('Hex') || key === 'contentIdHex')),
      )
    : [];
  const shown = entries.slice(0, limit);
  const scalar =
    value === null
      ? '无'
      : typeof value === 'boolean'
        ? value
          ? '是'
          : '否'
        : String(value);

  return (
    <div className={`data-node${depth === 0 ? ' root-node' : ''}`}>
      {isContainer ? (
        <>
          {depth > 0 && (
            <button
              className="tree-toggle"
              aria-label={`${names[label] ?? label} ${entries.length} ${Array.isArray(value) ? '项' : '字段'}`}
              aria-expanded={expanded}
              onClick={() => setExpanded((value) => !value)}
            >
              <svg
                viewBox="0 0 16 16"
                className={expanded ? 'expanded' : undefined}
                aria-hidden="true"
              >
                <path d="m6 3 5 5-5 5" />
              </svg>
              <span>{names[label] ?? label}</span>
              <small>
                {entries.length} {Array.isArray(value) ? '项' : '字段'}
              </small>
            </button>
          )}
          {(depth === 0 || expanded) && (
            <div className={`tree-children${depth > 0 ? ' nested' : ''}`}>
              {!entries.length && <p className="muted tree-empty">暂无记录</p>}
              {shown.map(([key, child]) => (
                <JsonTree
                  key={key}
                  value={child}
                  label={Array.isArray(value) ? `[${key}]` : key}
                  depth={depth + 1}
                  presentation={presentation}
                />
              ))}
              {entries.length > limit && (
                <button
                  className="text-button tree-more"
                  onClick={() => setLimit((value) => value + 40)}
                >
                  继续显示 40 项 · 剩余 {entries.length - limit} 项
                </button>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="tree-scalar">
          <span className="tree-label">{names[label] ?? label}</span>
          <span className="tree-value">
            {scalar.slice(0, textLimit)}
            {scalar.length > textLimit && (
              <>
                <span className="muted">…</span>
                <button
                  className="text-button"
                  onClick={() => setTextLimit((value) => value + 2000)}
                >
                  展开文本（{scalar.length.toLocaleString()} 字符）
                </button>
              </>
            )}
          </span>
        </div>
      )}
    </div>
  );
}
