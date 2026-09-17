import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary, Toaster } from 'vela-kit/ui';
import { App } from './App';
import { applySavedTheme } from './theme';
import './index.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root container #root not found in index.html');
}

// Se espera al tema para no pintar un frame con los colores equivocados.
void applySavedTheme().finally(() => {
  createRoot(container).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
        <Toaster />
      </ErrorBoundary>
    </StrictMode>,
  );
});
