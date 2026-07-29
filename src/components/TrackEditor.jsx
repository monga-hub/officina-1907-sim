import React from 'react';
import { TRACK_TILES, TRACK_TILE_CAP_DEFAULT, trackGridPos, TRACK_MODELS, TRACK_MODEL_DEFAULT } from '../game/data.js';
import { tileEffect } from '../game/engine.js';
import { SECTORS } from '../game/data.js';

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
  // in fondo per non spostare gli indici hardcoded in typeIndexOf
  { key: 'cf', cell: { coinsPerFactory: 1 }, label: 'ⓜ×🏭', desc: '1 marco per fabbrica posseduta adiacente alla risorsa del settore prodotto (forza-settore)' },
  { key: 'rf', cell: { resPerFactory: 1 }, label: '⚙R×🏭', desc: '1 risorsa del reparto per fabbrica posseduta adiacente alla risorsa del settore prodotto (forza-settore)' },
];

function typeIndexOf(cell) {
  if (!cell) return 0;
  // le combinate PRIMA delle singole: {tileSlot, milestone} matcherebbe altrimenti il solo tileSlot
  if (cell.tileSlot && cell.milestone) return 12 + cell.tileSlot;
  if (cell.coins === 1) return 1;
  if (cell.coins === 2) return 2;
  if (cell.res) return 3;
  if (cell.coinsPerIcon) return 4;
  if (cell.coinsPerFactory) return 16;
  if (cell.resPerFactory) return 17;
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
// v3 (29/07/2026): tile passano al modello formula {verbo,f1,f2} come le carte (prendi/perOgni/scambia + tipo
// 'punti'). Chiave bumpata: i vecchi salvataggi cellType vengono migrati al volo con tileEffect e riscritti.
const TRACKTILES_KEY = 'officina1907-tracktiles-v3';
const TRACKTILECAP_KEY = 'officina1907-tracktilecap-v1';

// Normalizza una tile (legacy cellType o già-formula) alla forma {…, effect:{verbo,f1,f2}} senza cellType/amount.
const normTile = t => { const { cellType, amount, ...rest } = t; return { ...rest, effect: tileEffect(t) }; };

export function loadTrackTiles() {
  try {
    const raw = localStorage.getItem(TRACKTILES_KEY);
    if (raw) { const v = JSON.parse(raw); if (Array.isArray(v)) return v.map(normTile); }
    // migra un eventuale salvataggio v2 (cellType) una volta sola
    const old = localStorage.getItem('officina1907-tracktiles-v2');
    if (old) { const v = JSON.parse(old); if (Array.isArray(v)) { const m = v.map(normTile); saveTrackTiles(m); return m; } }
  } catch { /* no-op */ }
  return structuredClone(TRACK_TILES);
}
export function saveTrackTiles(v) { try { localStorage.setItem(TRACKTILES_KEY, JSON.stringify(v)); } catch { /* no-op */ } }

export function loadTrackTileCap() {
  try { const raw = localStorage.getItem(TRACKTILECAP_KEY); if (raw) return { ...TRACK_TILE_CAP_DEFAULT, ...JSON.parse(raw) }; } catch { /* no-op */ }
  return structuredClone(TRACK_TILE_CAP_DEFAULT);
}
export function saveTrackTileCap(v) { try { localStorage.setItem(TRACKTILECAP_KEY, JSON.stringify(v)); } catch { /* no-op */ } }

// Le tile usano la formula {verbo,f1,f2} delle carte (prendi/perOgni/scambia) + il tipo 'punti' (PV di fine
// partita, solo prendi/perOgni). settore 'carta' = il settore del reparto dove la tile è installata; 'scelta' = pending.
const VERBI = ['prendi', 'scambia', 'perOgni'];
const CONTA = ['icona', 'tensione', 'fabbrica'];
const SETT_OPT = [...SECTORS, 'carta', 'scelta'];
const settLabel = s => (s === 'carta' ? 'reparto' : s);
const wn = (v, max) => Math.max(0, Math.min(max, Number(v) || 0));

// un fattore della formula: quantità + tipo (ris/mon/punti) + settore (solo per risorsa). `pv` abilita 'punti'.
function FattoreTile({ f, onCh, pv }) {
  const set = patch => onCh({ ...f, ...patch });
  return (
    <span style={{ whiteSpace: 'nowrap' }}>
      <input type="number" min="0" max="20" value={f?.q ?? 0} onChange={e => set({ q: wn(e.target.value, 20) })} style={{ width: 38 }} />
      <select value={f?.tipo || 'risorsa'} onChange={e => set({ tipo: e.target.value })}>
        <option value="risorsa">ris.</option><option value="moneta">mon.</option>{pv && <option value="punti">PV</option>}
      </select>
      {f?.tipo === 'risorsa' && <select value={f.settore || 'carta'} onChange={e => set({ settore: e.target.value })}>{SETT_OPT.map(s => <option key={s} value={s}>{settLabel(s)}</option>)}</select>}
    </span>
  );
}

export function TrackTileEditor({ tiles, setTiles, cap, setCap }) {
  const save = next => { setTiles(next); saveTrackTiles(next); };
  const upd = (i, patch) => save(tiles.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  const updEff = (i, patch) => upd(i, { effect: { ...tiles[i].effect, ...patch } });
  const remove = i => save(tiles.filter((_, j) => j !== i));
  const setVerbo = (i, verbo) => {
    const e = tiles[i].effect || {};
    const f1 = e.f1?.tipo ? { ...e.f1 } : { q: 1, tipo: 'risorsa', settore: 'carta' };
    const eff = { verbo, f1 };
    if (verbo === 'scambia') { if (f1.tipo === 'punti') f1.tipo = 'risorsa'; eff.f2 = e.f2?.tipo && e.f2.tipo !== 'punti' ? e.f2 : { q: 1, tipo: 'moneta' }; }
    if (verbo === 'perOgni') eff.f2 = e.f2?.conta ? e.f2 : { conta: 'icona', kind: 'sector', di: 'carta' };
    upd(i, { effect: eff });
  };
  const add = market => save([...tiles, {
    id: 'tt' + Math.random().toString(36).slice(2, 8), market, name: 'Nuova tile',
    effect: { verbo: 'prendi', f1: { q: 1, tipo: 'risorsa', settore: 'carta' } }, cost: 0, copies: 4,
  }]);
  const setMode = mode => { const next = { ...cap, mode }; setCap(next); saveTrackTileCap(next); };
  return (
    <div className="track-editor">
      <p className="hint">Tile acquistabili alla Borsa (Ricerca e Sviluppo — alternativa alle Commesse nella stessa visita, vedi sotto):
        mercato 1 sbloccato dalla milestone in pos.8 (riempie lo slot in pos.7),
        mercato 2 dalla milestone in pos.12 (slot pos.11), mercato 3 dalla milestone in pos.16 (slot pos.15). Stesso
        catalogo per Terziario/Secondario/Primario (un solo editor), ma in partita ogni reparto ha il suo mercato e
        la sua scorta indipendenti: esaurire una tile in un reparto non tocca le copie degli altri due.
        "Costo" in risorse del proprio settore (Tessuti/Acciaio/Coloranti a seconda del reparto), oggi 0 di default.
        <b>Formula</b> come le carte operaio: <code>prendi</code> (risorse/marchi/PV), <code>perOgni</code> (× carte/tensione/fabbriche), <code>scambia</code> (paga fattore 1 → prendi fattore 2). Settore <b>reparto</b> = il settore dove la tile è installata; <b>scelta</b> = decide il giocatore. Il tipo <b>PV</b> vale a fine partita.
        <b>Attiva</b>: "subito" = resa all'acquisto; "produci" = a ogni attivazione del reparto (uno <code>scambia</code> "produci" paga e prende ogni volta, solo se puoi permettertelo).</p>
      <p>
        Scorta: <button className={cap?.mode !== 'limitato' ? 'sel' : ''} onClick={() => setMode('illimitato')}>Illimitata (ogni giocatore sceglie liberamente)</button>{' '}
        <button className={cap?.mode === 'limitato' ? 'sel' : ''} onClick={() => setMode('limitato')}>Limitata ("copie" = pool condiviso tra i giocatori, per reparto)</button>
      </p>
      {[1, 2, 3].map(market => (
        <div key={market} style={{ marginBottom: 16 }}>
          <h4>Mercato {market}</h4>
          <table className="pv-editor">
            <thead><tr><th>Nome</th><th>verbo</th><th>fattore 1</th><th>fattore 2 / contatore</th><th>Costo</th><th>Copie</th><th>Attiva</th><th></th></tr></thead>
            <tbody>
              {tiles.map((t, i) => {
                if (t.market !== market) return null;
                const e = t.effect || { verbo: 'prendi', f1: { q: 1, tipo: 'risorsa', settore: 'carta' } };
                const isPV = e.f1?.tipo === 'punti';
                return (
                <tr key={t.id}>
                  <td><input value={t.name} onChange={ev => upd(i, { name: ev.target.value })} style={{ width: 130 }} /></td>
                  <td><select value={e.verbo} onChange={ev => setVerbo(i, ev.target.value)}>{VERBI.map(v => <option key={v} value={v}>{v}</option>)}</select></td>
                  <td><FattoreTile f={e.f1} onCh={f => updEff(i, { f1: f })} pv={e.verbo !== 'scambia'} /></td>
                  <td>
                    {e.verbo === 'scambia' && <FattoreTile f={e.f2} onCh={f => updEff(i, { f2: f })} pv={false} />}
                    {e.verbo === 'perOgni' && (
                      <span>
                        <select value={e.f2?.conta || 'icona'} onChange={ev => updEff(i, { f2: { ...e.f2, conta: ev.target.value } })}>{CONTA.map(x => <option key={x} value={x}>{x}</option>)}</select>
                        {e.f2?.conta === 'icona' && <select value={e.f2?.di || 'carta'} onChange={ev => updEff(i, { f2: { ...e.f2, kind: 'sector', di: ev.target.value } })}>{[...SECTORS, 'carta'].map(s => <option key={s} value={s}>{settLabel(s)}</option>)}</select>}
                      </span>
                    )}
                    {e.verbo === 'prendi' && <small>—</small>}
                  </td>
                  <td><input type="number" min="0" max="20" value={t.cost} onChange={ev => upd(i, { cost: Math.max(0, Math.min(20, Number(ev.target.value) || 0)) })} style={{ width: 44 }} /></td>
                  <td><input type="number" min="0" max="9" value={t.copies} onChange={ev => upd(i, { copies: Math.max(0, Math.min(9, Number(ev.target.value) || 0)) })} style={{ width: 44 }} /></td>
                  <td>{isPV ? <small>fine</small> : (
                    <button className={t.instant !== false ? 'sel' : ''} onClick={() => upd(i, { instant: t.instant === false })} title="Subito: resa all'acquisto · Produci: a ogni attivazione del reparto">{t.instant !== false ? 'subito' : 'produci'}</button>
                  )}</td>
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
