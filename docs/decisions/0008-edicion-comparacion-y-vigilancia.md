# ADR 0008 — Edición remota, comparación de carpetas y vigilancia

- Estado: aceptado
- Fecha: 2026-09-17
- Fase: 3 — Productividad

## Contexto

Editar un fichero del servidor obligaba a bajarlo, abrirlo fuera y volver a
subirlo. Tampoco había forma de ver qué difiere entre una carpeta local y su
copia remota, ni de mantenerla al día mientras se trabaja.

## Decisión

### Motor
- `file.fetch` y `file.store`: ficheros sueltos fuera de la cola, en una
  conexión de transferencia (no bloquean la navegación). `file.store` con
  `expected` falla con `REMOTE_CHANGED` si el remoto ya no tiene el tamaño y la
  fecha que se leyeron.
- **Se conservan las fechas de modificación** al subir y al bajar (`utimes`
  local; `utimes` por SFTP; `MFMT` en FTP si el servidor lo anuncia, en otro
  caso se omite). Sin esto, comparar por fecha marcaría todo lo transferido
  como más nuevo.
- **Permisos en SFTP**: `ssh2` hace `fchmod` con `0o666` al abrir un fichero
  para escribir. Se le pasa el modo del fichero existente o `0o644` si es
  nuevo. Hasta la v0.2.1 toda subida SFTP dejaba el fichero escribible por
  cualquier usuario del servidor.

### Editor y diff
- Ventana propia (`createShellWindow` con `?view=editor&id=`) con Monaco (MIT)
  cargado bajo demanda y sus workers empaquetados por Vite: nada se carga de
  fuera y la CSP no cambia.
- `EditorManager` en main: copia en `temp/vela-ftp/{edit,diff,preview}/<uuid>`
  que se borra al cerrar la ventana y, al arrancar, cualquier resto. Solo la
  ventana dueña del documento puede leerlo o guardarlo.
- Tope de 5 MB y solo texto (`BINARY_FILE` si hay NUL). Se conserva el BOM.
- Guardar sin sesión abierta usa otra sesión del mismo sitio o una temporal.
- Cerrar con cambios: main cancela el cierre y la ventana pregunta con su
  propio diálogo (guardar, descartar o seguir).

### Vista previa
Espacio sobre un fichero: imágenes como `data:` (hasta 20 MB) y texto en Monaco
de solo lectura (primer MB). Del local se lee solo el principio.

### Comparación y navegación sincronizada
- En el renderer, sobre los listados ya cargados: por nombre (sensible a
  mayúsculas), fecha con tolerancia de un minuto (LIST sin MLSD) y tamaño.
- Navegación sincronizada: se fijan las carpetas actuales como base y se sigue
  la ruta relativa en los dos sentidos; salir de la base la desactiva.
- Atajos de FileZilla: Ctrl+O y Ctrl+Y.

### Vigilancia de carpetas
- `WatchManager` con chokidar (MIT): lo que se crea o cambia se encola como
  subida con `overwrite`; las carpetas nuevas se crean antes. No se sube lo que
  ya había, **no se propagan borrados** y se ignoran temporales de editores y
  del sistema.
- Dura mientras la app esté abierta; si la sesión se cierra, se reutiliza una
  nueva del mismo sitio.

## Consecuencias
- Tras editar desde Vela FTP el remoto queda más nuevo que la copia local, que
  es lo correcto.
- Propagar borrados queda fuera a propósito: un fallo ahí borra en producción.
