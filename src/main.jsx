import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { writeConfigToLS } from './components/SetupScreen.jsx';
import baseline from './game/baseline-config.json';
import './styles.css';

// Config baseline: al primo avvio (o dopo un bump di versione) scrive la config congelata
// nelle chiavi localStorage, come se l'utente l'avesse importata. Dopo, gli edit dell'utente
// persistono normalmente. Per riforzare la baseline dopo un cambio, alza BASELINE_VERSION.
const BASELINE_VERSION = 'v1';
try {
  if (localStorage.getItem('officina1907-baseline-applied') !== BASELINE_VERSION) {
    baseline.newWorkers = baseline.newWorkers || baseline.workers; // l'import legge newWorkers; il file tiene solo workers
    writeConfigToLS(baseline);
    localStorage.setItem('officina1907-baseline-applied', BASELINE_VERSION);
  }
} catch { /* niente storage: l'app usa i default di codice */ }

createRoot(document.getElementById('root')).render(<App />);
