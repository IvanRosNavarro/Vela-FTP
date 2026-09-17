import { FolderInput, Plus, RefreshCw } from 'lucide-react';
import { useDialogStore } from '../../stores/dialogStore';
import { Modal } from './Modal';

/** Primer arranque: las tres formas de empezar. */
export function WelcomeDialog({ onClose }: { onClose: () => void }) {
  const open = useDialogStore((s) => s.open);
  const go = (action: () => void) => {
    onClose();
    action();
  };

  const option = (icon: React.ReactNode, title: string, description: string, onSelect: () => void) => (
    <button
      className="flex items-start gap-3 rounded-md border border-[var(--vela-border)] p-3 text-left hover:border-[var(--vela-accent)]"
      onClick={onSelect}
    >
      <span className="mt-0.5 text-[var(--vela-accent)]">{icon}</span>
      <span>
        <span className="block text-xs font-medium text-[var(--vela-fg)]">{title}</span>
        <span className="block text-[11px] text-[var(--vela-fg-muted)]">{description}</span>
      </span>
    </button>
  );

  return (
    <Modal
      title="Bienvenido a Vela FTP"
      onClose={onClose}
      width={520}
      footer={
        <button className="vf-btn" onClick={onClose}>
          Empezar de cero
        </button>
      }
    >
      <div className="flex flex-col gap-2">
        <p className="mb-1 text-[11px] text-[var(--vela-fg-muted)]">Un cliente FTP, FTPS y SFTP con la esencia de Vela. ¿Por dónde empezamos?</p>
        {option(<FolderInput size={16} />, 'Traer mis servidores de FileZilla', 'Importa su lista de sitios con las carpetas y las contraseñas.', () =>
          go(() => open({ kind: 'importFileZilla' })),
        )}
        {option(<RefreshCw size={16} />, 'Sincronizar con otro dispositivo', 'Usa tu cuenta de Vela y trae sitios, marcadores y contraseñas cifrados.', () =>
          go(() => open({ kind: 'settings', section: 'sync' })),
        )}
        {option(<Plus size={16} />, 'Añadir un servidor a mano', 'Host, usuario y poco más: en un minuto estás dentro.', () =>
          go(() => open({ kind: 'siteEditor', site: null })),
        )}
      </div>
    </Modal>
  );
}
