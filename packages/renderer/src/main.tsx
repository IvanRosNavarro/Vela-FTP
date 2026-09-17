import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary, Toaster } from 'vela-kit/ui';
import { App } from './App';
import { applySavedTheme } from './theme';
import './index.css';

// Monaco solo se descarga en las ventanas que lo usan.
const EditorWindow = lazy(() => import('./views/EditorWindow'));

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root container #root not found in index.html');
}

const params = new URLSearchParams(window.location.search);
const editorId = params.get('view') === 'editor' ? params.get('id') : null;

// Se espera al tema para no pintar un frame con los colores equivocados.
void applySavedTheme().finally(() => {
  createRoot(container).render(
    <StrictMode>
      <ErrorBoundary>
        {editorId ? (
          <Suspense fallback={null}>
            <EditorWindow id={editorId} />
          </Suspense>
        ) : (
          <App />
        )}
        <Toaster />
      </ErrorBoundary>
    </StrictMode>,
  );
});
