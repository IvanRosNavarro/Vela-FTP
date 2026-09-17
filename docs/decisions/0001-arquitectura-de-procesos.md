# ADR 0001 — Arquitectura de procesos

- Estado: aceptado
- Fecha: 2026-09-17
- Fase: 0 — Cimientos (Paso 1)

## Contexto

Vela FTP hereda la arquitectura de Vela Browser (main como fuente de verdad,
renderer solo UI, preload como única barrera). A diferencia del navegador,
el trabajo pesado no lo hace Chromium sino nuestro propio código: transferir
ficheros de varios GB, listar directorios con decenas de miles de entradas y
mantener varias conexiones abiertas a la vez.

El proceso main accede a SQLite con `node:sqlite`, que es síncrono. Si las
transferencias vivieran ahí, cada escritura de progreso y cada chunk
competirían con los handlers IPC y la interfaz se congelaría.

## Decisión

Cuatro procesos lógicos:

| Proceso | Responsabilidad |
|---|---|
| **main** | Fuente de verdad: SQLite, sitios, credenciales, comandos, ventanas, IPC con el renderer. |
| **transfer** (`utilityProcess`) | Conexiones FTP/FTPS/SFTP, pool por servidor, cola, progreso. No toca SQLite. |
| **preload** | `contextBridge` con API limitada. Ventana principal con `sandbox: true`. |
| **renderer** | React + Zustand. Solo UI. |

- main ↔ transfer por `MessagePort`, con mensajes tipados y validados con zod
  en `shared/`.
- Las credenciales se descifran en main y viajan a transfer solo en el momento
  de abrir la conexión; transfer no las persiste.
- El progreso se agrega en transfer y se emite a main como máximo cada 100 ms
  por transferencia; main lo reenvía al renderer.
- Si transfer muere, main lo relanza y marca las transferencias en curso como
  interrumpidas (reanudables).

## Consecuencias

- La UI no se bloquea aunque haya muchas transferencias.
- Un fallo en una librería de protocolo no tumba la aplicación.
- Coste: un protocolo de mensajes más que mantener y probar.
- A diferencia del navegador, no hay `WebContentsView`: menús, popovers y
  modales son DOM normal, sin overlays ni `BrowserWindow` popup.
