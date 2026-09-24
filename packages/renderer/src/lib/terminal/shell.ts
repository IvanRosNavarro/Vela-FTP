/** Entrecomilla para un shell POSIX: todo literal salvo la comilla simple. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\''`)}'`;
}

/**
 * Orden para ir a una carpeta remota. Empieza por espacio para que bash y zsh
 * (con `ignorespace`) no la guarden en el historial.
 */
export function cdCommand(path: string): string {
  return ` cd -- ${shellQuote(path)}\r`;
}

/** Pegar varias líneas sin modo de pegado seguro ejecuta cada una al momento. */
export function isRiskyPaste(text: string, bracketedPasteMode: boolean): boolean {
  return !bracketedPasteMode && /[\r\n]/.test(text.replace(/[\r\n]+$/, ''));
}
