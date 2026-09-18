# ADR 0006 — Proyectos, registro de comandos e importación de FileZilla

- Estado: aceptado
- Fecha: 2026-09-17
- Fase: 2 — La esencia de Vela

## Contexto

Tras la v0.1.0 los sitios eran una lista plana, los atajos no existían más allá
de los del sistema y quien viene de FileZilla tenía que volver a dar de alta
todos sus servidores a mano.

## Decisión

### Proyectos, marcadores e historial
- Migración `004-projects`: tabla `projects` (anidables por `parent_id`, con
  color), `sites.project_id` con `ON DELETE SET NULL` (borrar un proyecto no
  borra sus sitios), `bookmarks` por sitio (ruta remota y, opcional, local) y
  `path_history` con tope de 200 entradas por sitio.
- El orden de proyectos y sitios usa fractional indexing. Mover un sitio entre
  proyectos y reordenarlo es una sola operación (`sites:relocate`).
- El historial se registra en main al listar un directorio remoto, no en el
  renderer.

### Comandos y atajos
- Todos los comandos se definen en `packages/main/src/commands/` con el
  `CommandRegistry` de `vela-kit`. Los atajos se enganchan con
  `attachShortcuts`; ningún componente registra teclas por su cuenta.
- Los comandos de interfaz no ejecutan nada en main: emiten
  `command:action` con un `CommandAction` tipado y el renderer lo despacha.
- La paleta tiene un atajo fijo, no reasignable (`PALETTE_SHORTCUT` en
  shared): `Ctrl+Shift+P` hasta la v1.2.0 y `Ctrl+Space` desde la v1.3.0, el
  mismo que Vela Browser. Los atajos custom se
  guardan en `shortcuts:custom`; al capturar uno nuevo en Ajustes, main
  suspende los atajos de esa ventana para que la combinación no dispare su
  comando.
- La paleta (`CommandPalette`), `formatShortcut` y `shortcutFromKeyEvent`
  viven en `vela-kit/ui` (v0.4.0), listos para Vela Browser.

### Barra de ruta
Prefijos como en la URL bar de Vela Browser: `>` comandos, `@` sitios,
`#` historial del sitio.

### Importar FileZilla
- Se lee `sitemanager.xml` (ruta por defecto del SO o fichero elegido) con
  `fast-xml-parser` (MIT) en main. Las carpetas pasan a proyectos anidados y
  las contraseñas se cifran con `SecretStore` al importar; nunca se guardan en
  claro.
- Flujo en dos pasos: vista previa (sin escribir nada) y aplicación. Los
  protocolos que Vela FTP no soporta (S3, WebDAV…) se listan como omitidos.

## Consecuencias
- Un comando nuevo aparece solo en la paleta y en Ajustes → Atajos.
- Las colisiones de atajos fallan al construir la tabla, no en silencio.
