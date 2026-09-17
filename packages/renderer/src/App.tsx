function Pane({ title }: { title: string }) {
  return (
    <section className="flex min-w-0 flex-1 flex-col border-r border-[var(--vela-border)] last:border-r-0">
      <header className="px-3 py-2 text-xs uppercase tracking-wide text-[var(--vela-fg-muted)]">
        {title}
      </header>
      <div className="flex flex-1 items-center justify-center text-[var(--vela-fg-muted)]">
        Sin conexión
      </div>
    </section>
  );
}

export function App() {
  return (
    <div id="vela-shell" className="flex h-full">
      <aside
        id="vela-sidebar"
        className="flex w-60 flex-col bg-[var(--vela-sidebar-bg)] p-3"
      >
        <span className="font-semibold">Vela FTP</span>
        <span className="text-xs text-[var(--vela-fg-muted)]">v{__APP_VERSION__}</span>
      </aside>
      <main id="vela-content" className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-1">
          <Pane title="Local" />
          <Pane title="Remoto" />
        </div>
        <footer className="h-40 border-t border-[var(--vela-border)] bg-[var(--vela-bg-elevated)] px-3 py-2 text-xs text-[var(--vela-fg-muted)]">
          Cola de transferencias
        </footer>
      </main>
    </div>
  );
}
