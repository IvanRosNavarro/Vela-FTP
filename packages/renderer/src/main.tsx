import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary, Toaster } from 'vela-kit/ui';
import { App } from './App';
import { themeManager } from './theme';
import './index.css';

themeManager.initialize();
// TODO(deuda): leer el tema activo de los ajustes cuando exista la BD (Fase 0 - Paso 3).
themeManager.setTheme('system');

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root container #root not found in index.html');
}

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
      <Toaster />
    </ErrorBoundary>
  </StrictMode>,
);
