import os from 'node:os';
import path from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import type { AuthMethod, ImportedSite, RemoteProtocol } from '@vela-ftp/shared';

/** Ubicación de sitemanager.xml según el sistema (FileZilla 3). */
export function defaultSiteManagerPath(): string {
  if (process.platform === 'win32') {
    return path.join(process.env['APPDATA'] ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'FileZilla', 'sitemanager.xml');
  }
  if (process.platform === 'darwin') return path.join(os.homedir(), '.config', 'filezilla', 'sitemanager.xml');
  return path.join(process.env['XDG_CONFIG_HOME'] ?? path.join(os.homedir(), '.config'), 'filezilla', 'sitemanager.xml');
}

// ServerProtocol de FileZilla.
const PROTOCOLS: Record<string, { protocol: RemoteProtocol; warning?: string } | null> = {
  '0': { protocol: 'ftp', warning: 'En FileZilla usaba "FTP con TLS explícito si está disponible": se importa como FTP; cámbialo a FTPS si el servidor lo admite.' },
  '1': { protocol: 'sftp' },
  '3': { protocol: 'ftps-implicit' },
  '4': { protocol: 'ftps' },
  '6': { protocol: 'ftp' },
};

// LogonType de FileZilla.
const LOGON: Record<string, AuthMethod> = {
  '0': 'anonymous',
  '1': 'password',
  '2': 'password', // preguntar contraseña
  '3': 'password', // interactivo
  '4': 'password', // cuenta
  '5': 'key',
  '6': 'password', // perfil
};

type XmlNode = Record<string, unknown>;

export interface ParsedServer {
  site: ImportedSite;
  /** Contraseña en claro si FileZilla la guardaba en base64; nunca sale de main. */
  password: string | null;
}

export interface ParseResult {
  servers: ParsedServer[];
  skipped: Array<{ name: string; reason: string }>;
}

function text(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object') {
    const t = (value as XmlNode)['#text'];
    return t === undefined ? '' : String(t);
  }
  return String(value);
}

function asArray(value: unknown): XmlNode[] {
  if (value === undefined || value === null) return [];
  return (Array.isArray(value) ? value : [value]) as XmlNode[];
}

/**
 * Decodifica una ruta serializada de FileZilla (CServerPath): `tipo
 * longitudPrefijo [prefijo] (longitud segmento)*`. `1 0 3 var 3 www` → `/var/www`.
 */
export function decodeServerPath(serialized: string): string | null {
  const s = serialized.trim();
  if (!s) return null;
  let pos = 0;
  const readInt = (): number | null => {
    while (s[pos] === ' ') pos++;
    const start = pos;
    while (pos < s.length && s[pos] !== ' ') pos++;
    const n = Number(s.slice(start, pos));
    return Number.isInteger(n) && n >= 0 ? n : null;
  };
  const readChunk = (len: number): string | null => {
    if (s[pos] === ' ') pos++;
    if (pos + len > s.length) return null;
    const chunk = s.slice(pos, pos + len);
    pos += len;
    return chunk;
  };
  if (readInt() === null) return null; // tipo de servidor
  const prefixLen = readInt();
  if (prefixLen === null) return null;
  if (prefixLen > 0 && readChunk(prefixLen) === null) return null;
  const segments: string[] = [];
  while (pos < s.length) {
    const len = readInt();
    if (len === null) return null;
    const segment = readChunk(len);
    if (segment === null) return null;
    segments.push(segment);
  }
  return `/${segments.join('/')}`;
}

function parseServer(node: XmlNode, key: string, projectName: string | null): ParsedServer | { skipped: { name: string; reason: string } } {
  const name = text(node['Name']) || text(node['#text']) || text(node['Host']);
  const protocolInfo = PROTOCOLS[text(node['Protocol']) || '0'];
  if (!protocolInfo) {
    return { skipped: { name, reason: 'Protocolo no soportado (S3, WebDAV u otro)' } };
  }
  const host = text(node['Host']).trim();
  if (!host) return { skipped: { name, reason: 'Sin servidor' } };

  const warnings: string[] = [];
  if (protocolInfo.warning) warnings.push(protocolInfo.warning);

  let auth = LOGON[text(node['Logontype']) || '1'] ?? 'password';
  if (auth === 'key' && protocolInfo.protocol !== 'sftp') auth = 'password';
  if (text(node['Logontype']) === '2') warnings.push('FileZilla pedía la contraseña al conectar: tendrás que escribirla en el sitio.');

  let password: string | null = null;
  const passNode = node['Pass'];
  if (passNode !== undefined) {
    const encoding = typeof passNode === 'object' ? String((passNode as XmlNode)['@_encoding'] ?? '') : '';
    const raw = text(passNode);
    if (encoding === 'crypt') {
      warnings.push('La contraseña está cifrada con la contraseña maestra de FileZilla y no se puede importar.');
    } else if (raw) {
      password = encoding === 'base64' ? Buffer.from(raw, 'base64').toString('utf8') : raw;
    }
  }

  const port = Number(text(node['Port'])) || (protocolInfo.protocol === 'sftp' ? 22 : protocolInfo.protocol === 'ftps-implicit' ? 990 : 21);
  const keyPath = text(node['Keyfile']) || null;
  if (auth === 'key' && !keyPath) {
    auth = 'agent';
    warnings.push('Sin fichero de clave: se usará el agente SSH.');
  }

  return {
    site: {
      key,
      name: name.slice(0, 200),
      projectName,
      protocol: protocolInfo.protocol,
      host,
      port: port >= 1 && port <= 65535 ? port : 21,
      username: auth === 'anonymous' ? '' : text(node['User']),
      auth,
      keyPath: auth === 'key' ? keyPath : null,
      remotePath: decodeServerPath(text(node['RemoteDir'])),
      localPath: text(node['LocalDir']) || null,
      notes: text(node['Comments']).slice(0, 4000),
      hasPassword: password !== null,
      warnings,
    },
    password,
  };
}

/** Lee un sitemanager.xml de FileZilla 3. Las carpetas se convierten en proyectos. */
export function parseSiteManager(xml: string): ParseResult {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    parseTagValue: false,
    trimValues: true,
    isArray: (name) => name === 'Server' || name === 'Folder',
  });
  const doc = parser.parse(xml) as XmlNode;
  const root = (doc['FileZilla3'] as XmlNode | undefined)?.['Servers'] as XmlNode | undefined;
  const result: ParseResult = { servers: [], skipped: [] };
  if (!root) return result;

  let counter = 0;
  const walk = (node: XmlNode, trail: string[]) => {
    for (const server of asArray(node['Server'])) {
      const parsed = parseServer(server, String(counter++), trail.length ? trail.join(' / ') : null);
      if ('skipped' in parsed) result.skipped.push(parsed.skipped);
      else result.servers.push(parsed);
    }
    for (const folder of asArray(node['Folder'])) {
      const name = text(folder['#text']).trim() || 'Carpeta';
      walk(folder, [...trail, name]);
    }
  };
  walk(root, []);
  return result;
}
