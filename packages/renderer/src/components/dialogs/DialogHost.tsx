import { useDialogStore } from '../../stores/dialogStore';
import { useQueueStore } from '../../stores/queueStore';
import { ImportFileZillaDialog } from './ImportFileZillaDialog';
import { PaletteHost } from './PaletteHost';
import { MasterPasswordDialog, HostKeyDialog, UnlockDialog } from './SecurityDialogs';
import { SettingsDialog } from './SettingsDialog';
import { ConfirmDialog, PromptDialog } from './SimpleDialogs';
import { SiteEditor } from './SiteEditor';
import { ChmodDialog, ConflictDialog } from './TransferDialogs';

/** Pinta el diálogo de arriba de la pila y, si no hay ninguno, el primer conflicto pendiente. */
export function DialogHost() {
  const top = useDialogStore((s) => s.stack.at(-1));
  const close = useDialogStore((s) => s.close);
  const conflicts = useQueueStore((s) => s.conflicts);
  const jobs = useQueueStore((s) => s.jobs);
  const dropConflict = useQueueStore((s) => s.dropConflict);

  if (top) {
    const onClose = () => close(top);
    switch (top.kind) {
      case 'confirm':
        return <ConfirmDialog spec={top} onClose={onClose} />;
      case 'prompt':
        return <PromptDialog spec={top} onClose={onClose} />;
      case 'siteEditor':
        return <SiteEditor site={top.site} projectId={top.projectId ?? null} onClose={onClose} />;
      case 'settings':
        return <SettingsDialog {...(top.section ? { section: top.section } : {})} onClose={onClose} />;
      case 'palette':
        return <PaletteHost {...(top.initialQuery !== undefined ? { initialQuery: top.initialQuery } : {})} onClose={onClose} />;
      case 'importFileZilla':
        return <ImportFileZillaDialog onClose={onClose} />;
      case 'hostKey':
        return <HostKeyDialog spec={top} onClose={onClose} />;
      case 'unlock':
        return <UnlockDialog spec={top} onClose={onClose} />;
      case 'masterPassword':
        return <MasterPasswordDialog onClose={onClose} />;
      case 'chmod':
        return <ChmodDialog spec={top} onClose={onClose} />;
      case 'conflict':
        return null;
    }
  }

  // Los conflictos ya resueltos (p. ej. por "aplicar a todos") se descartan solos.
  const pending = conflicts.filter((c) => jobs[c.jobId]?.status === 'conflict');
  const first = pending[0];
  if (!first) return null;
  return <ConflictDialog key={first.jobId} info={first} remaining={pending.length} onClose={() => dropConflict(first.jobId)} />;
}
