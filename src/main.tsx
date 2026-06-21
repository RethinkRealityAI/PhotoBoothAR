import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import './events/hope-gala/theme.css';
import './events/jenna-jake/theme.css';
import { activeEvent } from './events/active';

if (activeEvent.fontHref) {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = activeEvent.fontHref;
  document.head.appendChild(link);
}
document.documentElement.dataset.event = activeEvent.id;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
