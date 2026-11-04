import { decodeUtf8, readSections } from './sections.ts';
import { keyNames } from './key-names.ts';
import type { DatDecodeResult } from './types.ts';

export function decodeTextConfig(payload: Buffer): DatDecodeResult {
  const text = decodeUtf8(payload);
  if (text === null) throw new Error('Configuration is not valid UTF-8');
  let section: string | null = null;
  const entries: Record<string, unknown>[] = [];
  const otherLines: Record<string, unknown>[] = [];
  const trailingNulCount = /\0+$/.exec(text)?.[0].length ?? 0;
  const lines = text.slice(0, text.length - trailingNulCount).split(/\r?\n/);
  lines.forEach((line, index) => {
    if (!line.trim()) return;
    if (/^<.*>$/.test(line)) {
      section = line.slice(1, -1);
      return;
    }
    const separator = line.indexOf('\t');
    if (separator < 0) {
      otherLines.push({ line: index + 1, text: line });
      return;
    }
    const value = line.slice(separator + 1);
    entries.push({
      line: index + 1,
      section,
      name: line.slice(0, separator),
      value,
      numericValue:
        /^-?\d+$/.test(value) && Number.isSafeInteger(Number(value))
          ? Number(value)
          : null,
    });
  });
  return {
    status: otherLines.length ? 'partial' : 'decoded',
    data: { entries, otherLines, trailingNulCount, text },
    warnings: otherLines.length
      ? ['Some lines are not tab-separated settings']
      : [],
  };
}

export function decodeMacros(
  payload: Buffer,
  version: number,
): DatDecodeResult {
  const sections = readSections(payload);
  const macros: Record<string, unknown>[] = [];
  if (version !== 2 || sections.length !== 1800) {
    return {
      status: 'partial',
      data: { sections },
      warnings: ['Unrecognized macro version or slot count; fields preserved'],
    };
  }
  for (let index = 0; index < 100; index++) {
    const fields = sections.slice(index * 18, (index + 1) * 18);
    if (
      fields.map((field) => field.tag).join('') !== `TIK${'L'.repeat(15)}` ||
      fields.some((field) => !field.nulTerminated || field.text === null)
    ) {
      throw new Error(
        `Invalid macro field sequence or encoding at slot ${index}`,
      );
    }
    const iconHex = fields[1].text ?? '';
    const iconRowText = fields[2].text;
    macros.push({
      index,
      offset: fields[0].offset,
      name: fields[0].text,
      iconHex,
      iconId: /^[0-9a-f]+$/i.test(iconHex) ? parseInt(iconHex, 16) : null,
      iconRowText,
      lines: fields.slice(3).map((field) => field.text),
    });
  }
  return {
    status: 'decoded',
    data: { count: macros.length, macros },
    warnings: [],
  };
}

function decodeKey(setting: string) {
  const match = /^([0-9a-f]{2})\.([0-9a-f]{2})$/i.exec(setting);
  if (!match) return { raw: setting, recognized: false };
  const keyCode = parseInt(match[1], 16);
  const modifiers = parseInt(match[2], 16);
  const gamepad = keyCode >= 160;
  const flags: [number, string][] = gamepad
    ? [
        [1, 'L1'],
        [2, 'R1'],
        [4, 'L2'],
        [8, 'R2'],
        [64, 'Start'],
        [128, 'Select'],
      ]
    : [
        [1, 'Shift'],
        [2, 'Ctrl'],
        [4, 'Alt'],
      ];
  const knownMask = flags.reduce((mask, [bit]) => mask | bit, 0);
  return {
    raw: setting,
    recognized: true,
    keyCode,
    keyName: keyNames[keyCode] ?? null,
    unbound: keyCode === 0,
    modifiers,
    modifierNames: flags
      .filter(([bit]) => modifiers & bit)
      .map(([, name]) => name),
    unknownModifierBits: modifiers & ~knownMask,
  };
}

export function decodeKeybinds(
  payload: Buffer,
  version: number,
): DatDecodeResult {
  const sections = readSections(payload);
  if (version !== 101 || sections.length % 2) {
    return {
      status: 'partial',
      data: { sections },
      warnings: ['Unknown keybind version or unmatched fields'],
    };
  }
  const bindings: Record<string, unknown>[] = [];
  const warnings: string[] = [];
  for (let i = 0; i < sections.length; i += 2) {
    const command = sections[i];
    const config = sections[i + 1];
    if (
      command.tag !== 'T' ||
      config.tag !== 'C' ||
      !command.nulTerminated ||
      !config.nulTerminated ||
      !command.text ||
      config.text === null
    ) {
      throw new Error(`Invalid keybind field pair at offset ${command.offset}`);
    }
    const settings = config.text.split(',').filter(Boolean);
    const keys = settings.map(decodeKey);
    if (
      settings.length !== 2 ||
      keys.some((key) => !key.recognized || key.unknownModifierBits)
    ) {
      warnings.push(`Unrecognized key configuration for ${command.text}`);
    }
    bindings.push({
      index: i / 2,
      offset: command.offset,
      command: command.text,
      raw: config.text,
      keys,
    });
  }
  return {
    status: warnings.length ? 'partial' : 'decoded',
    data: { count: bindings.length, bindings },
    warnings,
  };
}
