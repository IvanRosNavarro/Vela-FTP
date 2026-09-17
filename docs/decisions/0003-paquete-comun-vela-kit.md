# ADR 0003 — Paquete común `vela-kit`

- Estado: aceptado
- Fecha: 2026-09-17
- Fase: 0 — Cimientos (Paso 2)

## Contexto

Vela FTP quiere la misma identidad que Vela Browser: temas `--vela-*`, title
bar por plataforma, Command Palette, registro de comandos y atajos, toasts,
validación de IPC, logger y política de CSP. Copiar ese código a cada app
haría que divergiera desde el primer día. Habrá más aplicaciones de la familia.

## Decisión

Crear `vela-kit` como **repo propio** (`C:\Ivan\Repos\github\Vela Kit`), con
licencia GPL-3.0-only, consumido por Vela Browser, Vela FTP y futuras apps.

### Forma

**Un único paquete con subpaths**: `vela-kit/theme`, `vela-kit/logger`,
`vela-kit/ipc`… Una sola versión que publicar y adoptar.

| Módulo | Contenido | Proceso | Estado |
|---|---|---|---|
| `theme` | tokens, 8 temas builtin, `ThemeManager`, validador CSS | renderer | v0.1.0 |
| `logger` | logger con rotación diaria, nombre de fichero configurable | main | v0.1.0 |
| `ipc` | `IpcResponse`, `validatePayload` (zod), `createFrameGuard`, errores tipados | main | v0.1.0 |
| `commands` | `CommandRegistry` genérico, `ShortcutTable`, `attachShortcuts` | main | v0.2.0 |
| `ui` | toasts, `Toaster`, `fuzzy`, `ErrorBoundary` | renderer | v0.2.0 |
| `ui` (2ª parte) | Command Palette, title bar por plataforma, logo | renderer | cuando Vela FTP los necesite |
| `security` | bases de CSP dev/prod, `extendCsp`, `buildCspHeader` | main | v0.2.0 |

### Distribución

**Dependencia git fijada a un tag**, no npm. Publicar en npm un único
paquete para dos consumidores propios no compensa.

- Se distribuye como **TypeScript fuente**, sin build. Los consumidores ya
  compilan con Vite y comprueban con `tsc`, que resuelven los `exports` `.ts`
  sin configuración extra.
- Dependencia: `"vela-kit": "github:IvanRosNavarro/Vela-Kit#vX.Y.Z"`. El
  lockfile fija el commit exacto: un tag movido no cambia nada hasta
  reinstalar a propósito.
- Probado con pnpm 9.12: resolución del tag a commit, typecheck y build de
  Vite de un consumidor.

### Desarrollo en paralelo

- `pnpm kit:link [ruta]` sustituye el enlace `node_modules/vela-kit` de cada
  paquete consumidor por una junction a la copia local (por defecto
  `../Vela Kit`). Un cambio en el kit se ve en el siguiente build o recarga,
  sin tag. `pnpm kit:unlink` (o cualquier `pnpm install`) lo devuelve al tag.
- No se usa `pnpm link`: reescribe `pnpm-lock.yaml` y `pnpm unlink` falla
  dentro de un workspace. El CI conserva un guard por si un lockfile llega con
  `vela-kit` apuntando a `link:`.
- El renderer declara `resolve.dedupe` para `react`, `react-dom` y `zustand`, y
  añade la carpeta real del kit a `server.fs.allow` para que el
  dev server de Vite pueda servirla estando enlazada.
- Probado en Vela FTP: con el kit enlazado un cambio aparece en el build; tras
  `kit:unlink` el build vuelve al tag y el lockfile queda intacto.

## Reglas del kit

- Agnóstico de producto: nada de pestañas, workspaces, sitios ni `window.api`.
  Lo específico entra por parámetros, callbacks o registros.
- Los módulos de renderer no importan `electron` ni `node:*`.
- `electron`, `react` y `zod` son `peerDependencies`.
- Versionado semántico; romper la API exige versión mayor y adopción
  coordinada.

## Consecuencias

- Un cambio en el kit llega a una app solo cuando esa app sube el tag, igual
  que con un registro.
- Sin paso de build ni de publicación en el kit.
- El kit debe compilar con el `tsconfig.base.json` estricto de la familia.
- Si el repo del kit fuera privado, el CI de las apps necesitaría token; debe
  ser público, como Vela Browser.
