import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { IPC_EVENTS, type JobSnapshot } from '@vela-ftp/shared';
import { QueueMirror, type QueueMirrorDeps } from './QueueMirror';

vi.mock('vela-kit/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

function snap(id: string, sessionId: string, status: JobSnapshot['status'] = 'queued'): JobSnapshot {
  return {
    id,
    sessionId,
    direction: 'download',
    localPath: `/l/${id}`,
    remotePath: `/r/${id}`,
    isDirectory: false,
    conflictPolicy: 'ask',
    parentId: null,
    status,
    size: null,
    transferred: 0,
    speed: 0,
    attempts: 0,
    error: null,
    createdAt: 0,
    startedAt: null,
    finishedAt: null,
  } as JobSnapshot;
}

function setup(restored: JobSnapshot[] = []) {
  const events = new EventEmitter();
  const owners = new Map<string, number>([
    ['a', 1],
    ['b', 2],
  ]);
  const sent: { windowId: number; event: string; payload: unknown }[] = [];
  const deps: QueueMirrorDeps = {
    transfer: { on: (event: string, fn: (p: unknown) => void) => (events.on(event, fn), () => undefined) } as unknown as QueueMirrorDeps['transfer'],
    repo: { loadInterrupted: () => restored, save: vi.fn(), delete: vi.fn() },
    siteIdForSession: () => 'site',
    windowForSession: (sessionId) => owners.get(sessionId) ?? null,
    sendTo: (windowId, event, payload) => void sent.push({ windowId, event, payload }),
    broadcast: vi.fn(),
  };
  const mirror = new QueueMirror(deps);
  return { events, owners, sent, mirror, deps };
}

describe('QueueMirror', () => {
  it('cada ventana recibe y ve solo los trabajos de sus sesiones', () => {
    const { events, sent, mirror } = setup();
    events.emit('queue.updated', { jobs: [snap('j1', 'a'), snap('j2', 'b')], removedIds: [] });

    expect(sent).toEqual([
      { windowId: 1, event: IPC_EVENTS.QUEUE_UPDATED, payload: { jobs: [snap('j1', 'a')], removedIds: [] } },
      { windowId: 2, event: IPC_EVENTS.QUEUE_UPDATED, payload: { jobs: [snap('j2', 'b')], removedIds: [] } },
    ]);
    expect(mirror.snapshot(1).map((j) => j.id)).toEqual(['j1']);
    expect(mirror.snapshot(2).map((j) => j.id)).toEqual(['j2']);
    expect(mirror.activeCount()).toBe(2);
  });

  it('sigue avisando a la ventana tras cerrar la sesión', () => {
    const { events, owners, sent } = setup();
    events.emit('queue.updated', { jobs: [snap('j1', 'a', 'running')], removedIds: [] });
    owners.delete('a');
    sent.length = 0;
    events.emit('queue.updated', { jobs: [snap('j1', 'a', 'interrupted')], removedIds: [] });
    expect(sent.map((s) => s.windowId)).toEqual([1]);
  });

  it('manda conflictos y pérdidas de sesión solo a su ventana', () => {
    const { events, sent } = setup();
    events.emit('queue.updated', { jobs: [snap('j2', 'b')], removedIds: [] });
    sent.length = 0;
    events.emit('queue.conflict', { jobId: 'j2' });
    events.emit('session.lost', { sessionId: 'a', error: null });
    expect(sent.map((s) => [s.windowId, s.event])).toEqual([
      [2, IPC_EVENTS.QUEUE_CONFLICT],
      [1, IPC_EVENTS.SESSION_LOST],
    ]);
  });

  it('reparte el registro de protocolo por ventana', () => {
    vi.useFakeTimers();
    try {
      const { events, sent } = setup();
      events.emit('log', { sessionId: 'a', level: 'info', message: 'uno', time: 0 });
      events.emit('log', { sessionId: 'b', level: 'info', message: 'dos', time: 0 });
      vi.advanceTimersByTime(200);
      const logs = sent.filter((s) => s.event === IPC_EVENTS.PROTOCOL_LOG);
      expect(logs.map((s) => [s.windowId, (s.payload as { message: string }[]).map((l) => l.message)])).toEqual([
        [1, ['uno']],
        [2, ['dos']],
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('los recuperados son de la primera ventana que pide la cola y pasan a otra si se cierra', () => {
    const { sent, mirror } = setup([snap('r1', 'restored:site', 'interrupted')]);
    expect(mirror.snapshot(1).map((j) => j.id)).toEqual(['r1']);
    expect(mirror.snapshot(2)).toEqual([]);

    mirror.forgetWindow(1);
    expect(sent).toEqual([
      { windowId: 2, event: IPC_EVENTS.QUEUE_UPDATED, payload: { jobs: [snap('r1', 'restored:site', 'interrupted')], removedIds: [] } },
    ]);
    expect(mirror.snapshot(2).map((j) => j.id)).toEqual(['r1']);
  });
});
