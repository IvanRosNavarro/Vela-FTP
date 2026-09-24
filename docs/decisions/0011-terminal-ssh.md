# ADR 0011 — Terminal SSH integrada

- Estado: aceptado
- Fecha: 2026-09-24
- Versión: v1.9.0

## Contexto

Quien trabaja por SFTP suele necesitar además una shell en el mismo servidor
(reiniciar un servicio, ver un log, cambiar permisos en bloque) y tenía que
abrir otro programa. `ssh2` ya estaba para SFTP, con huellas, agente, claves y
secretos cifrados: solo faltaba pedir un canal `shell`.

## Decisión

### Alcance
- **Solo terminal remota por SSH**, en sitios SFTP. Una terminal local
  necesitaría `node-pty`, nativo y a recompilar por cada Electron y plataforma,
  y romperíamos la línea de «sin compilación nativa».
- El nombre se queda en **Vela FTP**: la terminal complementa la sesión, no
  cambia lo que es la aplicación. Renombrar movería `appId`, la carpeta de
  datos, el protocolo `vela-ftp://` y el canal de actualizaciones.

### Motor
- Cada terminal abre **su propia conexión SSH** con la configuración de su
  sesión (`SessionPool.config`), con pty `xterm-256color`. Así se mantiene la
  regla del pool (una conexión, operaciones en serie) y una terminal colgada no
  afecta a la navegación. La conexión y la verificación de huella son las de
  SFTP (`fs/sshConnect.ts`).
- Cerrar la sesión cierra sus terminales; si el motor se reinicia, mueren con él
  y el renderer las quita al marcar la sesión como perdida.

### Tráfico
- La entrada y la salida van por un **MessagePort directo entre el renderer y el
  motor**. main crea el `MessageChannelMain` al atender `terminal:open`, pasa un
  extremo al motor con la petición `terminal.open` y el otro a la ventana que la
  pidió (`state:terminal-port`). Después no ve el tráfico.
- El puerto se queda en el preload: el renderer usa `api.terminal.write`,
  `listen`, `resize` y `close`. El motor valida cada mensaje con zod
  (`terminalInputSchema`) y agrupa la salida por vuelta del bucle de eventos.
- **Nada de lo que pasa por la terminal va al registro de protocolo**: solo
  conexión, apertura y cierre (`[term#n]`). Ahí se teclean contraseñas de `sudo`.

### Interfaz
- Cada terminal es una **pestaña del panel inferior**, detrás de Cola,
  Fallidas, Completadas, Vigilancia y Registro, y se puede **llevar a una
  pestaña propia** junto a las sesiones y devolverla. El xterm vive fuera de
  React (`lib/terminal/runtime.ts`) y su elemento se mueve de un sitio a otro,
  así que no se pierden ni la conexión ni lo que había en pantalla. xterm
  (MIT) se carga aparte, al abrir la primera terminal.
- «Abrir terminal aquí» en el panel remoto y el botón «Ir a la carpeta del panel
  remoto» escriben `cd -- '<ruta>'` precedido de espacio (fuera del historial
  con `ignorespace`). Al abrir, la orden espera a que el servidor deje de
  escribir para no duplicar el eco.
- Al terminar el shell o caer la conexión, Intro abre otra en la misma pestaña.

### Teclado
- Con una terminal enfocada, el renderer lo avisa (`terminal:focus`) y main deja
  pasar a la página las teclas con atajo de la app, salvo la paleta, cambiar de
  sesión, `terminal.toggle` (Ctrl+`), `terminal.new` (Ctrl+Shift+`), ventana
  nueva y DevTools (`TERMINAL_KEEPS`).
- Copiar con Ctrl+Shift+C o Ctrl+C con selección; pegar con Ctrl+Shift+V (y
  Ctrl+V en Windows); buscar con Ctrl+Shift+F. En macOS, ⌘.
- Pegar varias líneas sin pegado seguro (*bracketed paste*) pide confirmación.
- Los enlaces se abren en el navegador tras confirmar, y solo `http`/`https`.
- xterm no implementa OSC 52: el servidor no puede escribir en el portapapeles.

## Consecuencias
- Un comando nuevo cuyo atajo deba funcionar dentro de la terminal se añade a
  `TERMINAL_KEEPS`.
- Una terminal cuenta como una conexión SSH más frente al `MaxSessions` y los
  límites del servidor.
- Ajustes: `terminal:font-size`, `terminal:font-family` (de este equipo) y
  `terminal:scrollback`.
