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
- Sacar ficheros de Vela FTP al escritorio pide Ctrl+arrastrar (Option en
  macOS). `startDrag` cancela el arrastre HTML5 y deja a la propia ventana
  fuera como destino (electron#7118), así que el arrastre normal se reserva
  para mover entre paneles. El modificador no puede ser cualquiera: al soltar,
  el Explorador interpreta Alt como «crear acceso directo» y rechaza el drop
  porque solo ofrecemos copia; Ctrl pide copia y lo acepta.
- Arrastrar un remoto fuera va en dos pasos: el primer arrastre lo baja a un
  temporal y el segundo ya lo saca. El arrastre nativo exige el fichero en
  disco y Electron no expone la entrega diferida de Windows. Solo ficheros
  sueltos, no carpetas.
- Mientras dura un arrastre hacia fuera, el proceso main se queda dentro del
  bucle de arrastre de Windows y no atiende IPC. Solo dura el gesto.
- Mover ficheros arrastrando dentro del mismo panel.
- Vigilancia de carpetas: no propaga borrados ni sobrevive a un reinicio.
- Los paneles no se refrescan solos con cambios del disco local ni al crear
  carpetas remotas desde la vigilancia.
- Primer arranque en dev: una vez el preload sandboxed falló con
  `binding.startupData` nulo (fallo de Electron, no reproducido al relanzar).
- Marcadores creados entre la v1.1.0 y la v1.7.1: se guardaron sin carpeta
  local (buscaban el panel `local` cuando ya era `local:<sessionId>`), así que
  al abrirlos el panel local no se mueve. No se reparan solos; hay que volver
  a crearlos.
