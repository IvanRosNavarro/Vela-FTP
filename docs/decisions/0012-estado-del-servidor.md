# ADR 0012 — Estado del servidor bajo la terminal

- Estado: aceptado
- Fecha: 2026-09-24
- Versión: v1.10.0

## Contexto

Con la terminal SSH (ADR 0011) se echa en falta lo que da MobaXterm: ver de un
vistazo cómo va el servidor sin lanzar `top`. Lo mínimo pedido es CPU y RAM cada
segundo, sin cargar ni el servidor ni la aplicación.

## Decisión

- **Barra bajo cada terminal** (en el panel inferior o en pestaña propia) con CPU,
  RAM, disco de la carpeta del panel remoto, red, carga media y tiempo encendido.
  Ajuste `terminal:server-stats`, encendido por defecto.
- **Sin instalar nada**: un canal `exec` sobre la conexión de la propia terminal
  (sin autenticar otra vez) ejecuta un bucle de `sh` que vuelca `/proc/stat`,
  `/proc/meminfo`, `/proc/loadavg`, `/proc/uptime` y `/proc/net/dev` cada segundo.
  Solo usa órdenes internas del shell: en el servidor, el único proceso por
  segundo es el `sleep`. Va en una línea y sin comillas simples dentro de
  `sh -c '…'`, para que sirva con cualquier shell de inicio (bash, zsh, fish, csh).
- La CPU y la red salen de la **diferencia entre muestras** en el motor
  (`StatsParser`); la RAM, de `MemAvailable`, o de libre + buffers + caché en
  kernels anteriores a 3.14. La red suma todas las interfaces salvo `lo`.
- El disco es `df -Pk` de la carpeta del panel remoto cada 30 s y al cambiar de
  carpeta. La ruta va como `$0`, sin escaparla dentro del script.
- Cerrar la terminal o apagar el ajuste cierra el canal; el `echo` siguiente del
  bucle muere con SIGPIPE y no queda nada en el servidor.
- Sin `/proc` (otro sistema, shell enjaulada) o si el servidor no deja ejecutar
  órdenes, la barra lo dice en una línea en lugar de fallar.
- En la interfaz, solo la barra se vuelve a pintar con cada muestra
  (`useSyncExternalStore` sobre el runtime), no la terminal ni el store.
  Medidores de un solo tono; por encima del 85 % y del 95 %, color de aviso con
  icono, y el valor siempre en texto.

## Consecuencias
- Cada terminal con la barra usa un canal SSH más (cuenta para `MaxSessions`,
  10 por defecto en OpenSSH) y otro breve cada 30 s para el disco.
- Servidores no Linux (FreeBSD, macOS, Windows) no tienen barra. Soportarlos
  pediría otro script por sistema.
