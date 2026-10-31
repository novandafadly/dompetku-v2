export type ThemeChoice = 'dark' | 'light' | 'system';

export const THEME_KEY = 'dompetku-theme';

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return value === 'dark' || value === 'light' || value === 'system';
}

/**
 * Dijalankan inline di <head> sebelum cat pertama (tanpa kilasan gelap di ?theme=light).
 * Urutan: ?theme=light|dark, lalu pilihan tersimpan, lalu gelap. CSP situs hanya frame-ancestors.
 */
export const themeBootScript = `(function(){var d=document.documentElement,t=null;try{var p=new URLSearchParams(location.search).get('theme');if(p==='light'||p==='dark')t=p;else{var s=localStorage.getItem('${THEME_KEY}');if(s==='light'||s==='dark'||s==='system')t=s;}}catch(e){}d.dataset.theme=t||'dark';})();`;

/** Pilihan di Menu: disimpan (bila penyimpanan tersedia) dan langsung ditulis ke <html>. */
export function applyTheme(choice: ThemeChoice): void {
  document.documentElement.dataset.theme = choice;
  try {
    localStorage.setItem(THEME_KEY, choice);
  } catch {
    // Mode privat atau penyimpanan diblokir: pilihan berlaku sampai halaman dimuat ulang.
  }
}

export function currentTheme(): ThemeChoice {
  const value = document.documentElement.dataset.theme;
  return isThemeChoice(value) ? value : 'dark';
}
