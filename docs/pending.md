# Pendientes y deuda técnica

- **`vela-kit` enlazado a la carpeta local** (`link:../../../Vela Kit` en
  `packages/main` y `packages/renderer`). Cuando exista el repo en GitHub:
  cambiar a `github:IvanRosNavarro/Vela-Kit#v0.1.0`, regenerar el lockfile,
  añadir los scripts `kit:link` / `kit:unlink` y probarlos. Bloquea el merge
  de `feat/vela-kit`; el CI lo detecta.
- El tema activo está fijo a `system` → leerlo de los ajustes
  (Fase 0 - Paso 3).
- La shell no tiene CSP todavía → aplicar la de `vela-kit/security`
  (Fase 0 - Paso 3).
- Sin iconos propios ni configuración de electron-builder → Fase 1 - Paso 5.
