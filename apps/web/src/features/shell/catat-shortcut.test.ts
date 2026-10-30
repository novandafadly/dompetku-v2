import { describe, expect, it } from 'vitest';
import { isTextField, shouldOpenCatat } from './catat-shortcut';

function pressC(target: HTMLElement): KeyboardEvent {
  document.body.append(target);
  let seen!: KeyboardEvent;
  const on = (e: Event) => {
    seen = e as KeyboardEvent;
  };
  document.addEventListener('keydown', on, { once: true });
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', bubbles: true }));
  target.remove();
  return seen;
}

describe('pintasan c', () => {
  it('input dan textarea dianggap field teks', () => {
    expect(isTextField(document.createElement('input'))).toBe(true);
    expect(isTextField(document.createElement('textarea'))).toBe(true);
    expect(isTextField(document.createElement('select'))).toBe(true);
  });

  it('contenteditable dianggap field teks', () => {
    const div = document.createElement('div');
    div.contentEditable = 'true';
    // happy-dom tidak selalu menghitung isContentEditable dari atribut
    Object.defineProperty(div, 'isContentEditable', { value: true });
    expect(isTextField(div)).toBe(true);
  });

  it('tombol dan tubuh halaman bukan field teks', () => {
    expect(isTextField(document.createElement('button'))).toBe(false);
    expect(isTextField(document.body)).toBe(false);
    expect(isTextField(null)).toBe(false);
  });

  it('c di dalam input tidak membuka Catat', () => {
    expect(shouldOpenCatat(pressC(document.createElement('input')))).toBe(false);
    expect(shouldOpenCatat(pressC(document.createElement('textarea')))).toBe(false);
  });

  it('c di tombol membuka Catat; dengan modifier atau dialog terbuka tidak', () => {
    expect(shouldOpenCatat(pressC(document.createElement('button')))).toBe(true);
    expect(shouldOpenCatat(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true }))).toBe(false);
    const dlg = document.createElement('div');
    dlg.setAttribute('role', 'dialog');
    document.body.append(dlg);
    expect(shouldOpenCatat(pressC(document.createElement('button')))).toBe(false);
    dlg.remove();
  });
});
