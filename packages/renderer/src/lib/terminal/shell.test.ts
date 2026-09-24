import { describe, expect, it } from 'vitest';
import { cdCommand, isRiskyPaste, shellQuote } from './shell';

describe('shellQuote', () => {
  it('deja literal cualquier carácter del shell', () => {
    expect(shellQuote('/var/www/$HOME `x` "y"')).toBe(`'/var/www/$HOME \`x\` "y"'`);
  });
  it('escapa las comillas simples', () => {
    expect(shellQuote("/srv/l'olivera")).toBe(`'/srv/l'\''olivera'`);
  });
});

describe('cdCommand', () => {
  it('va con espacio delante, -- y Intro', () => {
    expect(cdCommand('/-raro')).toBe(` cd -- '/-raro'\r`);
  });
});

describe('isRiskyPaste', () => {
  it('una línea, aunque acabe en salto, no avisa', () => {
    expect(isRiskyPaste('ls -la\n', false)).toBe(false);
  });
  it('varias líneas sin pegado seguro avisa', () => {
    expect(isRiskyPaste('rm -rf a\nls', false)).toBe(true);
    expect(isRiskyPaste('uno\r\ndos', false)).toBe(true);
  });
  it('con pegado seguro no hace falta', () => {
    expect(isRiskyPaste('rm -rf a\nls', true)).toBe(false);
  });
});
