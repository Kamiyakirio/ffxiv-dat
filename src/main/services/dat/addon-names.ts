import data from './addon-name-data.json' with { type: 'json' };

const names: Record<string, { name: string }> = data.names;
const labels: Record<string, string> = data.labels;

export function nativeAddonName(hash: number): string | null {
  return names[hash.toString(16).padStart(8, '0')]?.name ?? null;
}

export function addonDisplayName(name: unknown, hash: unknown): string {
  if (typeof name === 'string' && name) return labels[name] ?? name;
  return `名称待核对的界面（${hash}）`;
}
