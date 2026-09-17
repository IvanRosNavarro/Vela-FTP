import { PREVIEW_TEXT_BYTES, type FilePreview } from '@vela-ftp/shared';

const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  // En un <img> un SVG no ejecuta scripts.
  svg: 'image/svg+xml',
};

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

export function imageMimeType(name: string): string | null {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? null : (IMAGE_TYPES[name.slice(dot + 1).toLowerCase()] ?? null);
}

/** Un NUL en los primeros bytes: lo mismo que usan git y grep para decidir. */
export function isProbablyBinary(buffer: Buffer): boolean {
  return buffer.subarray(0, 8000).includes(0);
}

export interface DecodedText {
  text: string;
  /** Tenía BOM UTF-8: hay que conservarlo al guardar. */
  bom: boolean;
}

export function decodeText(buffer: Buffer): DecodedText {
  const bom = buffer.subarray(0, 3).equals(UTF8_BOM);
  return { text: (bom ? buffer.subarray(3) : buffer).toString('utf8'), bom };
}

export function encodeText(text: string, bom: boolean): Buffer {
  const body = Buffer.from(text, 'utf8');
  return bom ? Buffer.concat([UTF8_BOM, body]) : body;
}

/**
 * Vista previa de un fichero. `buffer` puede ser solo el principio del fichero
 * (`size` es el tamaño real) salvo para imágenes, que necesitan el contenido entero.
 */
export function buildPreview(name: string, buffer: Buffer, size: number): FilePreview {
  const mime = imageMimeType(name);
  if (mime && buffer.length === size) {
    return { kind: 'image', name, size, dataUrl: `data:${mime};base64,${buffer.toString('base64')}` };
  }
  if (isProbablyBinary(buffer)) return { kind: 'binary', name, size };
  const truncated = size > PREVIEW_TEXT_BYTES || buffer.length > PREVIEW_TEXT_BYTES;
  let { text } = decodeText(truncated ? buffer.subarray(0, PREVIEW_TEXT_BYTES) : buffer);
  // El corte puede partir un carácter multibyte.
  if (truncated) text = text.replace(/�+$/, '');
  return { kind: 'text', name, size, content: text, truncated };
}
