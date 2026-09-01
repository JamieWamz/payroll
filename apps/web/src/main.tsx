import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';

const rootElement = document.querySelector('#root');

if (rootElement === null) {
  throw new Error('Root element was not found');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
