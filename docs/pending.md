# Pendientes y deuda técnica

- Title bar sin probar en macOS ni Linux (solo Windows en local; el CI compila
  en los tres).
- Firma de código: Authenticode (Windows) y notarización (macOS) cuando haya
  certificados. Hasta entonces SmartScreen y Gatekeeper avisarán.
- Actualizaciones en macOS: Squirrel.Mac exige binario firmado, así que
  `canInstall` es false y solo se abre la página de la release. Quitar la
  excepción en `main/src/updater/index.ts` al firmar.
- `.ppk` v3 de PuTTY sin probar con una clave real (ssh2 soporta v2).
- Modo FTP activo (post-1.0).
- Arrastrar ficheros remotos al explorador del SO (requiere descargar antes a
  una carpeta temporal).
- Mover ficheros arrastrando dentro del mismo panel.
