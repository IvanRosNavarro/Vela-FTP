import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ConnectionConfig, TerminalOutput } from '@vela-ftp/shared';
import { TransferEngine } from './engine';
import type { TerminalPort } from './terminal/SshTerminal';
import { removeDir } from './test/ftpServer';
import { startSftpServer, type TestSftpServer } from './test/sftpServer';

const USER = 'vela';
const PASS = 's3cret';

let root: string;
let srv: TestSftpServer;
let config: ConnectionConfig;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'vela-term-srv-'));
  srv = await startSftpServer(root, USER, PASS);
  config = {
    protocol: 'sftp',
    host: '127.0.0.1',
    port: srv.port,
    username: USER,
    auth: 'password',
    password: PASS,
    trustedFingerprints: [srv.fingerprint],
    timeoutMs: 5000,
  };
});

afterAll(async () => {
  await srv.close();
  await removeDir(root);
});

/** Extremo del renderer simulado: guarda lo que llega y deja enviar mensajes. */
function fakePort() {
  const received: TerminalOutput[] = [];
  let toEngine: ((data: unknown) => void) | null = null;
  let onClose: (() => void) | null = null;
  const state = { closed: false };
  const port: TerminalPort = {
    postMessage: (message) => {
      if (!state.closed) received.push(message);
    },
    onMessage: (listener) => {
      toEngine = listener;
    },
    onClose: (listener) => {
      onClose = listener;
    },
    close: () => {
      state.closed = true;
    },
  };
  const text = () =>
    Buffer.concat(received.filter((m) => m.t === 'data').map((m) => Buffer.from((m as { data: Uint8Array }).data))).toString('utf8');
  return {
    port,
    received,
    state,
    text,
    send: (message: unknown) => toEngine?.(message),
    closeFromRenderer: () => {
      state.closed = true;
      onClose?.();
    },
  };
}

async function waitFor(predicate: () => boolean, ms = 5000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 10));
  }
}

async function openSession(engine: TransferEngine, sessionId: string, c: ConnectionConfig = config): Promise<void> {
  await engine.call('session.open', { sessionId, config: c, maxTransferConnections: 1 });
}

describe('terminal SSH', () => {
  it('abre un shell con pty, lleva la entrada y la salida y avisa al salir', async () => {
    const engine = new TransferEngine({ send: () => undefined });
    await openSession(engine, 's1');
    const p = fakePort();
    await engine.call('terminal.open', { terminalId: 't1', sessionId: 's1', cols: 100, rows: 30 }, [p.port]);

    await waitFor(() => p.text().includes('bienvenido'));
    expect(srv.ptySizes.at(-1)).toMatchObject({ cols: 100, rows: 30, term: 'xterm-256color' });

    p.send({ t: 'data', data: 'hola ñandú\r' });
    await waitFor(() => p.text().includes('eco:hola ñandú'));

    p.send({ t: 'resize', cols: 120, rows: 40 });
    await waitFor(() => srv.ptySizes.at(-1)?.cols === 120);
    expect(srv.ptySizes.at(-1)).toMatchObject({ cols: 120, rows: 40 });

    // Un mensaje mal formado se ignora sin romper la terminal.
    p.send({ t: 'data', data: 42 });
    p.send({ t: 'data', data: 'exit\r' });
    await waitFor(() => p.state.closed);
    expect(p.received.at(-1)).toEqual({ t: 'exit', code: 3, signal: null });
    engine.dispose();
  });

  it('cerrar la sesión cierra sus terminales', async () => {
    const engine = new TransferEngine({ send: () => undefined });
    await openSession(engine, 's2');
    const p = fakePort();
    await engine.call('terminal.open', { terminalId: 't2', sessionId: 's2', cols: 80, rows: 24 }, [p.port]);
    await waitFor(() => p.text().includes('bienvenido'));

    await engine.call('session.close', { sessionId: 's2' });
    expect(p.state.closed).toBe(true);
    expect(p.received.at(-1)).toMatchObject({ t: 'lost' });
    engine.dispose();
  });

  it('el renderer puede cerrar la terminal cerrando su puerto', async () => {
    const engine = new TransferEngine({ send: () => undefined });
    await openSession(engine, 's3');
    const p = fakePort();
    await engine.call('terminal.open', { terminalId: 't3', sessionId: 's3', cols: 80, rows: 24 }, [p.port]);
    await waitFor(() => p.text().includes('bienvenido'));
    p.closeFromRenderer();
    // Ya no está entre las de la sesión: cerrarla no vuelve a tocar el puerto.
    await engine.call('session.close', { sessionId: 's3' });
    expect(p.received.some((m) => m.t === 'lost' || m.t === 'exit')).toBe(false);
    engine.dispose();
  });

  it('rechaza sesiones inexistentes y cierra el puerto', async () => {
    const engine = new TransferEngine({ send: () => undefined });
    const p = fakePort();
    await expect(engine.call('terminal.open', { terminalId: 't4', sessionId: 'nada', cols: 80, rows: 24 }, [p.port])).rejects.toMatchObject({
      code: 'NOT_CONNECTED',
    });
    expect(p.state.closed).toBe(true);
    engine.dispose();
  });

  it('no registra en el log lo que se teclea', async () => {
    const lines: string[] = [];
    const engine = new TransferEngine({
      send: (msg) => {
        if (msg.kind === 'event' && msg.name === 'log') lines.push((msg.payload as { message: string }).message);
      },
    });
    await openSession(engine, 's5');
    const p = fakePort();
    await engine.call('terminal.open', { terminalId: 't5', sessionId: 's5', cols: 80, rows: 24 }, [p.port]);
    p.send({ t: 'data', data: 'contraseña-secreta\r' });
    await waitFor(() => p.text().includes('eco:contraseña-secreta'));
    p.send({ t: 'data', data: 'exit\r' });
    await waitFor(() => p.state.closed);
    expect(lines.some((l) => l.startsWith('[term#'))).toBe(true);
    expect(lines.join('\n')).not.toContain('contraseña-secreta');
    engine.dispose();
  });
});

describe('estado del servidor', () => {
  it('con el monitor encendido llegan CPU, RAM, red y el disco de la carpeta', async () => {
    const engine = new TransferEngine({ send: () => undefined });
    await openSession(engine, 's6');
    const p = fakePort();
    await engine.call('terminal.open', { terminalId: 't6', sessionId: 's6', cols: 80, rows: 24 }, [p.port]);
    p.send({ t: 'disk-path', path: '/var/www' });
    p.send({ t: 'monitor', enabled: true });

    await waitFor(() => p.received.some((m) => m.t === 'stats' && m.stats.cpu !== null));
    const stats = p.received.filter((m) => m.t === 'stats').at(-1) as Extract<TerminalOutput, { t: 'stats' }>;
    expect(stats.stats).toMatchObject({ cores: 2, memTotal: 1000 * 1024, memUsed: 600 * 1024, load: [0.5, 0.4, 0.3] });
    expect(stats.stats.cpu).toBeCloseTo(50);
    expect(stats.stats.rxRate).toBeGreaterThan(0);

    await waitFor(() => p.received.some((m) => m.t === 'disk'));
    expect(p.received.find((m) => m.t === 'disk')).toEqual({ t: 'disk', disk: { path: '/var/www', mount: '/', total: 2000 * 1024, used: 500 * 1024 } });
    expect(srv.execs.some((c) => c.endsWith("'/var/www'"))).toBe(true);

    // Apagarlo corta el envío.
    p.send({ t: 'monitor', enabled: false });
    await new Promise((r) => setTimeout(r, 150));
    const count = p.received.length;
    await new Promise((r) => setTimeout(r, 200));
    expect(p.received.length).toBe(count);
    engine.dispose();
  });

  it('en un servidor sin /proc avisa de que no está disponible', async () => {
    srv.noProc = true;
    try {
      const engine = new TransferEngine({ send: () => undefined });
      await openSession(engine, 's7');
      const p = fakePort();
      await engine.call('terminal.open', { terminalId: 't7', sessionId: 's7', cols: 80, rows: 24 }, [p.port]);
      p.send({ t: 'monitor', enabled: true });
      await waitFor(() => p.received.some((m) => m.t === 'stats-unavailable'));
      expect(p.received.find((m) => m.t === 'stats-unavailable')).toEqual({ t: 'stats-unavailable', reason: 'El servidor no da su estado (solo Linux, y sin shell enjaulada)' });
      engine.dispose();
    } finally {
      srv.noProc = false;
    }
  });
});
