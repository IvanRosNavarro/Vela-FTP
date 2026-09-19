import {
  IPC_CHANNELS,
  diffInputSchema,
  editorDirtyInputSchema,
  editorIdInputSchema,
  editorSaveInputSchema,
  localPathInputSchema,
  openExternalInputSchema,
  prepareDragInputSchema,
  uploadExternalInputSchema,
  remotePathInputSchema,
  watchIdInputSchema,
  watchStartInputSchema,
} from '@vela-ftp/shared';
import type { EditorManager } from '../files/EditorManager';
import type { WatchManager } from '../files/WatchManager';
import type { ExternalFilesManager } from '../files/ExternalFilesManager';
import { handle } from './handle';

export function registerFileHandlers(editor: EditorManager, watches: WatchManager, external: ExternalFilesManager): void {
  handle(IPC_CHANNELS.FILES_OPEN_EXTERNAL, openExternalInputSchema, async ({ sessionId, path, mode }, event) => {
    await external.open(event.sender.id, sessionId, path, mode);
    return null;
  });
  handle(IPC_CHANNELS.FILES_UPLOAD_EXTERNAL, uploadExternalInputSchema, async ({ id, force }) => {
    await external.upload(id, force);
    return null;
  });
  handle(IPC_CHANNELS.FILES_PREPARE_DRAG, prepareDragInputSchema, ({ sessionId, items }) => external.prepareForDrag(sessionId, items));

  handle(IPC_CHANNELS.WATCH_LIST, null, () => watches.list());
  handle(IPC_CHANNELS.WATCH_START, watchStartInputSchema, ({ sessionId, localDir, remoteDir }) => watches.start(sessionId, localDir, remoteDir));
  handle(IPC_CHANNELS.WATCH_STOP, watchIdInputSchema, async ({ id }) => {
    await watches.stop(id);
    return null;
  });

  handle(IPC_CHANNELS.FILES_EDIT_REMOTE, remotePathInputSchema, async ({ sessionId, path }) => {
    await editor.openRemote(sessionId, path);
    return null;
  });
  handle(IPC_CHANNELS.FILES_DIFF, diffInputSchema, async ({ sessionId, remotePath, localPath }) => {
    await editor.openDiff(sessionId, remotePath, localPath);
    return null;
  });
  handle(IPC_CHANNELS.FILES_PREVIEW_REMOTE, remotePathInputSchema, ({ sessionId, path }) => editor.previewRemote(sessionId, path));
  handle(IPC_CHANNELS.FILES_PREVIEW_LOCAL, localPathInputSchema, ({ path }) => editor.previewLocal(path));

  handle(IPC_CHANNELS.EDITOR_LOAD, editorIdInputSchema, ({ id }, event) => editor.load(id, event.sender.id));
  handle(IPC_CHANNELS.EDITOR_SAVE, editorSaveInputSchema, ({ id, content, force }, event) => editor.save(id, content, force, event.sender.id));
  handle(IPC_CHANNELS.EDITOR_SET_DIRTY, editorDirtyInputSchema, ({ id, dirty }, event) => {
    editor.setDirty(id, dirty, event.sender.id);
    return null;
  });
  handle(IPC_CHANNELS.EDITOR_CLOSE, editorIdInputSchema, ({ id }, event) => {
    editor.close(id, event.sender.id);
    return null;
  });
}
