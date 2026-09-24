// Entrada del utilityProcess de transferencias. Solo habla con main por parentPort.
import { TransferEngine } from './engine';
import type { TerminalPort } from './terminal/SshTerminal';

const port = process.parentPort;
if (!port) {
  throw new Error('El motor de transferencias debe ejecutarse como utilityProcess');
}

const engine = new TransferEngine({
  send: (message) => port.postMessage(message),
});

/** Adapta un MessagePortMain (el de una terminal) a lo que espera el motor. */
function terminalPort(p: Electron.MessagePortMain): TerminalPort {
  return {
    postMessage: (message) => p.postMessage(message),
    onMessage: (listener) => {
      p.on('message', (event) => listener(event.data));
      p.start();
    },
    onClose: (listener) => p.on('close', listener),
    close: () => p.close(),
  };
}

port.on('message', (event) => {
  void engine.handle(event.data, event.ports.map(terminalPort));
});

process.on('uncaughtException', (err) => {
  // No se puede usar el logger de main aquí: se reenvía como línea de log.
  port.postMessage({
    kind: 'event',
    name: 'log',
    payload: { sessionId: '*', level: 'error', message: `[motor] ${err.stack ?? err.message}`, at: Date.now() },
  });
});
