import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
/*
 * rrweb's own replay stylesheet. NOT optional.
 *
 * It absolutely positions `.replayer-mouse-tail` — a canvas sized to the full
 * recorded viewport. Without this import that canvas stays in normal flow and
 * pushes the replay iframe exactly its own height down, out of the clipped
 * stage, so the replay renders blank while its DOM looks perfectly correct.
 */
import 'rrweb/dist/style.css';
import './styles.css';
import './network/network.css';
import './console/console.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root container missing from index.html');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
