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
- Ficheros abiertos con el programa del sistema: se dejan de vigilar al cerrar
  Vela FTP y la copia temporal se borra en el siguiente arranque. Un guardado
  hecho con Vela FTP cerrado no se sube.
- Sincronización: el historial de rutas y la cola de transferencias no viajan
  (son de cada equipo). Tampoco hay resolución de conflictos manual: gana la
  modificación más reciente.
- Arrastrar ficheros remotos al explorador del SO (requiere descargar antes a
  una carpeta temporal).
- Mover ficheros arrastrando dentro del mismo panel.
- Vigilancia de carpetas: no propaga borrados ni sobrevive a un reinicio.
- Los paneles no se refrescan solos con cambios del disco local ni al crear
  carpetas remotas desde la vigilancia.
- Primer arranque en dev: una vez el preload sandboxed falló con
  `binding.startupData` nulo (fallo de Electron, no reproducido al relanzar).
