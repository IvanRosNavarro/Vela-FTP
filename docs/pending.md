# Pendientes y deuda técnica

- `packages/main/src/logger.ts` es copia del de Vela Browser → sustituir por
  `vela-kit/logger` (Fase 0 - Paso 2).
- `packages/renderer/src/index.css` define un subconjunto de tokens del tema
  oscuro a mano → sustituir por `vela-kit/theme` (Fase 0 - Paso 2).
- La shell no tiene CSP todavía → aplicar la de `vela-kit/security`
  (Fase 0 - Paso 3).
- Sin iconos propios ni configuración de electron-builder → Fase 1 - Paso 5.
