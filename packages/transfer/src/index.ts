// Entrada del utilityProcess de transferencias. Solo habla con main por parentPort.
import { TransferEngine } from './engine';

const port = process.parentPort;
if (!port) {
  throw new Error('El motor de transferencias debe ejecutarse como utilityProcess');
}

const engine = new TransferEngine({
  send: (message) => port.postMessage(message),
});

port.on('message', (event) => {
  void engine.handle(event.data);
});

process.on('uncaughtException', (err) => {
  // No se puede usar el logger de main aquí: se reenvía como línea de log.
  port.postMessage({
    kind: 'event',
    name: 'log',
    payload: { sessionId: '*', level: 'error', message: `[motor] ${err.stack ?? err.message}`, at: Date.now() },
  });
});
