import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import './styles.css';
import './fidelity.css';

/**
 * The mock API starts before React mounts, so the Dashboard's on-mount calls
 * never race the transport coming up.
 *
 * MSW's Service Worker is the preferred transport. Where registration is
 * refused — embedded browsers, hardened profiles, some CI sandboxes — we fall
 * back to a direct `fetch` patch serving the identical routes, rather than
 * rendering an empty shell.
 */
const WORKER_URL = '/mockServiceWorker.js';

/**
 * Probe registrability before handing control to MSW.
 *
 * MSW logs *and* rejects when registration fails, and its internal rejection
 * surfaces as an `unhandledrejection` event no caller can intercept. Once M4
 * captures unhandled rejections, that would land in every archive recorded in a
 * Service-Worker-less environment as an error the app did not actually have.
 * Probing first means we never ask MSW to fail.
 */
async function canUseServiceWorker(): Promise<boolean> {
  if (!('serviceWorker' in navigator)) return false;
  try {
    await navigator.serviceWorker.register(WORKER_URL);
    return true;
  } catch {
    return false;
  }
}

async function startMockApi(): Promise<'service-worker' | 'fetch-patch'> {
  if (await canUseServiceWorker()) {
    const { worker } = await import('./mocks/browser');
    await worker.start({
      onUnhandledRequest: 'bypass',
      quiet: true,
      serviceWorker: { url: WORKER_URL },
    });
    return 'service-worker';
  }

  const { installFetchFallback } = await import('./mocks/fallback');
  installFetchFallback();
  return 'fetch-patch';
}

async function bootstrap(): Promise<void> {
  const transport = await startMockApi();
  document.documentElement.dataset['mockTransport'] = transport;

  const container = document.getElementById('root');
  if (!container) throw new Error('Root container missing from index.html');

  createRoot(container).render(
    <StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </StrictMode>,
  );
}

void bootstrap();
