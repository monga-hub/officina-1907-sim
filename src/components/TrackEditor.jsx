import React from 'react';
import { TRACK_TILES, TRACK_TILE_CAP_DEFAULT, trackGridPos, TRACK_MODELS, TRACK_MODEL_DEFAULT } from '../game/data.js';

// Tipi di casella ciclabili con il click. 2.0: template unico per i 3 reparti (prima terziario aveva
// un layout proprio) + celle "slot tile" (7/11/15, inerti finché non comprate) e 3 milestone distinte
// (ognuna apre un mercato — vedi TrackTileEditor sotto e resolveCell/legalCommands in engine.js).
const CELL_TYPES = [
  { key: 'empty', cell: null, label: '·', desc: 'vuota' },
  { key: 'c1', cell: { coins: 1 }, label: '1ⓜ', desc: '1 marco' },
  { key: 'c2', cell: { coins: 2 }, label: '2ⓜ', desc: '2 marchi' },
  { key: 'r1', cell: { res: 1 }, label: '⚙R', desc: '1 risorsa del reparto' },
  { key: 'ci', cell: { coinsPerIcon: 1 }, label: 'ⓜ×🂠', desc: '1 marco per carta del settore' },
  { key: 'pv2', cell: { pv: 2 }, label: '2PV', desc: 'soglia 2 PV a fine partita' },
  { key: 'pv3', cell: { pv: 3 }, label: '3PV', desc: 'soglia 3 PV a fine partita' },
  { key: 'ts1', cell: { tileSlot: 1 }, label: '□1', desc: 'slot tile — mercato 1 (sbloccato dalla milestone successiva)' },
  { key: 'ms1', cell: { milestone: true, opensMarket: 1 }, label: '🏛1', desc: 'milestone — apre il mercato 1 per lo slot precedente' },
  { key: 'ts2', cell: { tileSlot: 2 }, label: '□2', desc: 'slot tile — mercato 2' },
  { key: 'ms2', cell: { milestone: true, opensMarket: 2 }, label: '🏛2', desc: 'milestone — apre il mercato 2 per lo slot precedente' },
  { key: 'ts3', cell: { tileSlot: 3 }, label: '□3', desc: 'slot tile — mercato 3' },
  { key: 'ms3', cell: { milestone: true, opensMarket: 3 }, label: '🏛3', desc: 'milestone finale — apre il mercato 3 per lo slot precedente' },
  // Casella doppia del modello "unito": una sola casella fisica che è insieme slot tile e milestone
  // (la tile stampata è larga due caselle e le copre entrambe). Senza questi tipi, un click sulla
  // cella la ridurrebbe a uno dei due, perdendo l'altro in silenzio.
  { key: 'tm1', cell: { tileSlot: 1, milestone: true, opensMarket: 1 }, label: '□🏛1', desc: 'casella doppia — slot tile + milestone che apre il mercato 1' },
  { key: 'tm2', cell: { tileSlot: 2, milestone: true, opensMarket: 2 }, label: '□🏛2', desc: 'casella doppia — slot tile + milestone che apre il mercato 2' },
  { key: 'tm3', cell: { tileSlot: 3, milestone: true, opensMarket: 3 }, label: '□🏛3', desc: 'casella doppia — slot tile + milestone che apre il mercato 3' },
];

function typeIndexOf(cell) {
  if (!cell) return 0;
  // le combinate PRIMA delle singole: {tileSlot, milestone} matcherebbe altrimenti il solo tileSlot
  if (cell.tileSlot && cell.milestone) return 12 + cell.tileSlot;
  if (cell.coins === 1) return 1;
  if (cell.coins === 2) return 2;
  if (cell.res) return 3;
  if (cell.coinsPerIcon) return 4;
  if (cell.pv === 2) return 5;
  if (cell.pv === 3) return 6;
  if (cell.tileSlot === 1) return 7;
  if (cell.milestone && cell.opensMarket === 1) return 8;
  if (cell.tileSlot === 2) return 9;
  if (cell.milestone && cell.opensMarket === 2) return 10;
  if (cell.tileSlot === 3) return 11;
  if (cell.milestone && cell.opensMarket === 3) return 12;
  return 0;
}

const TRACK_KEY = 'officina1907-track-v2'; // v2: template unico (array singolo), non più {terziario,secondario}

// Chiave per modello: il 'classico' tiene la chiave storica (le modifiche già salvate sopravvivono),
// l' 'unito' ne ha una sua — i due editor non si sovrascrivono a vicenda.
const keyFor = model => model === 'classico' ? TRACK_KEY : `${TRACK_KEY}-${model}`;
const lenFor = model => (TRACK_MODELS[model] || TRACK_MODELS[TRACK_MODEL_DEFAULT]).max + 1;
function codeDefaultTrack(model) { return structuredClone((TRACK_MODELS[model] || TRACK_MODELS[TRACK_MODEL_DEFAULT]).track); }

// default "utente" (salvato con "Rendi default"), altrimenti default di codice
export function defaultEditorTrack(model = TRACK_MODEL_DEFAULT) {
  try { const r = localStorage.getItem(keyFor(model) + '-def'); if (r) { const v = JSON.parse(r); if (Array.isArray(v) && v.length === lenFor(model)) return v; } } catch { /* no-op */ }
  return codeDefaultTrack(model);
}

export function loadEditorTrack(model = TRACK_MODEL_DEFAULT) {
  try {
    const raw = localStorage.getItem(keyFor(model));
    if (raw) { const t = JSON.parse(raw); if (Array.isArray(t) && t.length === lenFor(model)) return t; }
  } catch { /* localStorage assente o corrotto: si riparte dai default */ }
  return defaultEditorTrack(model);
}

export function saveEditorTrack(t, model = TRACK_MODEL_DEFAULT) {
  try { localStorage.setItem(keyFor(model), JSON.stringify(t)); } catch { /* no-op */ }
}

// tracks per initGame: stesso template per i 3 reparti
export function toGameTracks(t) {
  return { terziario: t, secondario: t, primario: t };
}

function Grid({ track, onCycle }) {
  const grid = [[], [], [], []];
  const max = track.length - 1;
  for (let pos = 1; pos <= max; pos++) {
    const [row, col] = trackGridPos(pos, max);
    grid[row][col] = pos;
  }
  return (
    <div className="editor-grid">
      {grid.map((rowPos, r) => (
        <div key={r} className="editor-row">
          <span className="row-label">{'ABCD'[r]}</span>
          {rowPos.map((pos, c) => {
            const ti = typeIndexOf(track[pos]);
            return (
              <button key={c} className="editor-cell" title={`Pos ${pos} — ${CELL_TYPES[ti].desc}. Click per cambiare.`}
                onClick={() => onCycle(pos)}>
                <small>{pos}</small>{CELL_TYPES[ti].label}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export default function TrackEditor({ track, setTrack, model = TRACK_MODEL_DEFAULT }) {
  const cycle = (pos) => {
    const next = structuredClone(track);
    const ti = typeIndexOf(next[pos]);
    next[pos] = structuredClone(CELL_TYPES[(ti + 1) % CELL_TYPES.length].cell);
    setTrack(next);
    saveEditorTrack(next, model);
  };
  return (
    <div className="track-editor">
      <p className="hint">Click su una casella per cambiarne il contenuto (ciclo: {CELL_TYPES.map(t => t.label).join(' → ')}).
        Percorso a serpentina da D1: D1→D4 → C4→C1 → B1→B4 → A4→A1. Template unico per i 3 reparti (terziario/secondario/primario).
        Modifiche salvate nel browser.</p>
      <Grid track={track} onCycle={cycle} />
      <button className="ghost" onClick={() => { const d = defaultEditorTrack(model); setTrack(d); saveEditorTrack(d, model); }}>
        Ripristina tracciato di default
      </button>
      <button className="ghost" onClick={() => { try { localStorage.setItem(TRACK_KEY + '-def', JSON.stringify(track)); } catch { /* no-op */ } }}>
        ⭐ Rendi questo tracciato il default
      </button>
    </div>
  );
}

// ---------- Tile acquistabili (mercato 1/2/3, sbloccate dalle milestone del tracciato) ----------
// v2 (16/07/2026): catalogo unico condiviso dai 3 reparti, niente più `role` per tile (editor unificato).
// Chiave bumpata da v1 così il vecchio salvataggio triplicato per reparto non riappare come doppioni.
const TRACKTILES_KEY = 'officina1907-tracktiles-v2';
const TRACKTILECAP_KEY = 'officina1907-tracktilecap-v1';

export function loadTrackTiles() {
  try { const raw = localStorage.getItem(TRACKTILES_KEY); if (raw) { const v = JSON.parse(raw); if (Array.isArray(v)) return v; } } catch { /* no-op */ }
  return structuredClone(TRACK_TILES);
}
export function saveTrackTiles(v) { try { localStorage.setItem(TRACKTILES_KEY, JSON.stringify(v)); } catch { /* no-op */ } }

export function loadTrackTileCap() {
  try { const raw = localStorage.getItem(TRACKTILECAP_KEY); if (raw) return { ...TRACK_TILE_CAP_DEFAULT, ...JSON.parse(raw) }; } catch { /* no-op */ }
  return structuredClone(TRACK_TILE_CAP_DEFAULT);
}
export function saveTrackTileCap(v) { try { localStorage.setItem(TRACKTILECAP_KEY, JSON.stringify(v)); } catch { /* no-op */ } }

// effetti passivi soli per ora (niente scambi/scelte — vedi discussione in sessione). Niente scelta di
// settore (a differenza dei lavoratori): una tile paga sempre nel reparto dove viene installata.
// cellType = combinazione tipo(marchi/risorsa/punti vittoria) × verbo(prendi=fisso, perOgni=per carta/tensione)
const TIPO_OF = {
  coins: 'marchi', coinsPerIcon: 'marchi', coinsPerTension: 'marchi', coinsPerFactory: 'marchi',
  res: 'risorsa', resPerIcon: 'risorsa', resPerTension: 'risorsa', resPerFactory: 'risorsa',
  pv: 'punti', pvPerIcon: 'punti', pvPerTension: 'punti', pvPerFactory: 'punti',
};
const VERBO_OF = {
  coins: 'prendi', res: 'prendi', pv: 'prendi',
  coinsPerIcon: 'perOgni', resPerIcon: 'perOgni', pvPerIcon: 'perOgni',
  coinsPerTension: 'perOgni', resPerTension: 'perOgni', pvPerTension: 'perOgni',
  coinsPerFactory: 'perOgni', resPerFactory: 'perOgni', pvPerFactory: 'perOgni',
};
const CONTA_OF = {
  coinsPerIcon: 'icona', resPerIcon: 'icona', pvPerIcon: 'icona',
  coinsPerTension: 'tensione', resPerTension: 'tensione', pvPerTension: 'tensione',
  coinsPerFactory: 'fabbrica', resPerFactory: 'fabbrica', pvPerFactory: 'fabbrica',
};
const BASE_OF = { marchi: 'coins', risorsa: 'res', punti: 'pv' };
const cellTypeFor = (tipo, verbo, conta) => {
  const base = BASE_OF[tipo] || 'coins';
  if (verbo === 'prendi') return base;
  if (conta === 'tensione') return `${base}PerTension`;
  if (conta === 'fabbrica') return `${base}PerFactory`;
  return `${base}PerIcon`;
};

export function TrackTileEditor({ tiles, setTiles, cap, setCap }) {
  const save = next => { setTiles(next); saveTrackTiles(next); };
  const upd = (i, patch) => save(tiles.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  const remove = i => save(tiles.filter((_, j) => j !== i));
  const add = market => save([...tiles, {
    id: 'tt' + Math.random().toString(36).slice(2, 8), market, name: 'Nuova tile',
    cellType: market === 1 ? 'coinsPerIcon' : 'resPerIcon', amount: 1, cost: 0, copies: 4,
  }]);
  const setMode = mode => { const next = { ...cap, mode }; setCap(next); saveTrackTileCap(next); };
  return (
    <div className="track-editor">
      <p className="hint">Tile acquistabili alla Borsa (Ricerca e Sviluppo — alternativa alle Commesse nella stessa visita, vedi sotto):
        mercato 1 sbloccato dalla milestone in pos.8 (riempie lo slot in pos.7),
        mercato 2 dalla milestone in pos.12 (slot pos.11), mercato 3 dalla milestone in pos.16 (slot pos.15). Stesso
        catalogo per Terziario/Secondario/Primario (un solo editor), ma in partita ogni reparto ha il suo mercato e
        la sua scorta indipendenti: esaurire una tile in un reparto non tocca le copie degli altri due.
        "Costo" in risorse del proprio settore (Tessuti/Acciaio/Coloranti a seconda del reparto), oggi 0 di default.</p>
      <p>
        Scorta: <button className={cap?.mode !== 'limitato' ? 'sel' : ''} onClick={() => setMode('illimitato')}>Illimitata (ogni giocatore sceglie liberamente)</button>{' '}
        <button className={cap?.mode === 'limitato' ? 'sel' : ''} onClick={() => setMode('limitato')}>Limitata ("copie" = pool condiviso tra i giocatori, per reparto)</button>
      </p>
      {[1, 2, 3].map(market => (
        <div key={market} style={{ marginBottom: 16 }}>
          <h4>Mercato {market}</h4>
          <table className="pv-editor">
            <thead><tr><th>Nome</th><th>Fattore 1</th><th>Verbo</th><th>Fattore 2</th><th>Costo</th><th>Copie</th><th></th></tr></thead>
            <tbody>
              {tiles.map((t, i) => {
                if (t.market !== market) return null;
                const tipo = TIPO_OF[t.cellType] || 'marchi';
                const verbo = VERBO_OF[t.cellType] || 'prendi';
                const conta = CONTA_OF[t.cellType] || 'icona';
                const setPart = (part, val) => {
                  const nt = part === 'tipo' ? val : tipo, nv = part === 'verbo' ? val : verbo, nc = part === 'conta' ? val : conta;
                  upd(i, { cellType: cellTypeFor(nt, nv, nc) });
                };
                return (
                <tr key={t.id}>
                  <td><input value={t.name} onChange={e => upd(i, { name: e.target.value })} style={{ width: 140 }} /></td>
                  <td>
                    <select value={tipo} onChange={e => setPart('tipo', e.target.value)}><option value="marchi">marchi</option><option value="risorsa">risorsa</option><option value="punti">punti vittoria</option></select>
                    <input type="number" min="1" max="9" value={t.amount} onChange={e => upd(i, { amount: Math.max(1, Math.min(9, Number(e.target.value) || 1)) })} style={{ width: 40 }} />
                  </td>
                  <td><select value={verbo} onChange={e => setPart('verbo', e.target.value)}><option value="prendi">prendi</option><option value="perOgni">perOgni</option></select></td>
                  <td>{verbo === 'perOgni' ? (
                    <select value={conta} onChange={e => setPart('conta', e.target.value)}><option value="icona">per carta (icona)</option><option value="tensione">per tensione</option><option value="fabbrica">per fabbrica</option></select>
                  ) : <small>—</small>}</td>
                  <td><input type="number" min="0" max="20" value={t.cost} onChange={e => upd(i, { cost: Math.max(0, Math.min(20, Number(e.target.value) || 0)) })} style={{ width: 44 }} /></td>
                  <td><input type="number" min="0" max="9" value={t.copies} onChange={e => upd(i, { copies: Math.max(0, Math.min(9, Number(e.target.value) || 0)) })} style={{ width: 44 }} /></td>
                  <td><button className="ghost" onClick={() => remove(i)}>✕</button></td>
                </tr>
                );
              })}
            </tbody>
          </table>
          <button className="ghost" onClick={() => add(market)}>+ Aggiungi tile mercato {market}</button>
        </div>
      ))}
    </div>
  );
}
