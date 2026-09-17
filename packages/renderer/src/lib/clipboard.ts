/**
 * Copia texto al portapapeles. `navigator.clipboard` exige foco y permiso en
 * Electron; `execCommand` sobre un textarea temporal funciona siempre en la shell.
 */
export function writeClipboardText(text: string): void {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  document.execCommand('copy');
  area.remove();
}
