import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles/reset.css';
import './styles/tokens.css';
import './styles/global.css';
import './app.css';
import './styles/shell.css';
import './styles/workspace-shell.css';
import './styles/appearance.css';
import App from './App';

const container = document.getElementById('app');
if (!container) {
  throw new Error('Missing #app mount node');
}

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
