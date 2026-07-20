// Worker: gioca la sua fetta di partite (indipendenti, nessuno stato condiviso) e restituisce i risultati.
// Caricato via ?worker&inline (SimulationPanel.jsx) così finisce dentro dist/index.html — funziona anche
// aperto con file://, non solo dal dev server.
import { runBatch } from './batchsim.js';

self.onmessage = async (e) => {
  const { cfg, workerId } = e.data;
  const games = await runBatch(cfg, (done) => self.postMessage({ type: 'progress', workerId, done }), () => false);
  self.postMessage({ type: 'done', workerId, games });
};
