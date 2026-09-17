import { useEffect, useState } from 'react';
import { IPC_EVENTS } from '@vela-ftp/shared';
import { TitleBar } from 'vela-kit/ui';

const PLATFORM = window.api.platform;

function useWindowMaximized(): boolean {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void window.api.window.isMaximized().then((res) => {
      if (!cancelled && res.ok) setMaximized(res.data);
    });
    const off = window.api.on(IPC_EVENTS.WINDOW_MAXIMIZED_CHANGED, ({ maximized: next }) => setMaximized(next));
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  return maximized;
}

export function AppTitleBar() {
  const maximized = useWindowMaximized();

  return (
    <TitleBar
      platform={PLATFORM}
      maximized={maximized}
      controls={{
        onMinimize: () => void window.api.window.minimize(),
        onToggleMaximize: () => void window.api.window.toggleMaximize(),
        onClose: () => void window.api.window.close(),
      }}
    >
      <span className="px-3 text-xs font-medium">Vela FTP</span>
    </TitleBar>
  );
}
