# ADR 0004 — Shell servida por `vela-ftp://`, CSP y title bar propia

- Estado: aceptado
- Fecha: 2026-09-17
- Fase: 0 — Cimientos (Paso 3)

## Contexto

Tras el Paso 2 la shell se cargaba con `loadFile` (`file://`) sin CSP, y la
ventana usaba la barra de título y el menú nativos de Electron. Una respuesta
`file://` no lleva cabeceras, así que no hay dónde poner la CSP; además, dar por
confiable cualquier `file://` en el guard de IPC es más amplio de lo necesario.

## Decisión

### Protocolo y CSP
- **Producción**: la shell se sirve desde `vela-ftp://app/index.html`,
  registrado como esquema privilegiado (`standard`, `secure`,
  `supportFetchAPI`). El handler sirve `renderer/dist`, rechaza otros hosts y
  rutas que salgan de `dist`, y añade la CSP de producción de
  `vela-kit/security` junto a `X-Content-Type-Options` y `Referrer-Policy`.
- **Desarrollo**: la shell sale del dev server (`http://localhost:5183`) y la
  CSP de desarrollo se inyecta con `session.webRequest.onHeadersReceived`
  filtrado a ese origen.
- El guard de IPC solo confía en `vela-ftp://app/` y, en desarrollo, en el
  origen exacto del dev server. `file://` deja de ser de confianza.

### Title bar
Misma estrategia que Vela Browser (su ADR 0012), ya en `vela-kit`:
`titleBarWindowOptions` en main y `TitleBar` en el renderer.
- Windows: overlay nativo; su color lo manda el renderer vía
  `window:update-title-bar-overlay` cada vez que cambia el tema. Main crea la
  ventana con los colores del tema guardado para que no parpadee.
- macOS: `hiddenInset` y menú de aplicación mínimo (app, edición, ventana).
- Linux: barra propia con botones dibujados por el kit.
- Sin menú nativo en Windows y Linux. DevTools (`F12`, solo en desarrollo) y
  recargar interfaz (`Ctrl+Shift+R`) son comandos del registro central.

### Ajustes
`vela.db` (en `userData`) con migraciones de `vela-kit/storage`. Tabla
`settings` con valor JSON y `updated_at`. Las claves válidas y el schema de su
valor viven en `SETTING_SCHEMAS` (`shared`): el IPC rechaza claves desconocidas
y valores inválidos, y un valor corrupto en BD cae al por defecto.

## Consecuencias

- La CSP de producción viaja en la cabecera y no depende de un `<meta>`.
- **Pendiente de verificar con un binario empaquetado** (Fase 1 - Paso 5): el
  handler de `vela-ftp://` solo corre con `app.isPackaged`.
- En desarrollo Electron sigue avisando de CSP insegura: es la política de dev,
  que necesita `unsafe-eval` para el HMR de Vite. El aviso no sale empaquetado.
