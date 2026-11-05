import { useEffect, useRef } from 'react';
import type { CharacterDirectory } from '../../shared/types';
import { formatGameId } from '../../shared/character-label';

export const errorMessage = (reason: unknown) =>
  reason instanceof Error
    ? reason.message.replace(
        /^Error invoking remote method '[^']+': Error: /,
        '',
      )
    : String(reason);
export const characterName = (character: CharacterDirectory) =>
  formatGameId(
    character.names[0] || character.contentId,
    character.homeWorldName ||
      (character.homeWorldId ? `服务器 ${character.homeWorldId}` : null),
  );
export const dateLabel = (value: string | number | null) =>
  value
    ? new Date(typeof value === 'number' ? value * 1000 : value).toLocaleString(
        'zh-CN',
        { hour12: false },
      )
    : '未记录';
export function sizeLabel(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

export function Icon({
  name,
}: {
  name: 'portrait' | 'backup' | 'advanced' | 'folder' | 'copy' | 'arrow';
}) {
  const paths = {
    portrait:
      'M5 3h14v18H5z M9 9a3 3 0 1 0 6 0 3 3 0 1 0-6 0 M8 18c0-4 8-4 8 0',
    backup: 'M4 8h16v12H4z M3 4h18v4H3z M10 12h4',
    advanced: 'm8 7-5 5 5 5 m8-10 5 5-5 5 m-3-14-2 18',
    folder: 'M3 6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11H3z',
    copy: 'M8 8h12v13H8z M16 8V3H3v13h5',
    arrow: 'M4 12h16 m-6-6 6 6-6 6',
  };
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={paths[name]} />
    </svg>
  );
}

export function SelectAll({
  checked,
  partial,
  disabled,
  onChange,
  label,
}: {
  checked: boolean;
  partial: boolean;
  disabled?: boolean;
  onChange: () => void;
  label: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = partial;
  }, [partial]);
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={label}
      checked={checked}
      disabled={disabled}
      onChange={onChange}
    />
  );
}

export type RunTask = (
  label: string,
  action: () => Promise<void>,
) => Promise<void>;
