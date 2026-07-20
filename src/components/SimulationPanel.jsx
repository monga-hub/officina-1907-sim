import React, { useState, useRef, useEffect } from 'react';
import { formatReport } from '../game/batchsim.js';
import BatchWorker from '../game/batchWorker.js?worker&inline';

// Le partite sono indipendenti (nessuno stato condiviso) → si dividono su più worker senza toccare
// l'algoritmo. `?worker&inline` fa sì che il worker finisca dentro dist/index.html (build a file unico),
// non in un file .js separato che fallirebbe aperto via file://.
const N_WORKERS = Math.max(1, Math.min(navigator.hardwareConcurrency || 4, 8));
function runBatchParallel(cfg, onProgress, workersRef) {
  const total = cfg.nGames;
  const nWorkers = Math.min(N_WORKERS, total);
  const perWorker = Math.ceil(total / nWorkers);
  const seedBase = cfg.seedBase ?? Math.floor(Math.random() * 100000); // condiviso: stessa slice di seed di un run seriale
  const doneByWorker = new Array(nWorkers).fill(0);
  const jobs = [];
  for (let i = 0; i < nWorkers; i++) {
    const n = Math.min(perWorker, total - i * perWorker);
    if (n <= 0) continue;
    jobs.push(new Promise((resolve, reject) => {
      const w = new BatchWorker();
      workersRef.current.push(w);
      // senza questo, un'eccezione dentro il worker non arriva da nessuna parte: niente 'done', niente
      // console, la barra resta a 0/N per sempre e sembra che "la simulazione non parta".
      w.onerror = e => { w.terminate(); reject(new Error(`worker ${i}: ${e.message || 'errore sconosciuto'}`)); };
      w.onmessage = e => {
        if (e.data.type === 'progress') {
          doneByWorker[i] = e.data.done;
          onProgress(doneByWorker.reduce((a, b) => a + b, 0), total);
        } else if (e.data.type === 'done') {
          resolve(e.data.games);
          w.terminate();
        }
      };
      w.postMessage({ cfg: { ...cfg, nGames: n, seedBase: seedBase + i * perWorker }, workerId: i });
    }));
  }
  return Promise.all(jobs).then(results => results.flat());
}

// Tre domande diverse al simulatore, non un solo "esegui N partite":
// Regressione = ho rotto qualcosa? (tante partite, IA veloce/prevedibile). Bilanciamento = una carta/meccanica
// è abusabile da un giocatore che pianifica? (poche partite, IA Rollout — vede investimenti che il Greedy ignora,
// vedi README "AI: Greedy vs Rollout") — veloce/accurato = solo la profondità, d4 prende già l'86% del segnale
// di d6 (vedi memoria sessione 13/07) a un terzo del costo. Personalizzata = controllo manuale per ricerca/debug.
const PRESETS = {
  regressione: { nGames: 500, aiRollout: null, desc: 'verificare che non ci siano regressioni · statistiche stabili · veloce (500-1000 partite)' },
  bilanciamento_veloce: { nGames: 30, aiRollout: { depth: 4, rollouts: 1 }, desc: 'prima occhiata su una carta/meccanica nuova · rollout d4 (20-50 partite)' },
  bilanciamento_accurato: { nGames: 75, aiRollout: { depth: 6, rollouts: 1 }, desc: 'verdetto affidabile, orizzonte pieno · rollout d6 (50-100 partite)' },
};
const MODE_LABEL = {
  regressione: 'Regressione',
  bilanciamento_veloce: 'Bilanciamento veloce',
  bilanciamento_accurato: 'Bilanciamento accurato',
  personalizzata: 'Personalizzata',
};

// Riceve l'intero cfg del setup (tracciati, commesse, trattativa, slot, ecc.) e aggiunge
// solo i parametri propri della simulazione: numero partite, giocatori, seed, marchi per posto.
export default function SimulationPanel(baseCfg) {
  const [mode, setMode] = useState('regressione');
  const [nGames, setNGames] = useState(500); // usato solo in modalità Personalizzata
  const [rolloutOn, setRolloutOn] = useState(false);
  const [depth, setDepth] = useState(6);
  const [rollouts, setRollouts] = useState(1);
  const [nPlayers, setNPlayers] = useState(4);
  const [coins, setCoins] = useState([10, 10, 10, 10]);
  const [seedBase, setSeedBase] = useState('');
  const [progress, setProgress] = useState(null);
  const [report, setReport] = useState('');
  const [copied, setCopied] = useState(false);
  const cancelled = useRef(false);
  const workersRef = useRef([]);
  const startTimeRef = useRef(null);
  const [, tick] = useState(0);
  const running = progress !== null && progress.done < progress.total && !report;

  // ricalcola il tempo stimato ogni secondo mentre gira — senza, l'ETA si aggiorna solo quando arriva
  // un progress event dai worker (a scatti), non ogni secondo come un timer vero.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => tick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [running]);

  const effective = mode === 'personalizzata'
    ? { nGames, aiRollout: rolloutOn ? { depth, rollouts } : null }
    : PRESETS[mode];

  const start = async () => {
    cancelled.current = false;
    workersRef.current = [];
    setReport('');
    setCopied(false);
    setProgress({ done: 0, total: effective.nGames });
    startTimeRef.current = Date.now();
    const cfg = {
      ...baseCfg,
      nGames: effective.nGames, nPlayers,
      aiRollout: effective.aiRollout,
      startingCoins: coins,
      seedBase: seedBase.trim() === '' ? undefined : Number(seedBase) || 0,
    };
    // partite indipendenti → parallelizzate su worker; "Ferma" le termina di colpo (nessun risultato
    // parziale, a differenza del vecchio stop seriale — semplificazione accettata per la velocità).
    let games;
    try {
      games = await runBatchParallel(cfg, (done, total) => setProgress({ done, total }), workersRef);
    } catch (err) {
      workersRef.current.forEach(w => w.terminate());
      setReport(`=== SIMULAZIONE INTERROTTA ===\n\n${err.message}\n\n${err.stack || ''}`);
      setProgress(p => p && { ...p, done: p.total });
      return;
    }
    if (games.length > 0 && !cancelled.current) {
      const iaLabel = effective.aiRollout ? `Rollout d${effective.aiRollout.depth} r${effective.aiRollout.rollouts}` : 'Greedy';
      const header = `=== MODALITÀ ===\n\n${MODE_LABEL[mode]}\n\n${effective.nGames} partite\nIA ${iaLabel}\n\n`;
      setReport(header + formatReport(games, cfg));
    }
    setProgress(p => p && { ...p, done: p.total });
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const pre = document.querySelector('.sim-report');
      if (pre) { const r = document.createRange(); r.selectNodeContents(pre); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
    }
  };

  // Condividi (mobile): manda il report a Note/Mail/chat con un tap. navigator.share solo dove esiste (telefono/HTTPS).
  const canShare = typeof navigator !== 'undefined' && !!navigator.share;
  const share = async () => { try { await navigator.share({ title: 'Officina 1907 — report', text: report }); } catch { /* annullato */ } };

  return (
    <div className="track-editor sim-panel">
      <p className="hint">Fa giocare le AI con TUTTE le impostazioni correnti (plancia, commesse, trattativa, conversioni) e produce un report copiabile. Il browser resta usabile durante la simulazione.</p>
      <div className="sim-controls">
        <label>Modalità:{' '}
          {Object.keys(MODE_LABEL).map(m => (
            <button key={m} className={m === mode ? 'sel' : ''} onClick={() => setMode(m)}>{MODE_LABEL[m]}</button>
          ))}
        </label>
        {mode !== 'personalizzata' && <p className="hint">{PRESETS[mode].desc}</p>}
        {mode === 'personalizzata' ? (
          <>
            <label>Partite: <input type="number" min="1" max="500" value={nGames} onChange={e => setNGames(Math.max(1, Math.min(500, Number(e.target.value) || 1)))} /></label>
            <label><input type="checkbox" checked={rolloutOn} onChange={e => setRolloutOn(e.target.checked)} /> Rollout</label>
            {rolloutOn && (
              <>
                <label>depth: <input type="number" min="1" max="12" value={depth} onChange={e => setDepth(Math.max(1, Math.min(12, Number(e.target.value) || 1)))} style={{ width: 50 }} /></label>
                <label>rollouts: <input type="number" min="1" max="20" value={rollouts} onChange={e => setRollouts(Math.max(1, Math.min(20, Number(e.target.value) || 1)))} style={{ width: 50 }} /></label>
              </>
            )}
          </>
        ) : (
          <p className="hint">{effective.nGames} partite · IA {effective.aiRollout ? `Rollout d${effective.aiRollout.depth}` : 'Greedy'}</p>
        )}
        <label>Giocatori AI:{' '}
          {[2, 3, 4].map(k => <button key={k} className={k === nPlayers ? 'sel' : ''} onClick={() => setNPlayers(k)}>{k}</button>)}
        </label>
        <label title="Marchi iniziali per posto (1°..).">Marchi iniziali:{' '}
          {Array.from({ length: nPlayers }, (_, i) => (
            <input key={i} type="number" min="0" max="99" value={coins[i]}
              onChange={e => setCoins(cs => cs.map((c, j) => (j === i ? Math.max(0, Math.min(99, Number(e.target.value) || 0)) : c)))}
              style={{ width: 44, marginRight: 4 }} />
          ))}
        </label>
        <label>Seed base: <input value={seedBase} onChange={e => setSeedBase(e.target.value)} placeholder="casuale" style={{ width: 80 }} /></label>
        {!running && <button className="primary" onClick={start}>▶ Avvia simulazione</button>}
        {running && <button onClick={() => { cancelled.current = true; workersRef.current.forEach(w => w.terminate()); setProgress(null); }}>■ Ferma</button>}
      </div>
      {progress && (
        <div className="sim-progress">
          <div className="bar"><div className="fill" style={{ width: `${(100 * progress.done) / progress.total}%` }} /></div>
          <span>{progress.done}/{progress.total} partite</span>
          {running && progress.done > 0 && startTimeRef.current && (() => {
            const elapsed = (Date.now() - startTimeRef.current) / 1000;
            const remaining = Math.max(0, (elapsed / progress.done) * (progress.total - progress.done));
            const mm = Math.floor(remaining / 60), ss = Math.round(remaining % 60);
            const finish = new Date(Date.now() + remaining * 1000);
            const hh = String(finish.getHours()).padStart(2, '0'), mi = String(finish.getMinutes()).padStart(2, '0');
            return <span> · manca {mm} min {ss} sec, finisce alle {hh}:{mi}</span>;
          })()}
        </div>
      )}
      {report && (
        <div>
          <button className="primary" onClick={copy}>{copied ? '✓ Copiato!' : '📋 Copia risultati'}</button>
          {canShare && <button onClick={share} style={{ marginLeft: 6 }}>📤 Condividi</button>}
          <pre className="sim-report">{report}</pre>
        </div>
      )}
    </div>
  );
}
