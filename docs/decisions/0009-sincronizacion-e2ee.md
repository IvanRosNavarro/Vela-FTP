# ADR 0009 — Sincronización E2EE sobre el servidor de Vela

- Estado: aceptado
- Fecha: 2026-09-17
- Fase: 4 — Sync y pulido (v1.0.0)

## Contexto

Quien usa Vela FTP en dos equipos tenía que dar de alta los servidores dos
veces. Vela Browser ya tiene un servidor de sincronización en
`sync.vela-browser.com` con cuentas por enlace mágico y cifrado de extremo a
extremo, y el usuario quiere una única cuenta para las dos aplicaciones.

## Decisión

### Servidor compartido, particiones separadas
- Misma cuenta y mismo servidor. Vela FTP registra su **propio perfil remoto**,
  reconocible porque su nombre cifrado lleva `{"app":"vela-ftp"}`: así no baja
  las entidades del navegador ni al revés.
- Tipos propios con prefijo: `ftp.project`, `ftp.site`, `ftp.site_secret`,
  `ftp.bookmark`, `ftp.known_host` y `ftp.setting`, añadidos al allowlist del
  servidor.
- El enlace mágico recuerda de qué app salió (columna `app` en
  `magic_link_tokens`) y devuelve a `vela-ftp://sync-callback` o a
  `vela://sync-callback`. Sin `app` se asume el navegador: los clientes
  anteriores no lo mandan.

### Cifrado
- `vela-kit/crypto`: scrypt (N=32768, r=8, p=1) y AES-256-GCM, los mismos
  parámetros que el navegador.
- **El salt lo custodia el servidor** (`POST /sync/key-salt`): con salts
  distintos, la misma contraseña daría claves distintas y el descifrado
  fallaría en el otro equipo.
- La clave vive en memoria y, cifrada con el llavero del SO, en `app_metadata`
  para no pedir la contraseña en cada arranque. El token de sesión, igual.
  Nada de esto pasa por la tabla `settings`, que el renderer puede escribir.

### Qué viaja
- Las contraseñas de los sitios van en una entidad aparte (`ftp.site_secret`),
  no dentro del sitio: así desactivar la categoría «Contraseñas» deja de
  enviarlas sin mutilar el resto.
- Los ajustes de este equipo no viajan: rutas locales, tamaños de panel,
  actualizaciones automáticas y la bienvenida.
- Se filtra en los dos sentidos —al enviar y al recibir—; si solo se filtrara
  al enviar, los demás dispositivos seguirían metiendo aquí lo desactivado.
  Al reactivar una categoría se pone `last-seq` a 0 para releer lo que pasó de
  largo.

### Conflictos y fallos
- Last-write-wins por `updated_at`; en empate gana lo local.
- Todo lo que llega se valida con zod antes de tocar la base de datos: el
  E2EE protege del servidor, no de un cliente con un fallo.
- Un marcador cuyo sitio aún no ha llegado se descarta (la clave foránea lo
  exige) y vuelve en la siguiente pasada completa.
- Sin red, los cambios se encolan en `sync_pending` y salen al reconectar;
  el WebSocket reintenta con espera creciente hasta 60 s.

## Consecuencias
- El servidor no puede leer nada: ni nombres de servidor, ni rutas, ni
  contraseñas. Si el usuario olvida la contraseña de sincronización, lo
  sincronizado es irrecuperable; la interfaz lo advierte.
- Verificado con dos instancias contra el servidor en local: alta, alta de un
  segundo dispositivo, propagación en los dos sentidos, borrados, huellas de
  host, filtrado por categorías, cola offline y reanudación tras reiniciar.
