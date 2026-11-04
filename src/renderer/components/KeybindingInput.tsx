import { keyNames } from '../../shared/key-names';
import type { EditValue } from '../../shared/types';
const labels: Record<string, string> = {
  NO_KEY: '未设置',
  LBUTTON: '鼠标左键',
  RBUTTON: '鼠标右键',
  MBUTTON: '鼠标中键',
  XBUTTON1: '鼠标侧键 1',
  XBUTTON2: '鼠标侧键 2',
  BACK: '退格',
  RETURN: 'Enter',
  SPACE: '空格',
  PRIOR: 'Page Up',
  NEXT: 'Page Down',
  CAPITAL: 'Caps Lock',
  ESCAPE: 'Esc',
  CONTROL: 'Ctrl',
  MENU: 'Alt',
  SHIFT: 'Shift',
  LEFT: '左方向键',
  UP: '上方向键',
  RIGHT: '右方向键',
  DOWN: '下方向键',
};
const name = (code: number) => {
  const original = keyNames[code];
  return original
    ? (labels[original] ??
        original.replace(/^KEY_/, '').replace('NUMPAD', '小键盘 '))
    : `保存的键码 ${code}`;
};
export default function KeybindingInput({
  value,
  onChange,
  disabled,
  id,
}: {
  value: EditValue;
  onChange: (value: string) => void;
  disabled: boolean;
  id: string;
}) {
  const parts = String(value).split(',').filter(Boolean);
  const keys = [0, 1].map((i) => {
    const match = /^([0-9a-f]{2})\.([0-9a-f]{2})$/i.exec(parts[i] ?? '');
    return {
      code: match ? parseInt(match[1], 16) : 0,
      flags: match ? parseInt(match[2], 16) : 0,
    };
  });
  function update(index: number, code: number, flags: number) {
    const next = keys.map((key, i) => (i === index ? { code, flags } : key));
    onChange(
      next
        .map(
          (key) =>
            key.code.toString(16).padStart(2, '0') +
            '.' +
            key.flags.toString(16).padStart(2, '0'),
        )
        .join(','),
    );
  }
  return (
    <div className="keybinding-controls">
      {keys.map((key, i) => {
        const modifiers: [number, string][] =
          key.code >= 160
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
        const mask = modifiers.reduce((bits, [bit]) => bits | bit, 0),
          unknown = key.flags & ~mask;
        return (
          <fieldset key={i}>
            <legend>{i === 0 ? '第一按键' : '第二按键'}</legend>
            <select
              id={i === 0 ? id : id + '-secondary'}
              aria-label={i === 0 ? '第一按键' : '第二按键'}
              value={key.code}
              disabled={disabled}
              onChange={(event) =>
                update(i, Number(event.currentTarget.value), key.flags)
              }
            >
              {!keyNames[key.code] && (
                <option value={key.code}>{name(key.code)}</option>
              )}
              {Object.keys(keyNames).map((code) => (
                <option key={code} value={code}>
                  {name(Number(code))}
                </option>
              ))}
            </select>
            <div className="key-modifiers">
              {modifiers.map(([bit, label]) => (
                <label key={bit}>
                  <input
                    type="checkbox"
                    checked={!!(key.flags & bit)}
                    disabled={disabled}
                    onChange={(event) =>
                      update(
                        i,
                        key.code,
                        event.currentTarget.checked
                          ? key.flags | bit
                          : key.flags & ~bit,
                      )
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
            {!!unknown && (
              <button
                disabled={disabled}
                onClick={() => update(i, key.code, key.flags & mask)}
              >
                清除未定义修饰位
              </button>
            )}
          </fieldset>
        );
      })}
    </div>
  );
}
