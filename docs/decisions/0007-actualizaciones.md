# ADR 0007 — Actualizaciones con electron-updater

- Estado: aceptado
- Fecha: 2026-09-17
- Fase: adelantado de la Fase 4 a la v0.2.1

## Contexto

El roadmap dejaba el actualizador para la Fase 4. Cada release publicada sin
él deja a quien la instale sin enterarse de las siguientes: las versiones
anteriores a la primera que lo incluya no se actualizarán nunca solas.

## Decisión

- `electron-updater` (MIT) contra GitHub Releases, igual que Vela Browser. Va
  en el `package.json` raíz y como `external` en el build de main.
- `UpdateService` (`packages/main/src/updater/`) es la fuente de verdad: mantiene
  un `UpdateStatus` y lo emite completo en `state:updates-changed`. Recibe el
  `autoUpdater` inyectado para testearlo sin Electron.
- **Nunca descarga sola** (`autoDownload = false`): una descarga de ~100 MB no
  debe competir sin avisar con una transferencia grande. Lo descargado se
  instala al cerrar la app o con «Reiniciar e instalar», que avisa si hay
  transferencias en curso (la cola persistente permite reanudarlas).
- Comprobación a los 10 s de arrancar y cada 4 h, desactivable con
  `updates:auto-check`. En desarrollo el estado es `unsupported` y no se
  consulta nada.
- Interfaz: comando «Buscar actualizaciones», sección Ajustes → Acerca de,
  aviso persistente en la title bar y un toast por versión nueva.
- **macOS**: Squirrel.Mac solo instala binarios firmados. Hasta firmar,
  `canInstall = false` y se ofrece abrir la página de la release.

## Consecuencias

- Las versiones anteriores a la v0.2.1 hay que actualizarlas a mano una vez.
- Verificado con un binario de Windows empaquetado como 0.1.9: detecta la
  0.2.0 publicada, la descarga con progreso y la instala al cerrar.
