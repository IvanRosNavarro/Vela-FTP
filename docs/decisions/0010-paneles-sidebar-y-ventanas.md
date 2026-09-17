# ADR 0010 — Sidebar reducible, reparto de paneles, carpeta local por pestaña y varias ventanas

- Estado: aceptado
- Fecha: 2026-09-18
- Versión: v1.1.0

## Contexto

La interfaz repartía el ancho a partes iguales y sin poder tocarlo, la lista de
sitios ocupaba siempre lo mismo, la carpeta local era una sola para todas las
pestañas y solo se podía tener una ventana abierta.

## Decisión

### Sidebar reducible
- Botón en la cabecera (a la izquierda del de proyecto nuevo) y su gemelo para
  volver a abrirla. El estado vive en `ui:sidebar-collapsed`, ajuste de este
  equipo (no se sincroniza).
- Reducida son 44 px fijos: cada sitio es un icono, agrupado por proyecto con
  una línea de su color, y el tooltip da nombre, host y protocolo. En ese modo
  **no hay barra de redimensionar**: no hay nada que ajustar.
- Clic en un icono conecta; el clic derecho abre el mismo menú que en el árbol.

### Iconos por protocolo
Un servidor con el matiz de su protocolo (`SiteIcon`): SFTP con engranaje (va
por SSH), FTPS con candado (va por TLS) y FTP liso. El color sigue indicando si
está conectado. Se usan en los dos modos de la sidebar.

### Reparto de los paneles
Barra arrastrable entre el panel local y el remoto, **en proporción**: al
cambiar el tamaño de la ventana cada panel conserva su parte. Límites 15 %–85 %,
doble clic para igualarlos, flechas del teclado para afinar. Se guarda en
`ui:panes-ratio`.

### Carpeta local por pestaña
Como FileZilla: las claves de panel pasan de `local` a `local:<sessionId>`, así
que cada pestaña recuerda su carpeta local además de la remota, con su propia
selección y su propio scroll. Sin ninguna conexión sigue existiendo el panel
`local` suelto. Una pestaña nueva parte de la carpeta local del sitio si la
tiene, y si no de la que se estuviera viendo.

**Al recorrer los paneles hay que preguntar por `isRemotePane(key)`**, nunca
comparar con `'local'`, y el otro lado de un panel es siempre el de su misma
sesión (`sessionOfPane`).

### Varias ventanas
- Comando «Nueva ventana» (Ctrl+Shift+N) y, al volver a lanzar Vela FTP, se
  abre otra ventana en vez de solo enfocar la que había. El enlace de
  vinculación de la sincronización sigue yendo a la ventana de delante.
- **Cada conexión pertenece a la ventana que la abrió** (`windowSessions.ts`):
  al cerrarla se sueltan solo sus conexiones. La cola de transferencias, en
  cambio, es única para toda la aplicación.

### Barra de título
Icono y nombre a la izquierda, buscador que abre la paleta en el centro y, solo
mientras hay transferencias, cuántas van, a qué velocidad y un hilo de progreso
al pie de la barra. Clic en ese contador abre o cierra la cola.

## Consecuencias
- Un ajuste de interfaz nuevo debe añadirse a `LOCAL_ONLY_SETTINGS` si depende
  de la pantalla o del equipo, o viajará por sincronización.
- La cola muestra las transferencias de todas las ventanas; separarla por
  ventana queda pendiente si algún día molesta.
