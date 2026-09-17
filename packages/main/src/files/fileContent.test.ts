import { describe, expect, it } from 'vitest';
import { PREVIEW_TEXT_BYTES } from '@vela-ftp/shared';
import { buildPreview, decodeText, encodeText, imageMimeType, isProbablyBinary } from './fileContent';

describe('fileContent', () => {
  it('reconoce imágenes por extensión', () => {
    expect(imageMimeType('Logo.PNG')).toBe('image/png');
    expect(imageMimeType('icono.svg')).toBe('image/svg+xml');
    expect(imageMimeType('script.js')).toBeNull();
    expect(imageMimeType('sin-extension')).toBeNull();
  });

  it('distingue binario de texto', () => {
    expect(isProbablyBinary(Buffer.from('hola\nmundo'))).toBe(false);
    expect(isProbablyBinary(Buffer.from([0x89, 0x50, 0x00, 0x47]))).toBe(true);
  });

  it('conserva el BOM al decodificar y volver a codificar', () => {
    const original = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('ñandú', 'utf8')]);
    const decoded = decodeText(original);
    expect(decoded).toEqual({ text: 'ñandú', bom: true });
    expect(encodeText(decoded.text, decoded.bom).equals(original)).toBe(true);
    expect(decodeText(Buffer.from('a')).bom).toBe(false);
  });

  it('construye la vista previa según el contenido', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    expect(buildPreview('a.png', png, png.length)).toMatchObject({ kind: 'image', dataUrl: 'data:image/png;base64,iVBORw==' });
    expect(buildPreview('a.bin', Buffer.from([1, 0, 2]), 3)).toEqual({ kind: 'binary', name: 'a.bin', size: 3 });
    expect(buildPreview('a.txt', Buffer.from('hola'), 4)).toEqual({ kind: 'text', name: 'a.txt', size: 4, content: 'hola', truncated: false });
  });

  it('recorta el texto largo sin dejar medio carácter', () => {
    // 'é' ocupa dos bytes: el corte cae en medio del último.
    const big = Buffer.from('é'.repeat(PREVIEW_TEXT_BYTES / 2) + 'x', 'utf8');
    const preview = buildPreview('grande.txt', Buffer.concat([Buffer.from('a'), big]), big.length + 1);
    expect(preview.kind).toBe('text');
    if (preview.kind !== 'text') return;
    expect(preview.truncated).toBe(true);
    expect(preview.content.endsWith('�')).toBe(false);
    expect(Buffer.byteLength(preview.content)).toBeLessThanOrEqual(PREVIEW_TEXT_BYTES);
  });
});
