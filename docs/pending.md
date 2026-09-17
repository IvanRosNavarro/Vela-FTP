# Pendientes y deuda técnica

- Verificar con un binario empaquetado el protocolo `vela-ftp://` y la CSP de
  producción (ADR 0004) → Fase 1 - Paso 5.
- Sin iconos propios ni configuración de electron-builder → Fase 1 - Paso 5.
- Selector de tema provisional en la sidebar (`ThemeSelect.tsx`) → sustituir
  por ajustes y Command Palette (Fase 2).
- Title bar sin probar en macOS ni Linux (solo Windows en local; el CI compila
  en los tres).
- Firma de código: Authenticode (Windows) y notarización (macOS) cuando haya
  certificados. Hasta entonces SmartScreen y Gatekeeper avisarán.
- `.ppk` v3 de PuTTY sin probar con una clave real (ssh2 soporta v2).
- Modo FTP activo (post-1.0).
- Arrastrar ficheros remotos al explorador del SO (requiere descargar antes a
  una carpeta temporal).
- Mover ficheros arrastrando dentro del mismo panel.
