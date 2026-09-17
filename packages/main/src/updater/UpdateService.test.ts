import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UpdateStatus } from '@vela-ftp/shared';
import { AUTO_CHECK_DELAY_MS, AUTO_CHECK_INTERVAL_MS, UpdateService, type Updater } from './UpdateService';

class FakeUpdater extends EventEmitter implements Updater {
  autoDownload = true;
  autoInstallOnAppQuit = false;
  checks = 0;
  downloads = 0;
  installs = 0;
  nextCheck: () => Promise<unknown> = async () => {
    this.emit('checking-for-update');
    this.emit('update-available', { version: '0.3.0' });
  };
  nextDownload: () => Promise<unknown> = async () => {
    this.emit('download-progress', { percent: 42.4 });
    this.emit('update-downloaded', { version: '0.3.0' });
  };
  checkForUpdates() {
    this.checks++;
    return this.nextCheck();
  }
  downloadUpdate() {
    this.downloads++;
    return this.nextDownload();
  }
  quitAndInstall() {
    this.installs++;
  }
}

function setup(overrides: { packaged?: boolean; canInstall?: boolean; autoCheck?: boolean } = {}) {
  const updater = new FakeUpdater();
  const changes: UpdateStatus[] = [];
  const opened: string[] = [];
  let autoCheck = overrides.autoCheck ?? true;
  const service = new UpdateService({
    updater,
    currentVersion: '0.2.0',
    packaged: overrides.packaged ?? true,
    canInstall: overrides.canInstall ?? true,
    autoCheckEnabled: () => autoCheck,
    onChange: (s) => changes.push(s),
    openExternal: (url) => opened.push(url),
    releasesUrl: 'https://github.com/o/r/releases',
    now: () => 5,
  });
  return { updater, service, changes, opened, setAutoCheck: (v: boolean) => (autoCheck = v) };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('UpdateService', () => {
  it('en desarrollo no consulta nada', async () => {
    const { updater, service } = setup({ packaged: false });
    expect(service.current.phase).toBe('unsupported');
    await service.check();
    expect(updater.checks).toBe(0);
  });

  it('nunca descarga sola y encadena comprobar → descargar → instalar', async () => {
    const { updater, service, changes } = setup();
    expect(updater.autoDownload).toBe(false);
    expect(updater.autoInstallOnAppQuit).toBe(true);

    const status = await service.check();
    expect(status).toMatchObject({ phase: 'available', version: '0.3.0', checkedAt: 5 });
    expect(changes.map((c) => c.phase)).toEqual(['checking', 'available']);

    service.install();
    expect(updater.installs).toBe(0);

    await service.download();
    expect(changes.map((c) => c.phase)).toContain('downloading');
    expect(changes.find((c) => c.phase === 'downloading' && c.percent === 42)).toBeTruthy();
    expect(service.current).toMatchObject({ phase: 'downloaded', percent: 100 });

    service.install();
    expect(updater.installs).toBe(1);
  });

  it('agrupa comprobaciones simultáneas y no reinicia una descarga', async () => {
    const { updater, service } = setup();
    await Promise.all([service.check(), service.check()]);
    expect(updater.checks).toBe(1);
    await service.download();
    await service.check();
    await service.download();
    expect(updater.checks).toBe(1);
    expect(updater.downloads).toBe(1);
  });

  it('un error deja la versión encontrada y se puede reintentar la descarga', async () => {
    const { updater, service } = setup();
    await service.check();
    updater.nextDownload = async () => {
      throw new Error('sin red');
    };
    await service.download();
    expect(service.current).toMatchObject({ phase: 'error', error: 'sin red', version: '0.3.0' });
    updater.nextDownload = async () => updater.emit('update-downloaded', { version: '0.3.0' });
    await service.download();
    expect(service.current.phase).toBe('downloaded');
  });

  it('un fallo al comprobar no rechaza', async () => {
    const { updater, service } = setup();
    updater.nextCheck = async () => {
      throw new Error('offline');
    };
    await expect(service.check()).resolves.toMatchObject({ phase: 'error', error: 'offline' });
  });

  it('sin poder instalar (macOS sin firmar) ofrece la página de la release', async () => {
    const { updater, service, opened } = setup({ canInstall: false });
    expect(updater.autoInstallOnAppQuit).toBe(false);
    await service.check();
    await service.download();
    expect(updater.downloads).toBe(0);
    service.openRelease();
    expect(opened).toEqual(['https://github.com/o/r/releases/tag/v0.3.0']);
  });

  it('la comprobación automática respeta el ajuste', async () => {
    vi.useFakeTimers();
    const { updater, service, setAutoCheck } = setup({ autoCheck: false });
    service.startAutoCheck();
    await vi.advanceTimersByTimeAsync(AUTO_CHECK_DELAY_MS);
    expect(updater.checks).toBe(0);
    setAutoCheck(true);
    await vi.advanceTimersByTimeAsync(AUTO_CHECK_INTERVAL_MS);
    expect(updater.checks).toBe(1);
    service.stop();
    await vi.advanceTimersByTimeAsync(AUTO_CHECK_INTERVAL_MS);
    expect(updater.checks).toBe(1);
  });
});
