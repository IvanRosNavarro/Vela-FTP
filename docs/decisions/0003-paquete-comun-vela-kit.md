# ADR 0003 — Paquete común `vela-kit`

- Estado: propuesto (forma de distribución pendiente)
- Fecha: 2026-09-17
- Fase: 0 — Cimientos (Paso 2)

## Contexto

Vela FTP quiere la misma identidad que Vela Browser: temas `--vela-*`, title
bar por plataforma, Command Palette, registro de comandos y atajos, toasts,
validación de IPC, logger y política de CSP. Copiar ese código a cada app
haría que divergiera desde el primer día. Habrá más aplicaciones de la familia.

## Decisión

Crear `vela-kit` como **repo propio**, con licencia GPL-3.0-only, consumido
por Vela Browser, Vela FTP y las futuras apps. Módulos iniciales:

| Módulo | Contenido | Proceso |
|---|---|---|
| `theme` | tokens, temas builtin, `ThemeManager`, validador CSS, logo | renderer |
| `ipc` | `validateIpc`, `guardTrustedFrame`, `IpcResult`, errores tipados | main |
| `logger` | logger con rotación diaria, nombre de fichero configurable | main |
| `commands` | registro central y `ShortcutTable`, sin definiciones de producto | main |
| `ui` | toasts, `fuzzy`, Command Palette, title bar, ErrorBoundary | renderer |
| `security` | CSP dev/prod | main |

Reglas:

- El kit no conoce ningún producto: nada de "tabs", "workspaces" ni "sitios".
  Lo específico se inyecta por parámetros o registros.
- Se publica compilado (JS + `.d.ts`), con versionado semántico.
- `react` y `electron` son `peerDependencies`.
- Cambios que rompan la API exigen versión mayor y adopción coordinada.

## Pendiente de decidir

Cómo se distribuye para que el CI de cada repo pueda instalarlo sin clonar
otros repos:

1. **npm público** (recomendado): CI sin tokens. Requiere cuenta npm y un scope libre.
2. **Dependencia git por tag**: sin registro, pero instalaciones más lentas
   y con aristas en pnpm.
3. **GitHub Packages**: exige token incluso para instalar paquetes públicos,
   en local y en CI.

También hay que decidir si será un único paquete con subpaths
(`kit/theme`, `kit/ipc`…) o un paquete por módulo.
