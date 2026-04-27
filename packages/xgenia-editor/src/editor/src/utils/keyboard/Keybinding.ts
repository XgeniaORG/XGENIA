import { KeyCode, KeyMod } from '@xgenia-utils/keyboard/KeyCode';
import { KeyCodeUtils } from '@xgenia-utils/keyboard/KeyCodeMapper';
import { KeyModUtils } from '@xgenia-utils/keyboard/KeyModMapper';

const KeyMods = Object.keys(KeyMod) as unknown as number[];

export class Keybinding {
  private _hash: number;
  private _label: string;

  get hash() {
    return this._hash;
  }

  get label() {
    return this._label;
  }

  constructor(...keys: (KeyMod | KeyCode)[]) {
    this._hash = keys.reduce((r, c) => r | c, 0);
    this._label = keys
      .map((key) => {
        const modifier = KeyMods.find((mod: number) => key & mod);
        if (modifier) return KeyModUtils.toString(modifier);
        return KeyCodeUtils.toString(key as KeyCode);
      })
      .join('+');
  }
}
