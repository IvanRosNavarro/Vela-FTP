// Configuración de electron-builder. CJS para poder leer process.env en build.
// El repositorio del publish se controla con GITHUB_REPO=owner/repo.

const DEFAULT_REPO = 'IvanRosNavarro/Vela-FTP';
const repoSlug = process.env.GITHUB_REPO || DEFAULT_REPO;
const [owner, repo] = repoSlug.split('/');
if (!owner || !repo) {
  throw new Error(`GITHUB_REPO debe tener formato "owner/repo". Recibido: "${repoSlug}"`);
}

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'com.vela.ftp',
  productName: 'Vela FTP',
  copyright: 'Copyright (C) 2026 Vela FTP contributors. Licensed under GPL-3.0-only.',

  directories: {
    output: 'release/${version}',
    buildResources: 'build',
  },

  // El icono de ventana (Linux) se lee de process.resourcesPath/build/icon.png.
  extraResources: [{ from: 'build', to: 'build', filter: ['icon.png'] }],

  // Empezar con todo y restar: listar solo rutas positivas deja fuera los
  // node_modules (lección de Vela Browser v0.0.1).
  files: [
    '**/*',
    '!**/*.{md,ts,tsx,map}',
    '!**/node_modules/**/*.{md,ts,tsx,map}',
    '!**/node_modules/**/{test,tests,__tests__,example,examples}/**',
    '!**/node_modules/**/.bin/**',
    '!packages/*/src/**',
    '!packages/*/node_modules/**',
    '!packages/*/tsconfig*.json',
    '!packages/*/vite*.config.*',
    '!packages/*/vitest.config.*',
    '!packages/*/postcss.config.*',
    '!packages/*/tailwind.config.*',
    '!packages/renderer/index.html',
    '!packages/shared/**',
    '!scripts/**',
    '!release/**',
    '!docs/**',
    '!build/**',
    '!.github/**',
    '!.claude/**',
    '!**/tsconfig*.json',
    '!**/{.editorconfig,.nvmrc,.gitattributes}',
    '!**/{CLAUDE,FASE_ACTUAL,ROADMAP}.md',
    '!electron-builder.config.cjs',
    '!pnpm-lock.yaml',
    '!pnpm-workspace.yaml',
  ],

  asar: true,
  // Sin módulos nativos propios: node:sqlite es parte de Electron y ssh2 funciona
  // sin sus opcionales nativos (cpu-features), que además no compilan con
  // espacios en la ruta.
  npmRebuild: false,

  // Endurecimiento del binario: que no se pueda usar como un Node genérico
  // (ELECTRON_RUN_AS_NODE, NODE_OPTIONS, --inspect) ni cargar código fuera del
  // asar firmado.
  electronFuses: {
    runAsNode: false,
    enableCookieEncryption: true,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
    grantFileProtocolExtraPrivileges: false,
  },

  win: {
    target: [{ target: 'nsis', arch: ['x64', 'arm64'] }],
    artifactName: 'Vela-FTP-Setup-${version}-${arch}.${ext}',
    ...(process.env.WIN_CERT_PATH
      ? {
          certificateFile: process.env.WIN_CERT_PATH,
          certificatePassword: process.env.WIN_CERT_PASSWORD,
          signingHashAlgorithms: ['sha256'],
        }
      : {}),
  },

  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    perMachine: false,
    deleteAppDataOnUninstall: false,
  },

  mac: {
    target: [{ target: 'dmg', arch: ['x64', 'arm64'] }],
    category: 'public.app-category.developer-tools',
    artifactName: 'Vela-FTP-${version}-${arch}.${ext}',
    // Sin Apple Developer Program todavía: binario sin firmar ni notarizar.
    identity: process.env.APPLE_IDENTITY || null,
    hardenedRuntime: !!process.env.APPLE_IDENTITY,
    gatekeeperAssess: false,
    ...(process.env.APPLE_TEAM_ID ? { notarize: { teamId: process.env.APPLE_TEAM_ID } } : {}),
  },

  linux: {
    target: [
      { target: 'AppImage', arch: ['x64'] },
      { target: 'deb', arch: ['x64'] },
    ],
    category: 'Network',
    maintainer: 'Iván Ros <it@tcgfactory.com>',
    artifactName: 'Vela-FTP-${version}-${arch}.${ext}',
  },

  publish: {
    provider: 'github',
    owner,
    repo,
    releaseType: 'release',
  },
};
