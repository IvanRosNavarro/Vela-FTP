# ADR 0002 — Licencia GPL-3.0-only

- Estado: aceptado
- Fecha: 2026-09-17
- Fase: 0 — Cimientos (Paso 1)

## Contexto

Vela Browser se distribuye bajo GPL-3.0-only (su ADR 0004). Vela FTP comparte
con él el paquete `vela-kit`, que nace de código del navegador.

## Decisión

Vela FTP se distribuye bajo **GPL-3.0-only**, con la misma política de
dependencias que el navegador:

- **Compatibles**: MIT, Apache-2.0, BSD-2/3, ISC, MPL-2.0, LGPL, GPL-3.0+,
  GPL-2.0+ ("or later"), Unlicense.
- **No compatibles** sin ADR de excepción: GPL-2.0-only, AGPL sin "or later",
  Patron-License, BSL, CC-BY-NC, "source available", licencias de pago.

Dependencias de protocolo previstas: `basic-ftp` (MIT), `ssh2` (MIT),
`chokidar` (MIT), `monaco-editor` (MIT).

## Consecuencias

- Mismo criterio de revisión en los dos productos.
- `vela-kit` puede llevar la misma licencia sin fricción.
