export function isTextField(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

/** Pintasan `c` (WCAG 2.1.4): mati bila fokus di field teks, ada modifier, atau dialog terbuka. */
export function shouldOpenCatat(e: KeyboardEvent, doc: Document = document): boolean {
  if (e.key !== 'c' || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return false;
  if (isTextField(e.target)) return false;
  return doc.querySelector('[role="dialog"]') === null;
}
