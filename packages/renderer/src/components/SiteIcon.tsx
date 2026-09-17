import { Loader2, Lock, Server, ServerCog } from 'lucide-react';
import type { Site } from '@vela-ftp/shared';

export const PROTOCOL_LABEL: Record<Site['protocol'], string> = {
  sftp: 'SFTP',
  ftps: 'FTPS',
  'ftps-implicit': 'FTPS',
  ftp: 'FTP',
};

export interface SiteIconProps {
  protocol: Site['protocol'];
  connected?: boolean;
  connecting?: boolean;
  size?: number;
}

/**
 * Un servidor con el matiz de su protocolo: SFTP lleva engranaje (va por SSH),
 * FTPS un candado (va por TLS) y FTP ninguno, que es justo lo que se quiere ver.
 */
export function SiteIcon({ protocol, connected = false, connecting = false, size = 14 }: SiteIconProps) {
  if (connecting) return <Loader2 size={size} className="shrink-0 animate-spin text-[var(--vela-accent)]" />;

  const color = connected ? 'text-[var(--vela-success)]' : 'text-[var(--vela-fg-muted)]';
  if (protocol === 'sftp') return <ServerCog size={size} className={`shrink-0 ${color}`} />;
  if (protocol === 'ftp') return <Server size={size} className={`shrink-0 ${color}`} />;

  return (
    <span className="relative flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <Server size={size} className={color} />
      <Lock
        size={Math.round(size * 0.55)}
        strokeWidth={3}
        className={`absolute -bottom-0.5 -right-1 rounded-full bg-[var(--vela-sidebar-bg)] ${color}`}
      />
    </span>
  );
}
