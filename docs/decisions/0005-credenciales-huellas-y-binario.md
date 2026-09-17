# ADR 0005 — Credenciales, huellas de servidor y endurecimiento del binario

- Estado: aceptado
- Fecha: 2026-09-17
- Fase: 1 — MVP (Pasos 2 y 5)

## Credenciales

- Cada secreto (contraseña, passphrase) se cifra con **AES-256-GCM** usando
  una clave de datos aleatoria de 32 bytes (`SecretStore`). Formato:
  `versión(1) | iv(12) | tag(16) | cifrado`.
- La clave de datos se guarda envuelta en `app_metadata`:
  - **Llavero del SO** (`safeStorage`: DPAPI, Keychain, libsecret/kwallet) por
    defecto. En Linux, si Electron cae al backend `basic_text` (clave fija), se
    considera que no hay llavero y se exige contraseña maestra.
  - **Contraseña maestra** opcional: derivación **scrypt** (N=2^17, r=8, p=1,
    parámetros OWASP), sal de 16 bytes. Con ella la app arranca bloqueada.
- **Por qué no Argon2id**: `crypto.argon2` existe en el Node 24 de Electron 42,
  pero su crypto es BoringSSL y lanza "Argon2 algorithm not supported". Lo
  destaparon los tests al ejecutarse con el runtime real de Electron
  (`scripts/electron-node.mjs`). scrypt es nativo, no añade dependencias y es
  el KDF que ya usa el sync de Vela Browser.
- Cambiar o quitar la contraseña maestra no re-cifra los secretos: solo
  cambia cómo se guarda la clave de datos, en una transacción.
- Los secretos se descifran en main solo al abrir una sesión y viajan al motor
  de transferencias en memoria; el motor no los persiste ni los registra.

## Huellas de servidor

- `known_hosts` propio en `vela.db`, por host y puerto:
  - SSH: huella `SHA256:…` estilo OpenSSH con el tipo de clave.
  - TLS: `tls:` + huella SHA-256 del certificado.
- SFTP: clave desconocida → diálogo "servidor desconocido"; clave distinta a la
  guardada → diálogo de aviso fuerte que, si se acepta, **sustituye** la huella
  del mismo tipo.
- FTPS: el certificado se comprueba **antes de enviar credenciales**. Si una CA
  lo valida, se acepta sin preguntar; si no, solo con la huella confiada.

## Binario

- `npmRebuild: false`: no hay módulos nativos propios. `ssh2` funciona sin su
  opcional nativo (`cpu-features`), que además no compila con espacios en la
  ruta del proyecto.
- **Fuses de Electron** en el binario empaquetado: sin `RunAsNode`, sin
  `NODE_OPTIONS`, sin `--inspect`, solo carga la app desde el `asar`, con
  validación de integridad del `asar` y cifrado de cookies. Comprobado: con
  `ELECTRON_RUN_AS_NODE=1` el ejecutable ya no se comporta como Node.
- Firma de código pendiente (Windows Authenticode y notarización de macOS),
  configurables por variables de entorno cuando haya certificados.
