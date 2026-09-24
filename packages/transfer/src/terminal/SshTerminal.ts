import type { Client, ClientChannel } from 'ssh2';
import { terminalInputSchema, type ConnectionConfig, type TerminalOutput } from '@vela-ftp/shared';
import type { LogSink } from '../fs/RemoteFs';
import { connectSsh, mapSshError } from '../fs/sshConnect';
import { ServerMonitor } from './serverStats';

/** Extremo del MessagePort de una terminal, visto desde el motor. */
export interface TerminalPort {
  postMessage(message: TerminalOutput): void;
  onMessage(listener: (data: unknown) => void): void;
  onClose(listener: () => void): void;
  close(): void;
}

/**
 * Una terminal SSH: conexión propia con un canal `shell` y pty. La entrada y la
 * salida van por el puerto sin pasar por main. Nunca se registra lo que viaja
 * por ella: ahí se teclean contraseñas de `sudo`.
 */
export class SshTerminal {
  private conn: Client | null = null;
  private stream: ClientChannel | null = null;
  private finished = false;
  private exit: { code: number | null; signal: string | null } = { code: null, signal: null };
  /** Salida pendiente de enviar: se agrupa por vuelta del bucle de eventos. */
  private pending: Buffer[] = [];
  private flushScheduled = false;
  private monitor: ServerMonitor | null = null;
  private diskPath: string | null = null;

  constructor(
    readonly id: string,
    readonly sessionId: string,
    private readonly port: TerminalPort,
    private readonly log: LogSink,
    private readonly onFinished: (terminal: SshTerminal) => void,
  ) {
    port.onClose(() => this.close());
  }

  async open(config: ConnectionConfig, cols: number, rows: number): Promise<void> {
    const conn = await connectSsh(config, this.log);
    this.conn = conn;
    // El renderer pudo cerrar la terminal mientras se conectaba.
    if (this.finished) {
      conn.end();
      return;
    }
    let stream: ClientChannel;
    try {
      stream = await new Promise<ClientChannel>((resolve, reject) =>
        conn.shell({ term: 'xterm-256color', cols, rows }, (err, channel) => (err ? reject(err) : resolve(channel))),
      );
    } catch (err) {
      conn.end();
      throw mapSshError(err);
    }
    if (this.finished) {
      stream.close();
      conn.end();
      return;
    }
    this.stream = stream;
    this.log('info', `Terminal abierta (${cols}×${rows})`);

    stream.on('data', (chunk: Buffer) => this.push(chunk));
    stream.stderr.on('data', (chunk: Buffer) => this.push(chunk));
    stream.on('exit', (code: number | null, signal?: string) => {
      this.exit = { code: typeof code === 'number' ? code : null, signal: signal ?? null };
    });
    stream.on('close', () => this.finish({ t: 'exit', ...this.exit }));
    conn.on('error', (err) => this.log('error', err.message));
    conn.on('close', () => this.finish({ t: 'lost', message: 'Conexión SSH cerrada' }));
    this.port.onMessage((raw) => this.onInput(raw));
  }

  private onInput(raw: unknown): void {
    const parsed = terminalInputSchema.safeParse(raw);
    if (!parsed.success) {
      this.log('error', 'Mensaje de terminal no válido');
      return;
    }
    const message = parsed.data;
    const stream = this.stream;
    if (!stream || this.finished) return;
    switch (message.t) {
      case 'data':
        stream.write(Buffer.from(message.data, 'utf8'));
        return;
      case 'binary':
        stream.write(Buffer.from(message.data, 'latin1'));
        return;
      case 'resize':
        stream.setWindow(message.rows, message.cols, 0, 0);
        return;
      case 'close':
        this.close();
        return;
      case 'monitor':
        this.setMonitor(message.enabled);
        return;
      case 'disk-path':
        this.diskPath = message.path;
        this.monitor?.setDiskPath(message.path);
        return;
    }
  }

  /** Estado del servidor por un canal aparte de la misma conexión. */
  private setMonitor(enabled: boolean): void {
    if (!enabled) {
      this.monitor?.stop();
      this.monitor = null;
      return;
    }
    if (this.monitor || !this.conn) return;
    const send = (message: TerminalOutput) => {
      if (!this.finished) this.port.postMessage(message);
    };
    this.monitor = new ServerMonitor(this.conn, {
      stats: (stats) => send({ t: 'stats', stats }),
      disk: (disk) => send({ t: 'disk', disk }),
      unavailable: (reason) => {
        this.monitor = null;
        send({ t: 'stats-unavailable', reason });
      },
    });
    this.monitor.setDiskPath(this.diskPath);
    this.monitor.start();
  }

  private push(chunk: Buffer): void {
    this.pending.push(chunk);
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    setImmediate(() => this.flush());
  }

  private flush(): void {
    this.flushScheduled = false;
    if (this.pending.length === 0) return;
    // Copia exacta: un Buffer del pool arrastraría su ArrayBuffer entero al clonarse.
    const data = Uint8Array.from(Buffer.concat(this.pending));
    this.pending = [];
    this.port.postMessage({ t: 'data', data });
  }

  private finish(last: Extract<TerminalOutput, { t: 'exit' | 'lost' }>): void {
    if (this.finished) return;
    this.finished = true;
    this.monitor?.stop();
    this.monitor = null;
    this.flush();
    this.port.postMessage(last);
    this.port.close();
    this.stream = null;
    this.conn?.end();
    this.conn = null;
    this.log('info', last.t === 'exit' ? 'Terminal cerrada' : `Terminal perdida: ${last.message}`);
    this.onFinished(this);
  }

  /** Cierra la terminal desde la app (sesión cerrada, puerto cerrado o petición del usuario). */
  close(message = 'Sesión cerrada'): void {
    if (this.finished) return;
    if (!this.stream) {
      // Aún conectando: `open` cerrará la conexión al terminar.
      this.finished = true;
      this.port.close();
      this.onFinished(this);
      return;
    }
    this.finish({ t: 'lost', message });
  }
}
