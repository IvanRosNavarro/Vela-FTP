// TODO(deuda): copia del logger de Vela Browser; pasa a vela-kit en Fase 0 - Paso 2.
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const MAX_DAILY_FILES = 7;

interface LoggerState {
  logDir: string;
  logFile: string;
  rotateDate: string;
  stream: fs.WriteStream | null;
  minLevel: LogLevel;
}

let state: LoggerState | null = null;

function todayStr(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function ensureStream(s: LoggerState): fs.WriteStream {
  if (s.stream) return s.stream;
  s.stream = fs.createWriteStream(s.logFile, { flags: 'a' });
  return s.stream;
}

function cleanupOldLogs(s: LoggerState): void {
  let archived: string[];
  try {
    archived = fs
      .readdirSync(s.logDir)
      .filter((f) => /^vela-ftp\.\d{4}-\d{2}-\d{2}\.log$/.test(f))
      .sort();
  } catch {
    return;
  }
  while (archived.length > MAX_DAILY_FILES) {
    const oldest = archived.shift();
    if (!oldest) break;
    try {
      fs.unlinkSync(path.join(s.logDir, oldest));
    } catch {
      // ignorar; el siguiente intento ya volverá a por él
    }
  }
}

function rotateIfNeeded(s: LoggerState): void {
  const today = todayStr();
  if (today === s.rotateDate) return;
  if (s.stream) {
    s.stream.end();
    s.stream = null;
  }
  if (fs.existsSync(s.logFile)) {
    const archive = path.join(s.logDir, `vela-ftp.${s.rotateDate}.log`);
    try {
      fs.renameSync(s.logFile, archive);
    } catch {
      // si no se puede mover (otro proceso lo tiene abierto, etc.) seguimos
      // escribiendo en vela-ftp.log; la rotación se reintentará la próxima vez
    }
  }
  s.rotateDate = today;
  cleanupOldLogs(s);
}

function formatArg(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return `${value.name}: ${value.message}\n${value.stack ?? ''}`;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function formatLine(level: LogLevel, message: string, args: unknown[]): string {
  const ts = new Date().toISOString();
  const tail = args.length === 0 ? '' : ' ' + args.map(formatArg).join(' ');
  return `${ts} [${level.toUpperCase().padEnd(5)}] ${message}${tail}`;
}

function consoleFn(level: LogLevel): (...args: unknown[]) => void {
  if (level === 'error') return console.error.bind(console);
  if (level === 'warn') return console.warn.bind(console);
  if (level === 'debug') return console.debug.bind(console);
  return console.log.bind(console);
}

function write(level: LogLevel, message: string, args: unknown[]): void {
  if (!state) {
    consoleFn(level)(`[pre-init][${level.toUpperCase()}]`, message, ...args);
    return;
  }
  if (LEVEL_RANK[level] < LEVEL_RANK[state.minLevel]) return;
  rotateIfNeeded(state);
  const line = formatLine(level, message, args);
  ensureStream(state).write(line + '\n');
  if (!app.isPackaged) {
    consoleFn(level)(line);
  }
}

export interface InitLoggerOptions {
  minLevel?: LogLevel;
}

export function initLogger(opts: InitLoggerOptions = {}): void {
  if (state) return;
  const logDir = app.getPath('logs');
  fs.mkdirSync(logDir, { recursive: true });
  const minLevel = opts.minLevel ?? (app.isPackaged ? 'info' : 'debug');
  state = {
    logDir,
    logFile: path.join(logDir, 'vela-ftp.log'),
    rotateDate: todayStr(),
    stream: null,
    minLevel,
  };
  cleanupOldLogs(state);
}

export function closeLogger(): void {
  if (!state?.stream) return;
  state.stream.end();
  state.stream = null;
}

export const logger: Logger = {
  debug: (msg, ...args) => write('debug', msg, args),
  info: (msg, ...args) => write('info', msg, args),
  warn: (msg, ...args) => write('warn', msg, args),
  error: (msg, ...args) => write('error', msg, args),
};
