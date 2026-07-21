import React, { useState } from 'react';
import { BOARDS, TRACK_MODELS, TRACK_MODEL_DEFAULT, BORSA_FABBRICHE_DEFAULT, FACTORY_MAP, DEFAULT_FACTORY_MAPS, SECTORS, SECTOR_COLORS, CONTRACT_COPIES, CLOCK_THRESHOLD, NATIONS, NATIONS_NUOVO, NEW_NODE_BANKS, OBJECTIVE_TILES, TENSION_LIMIT } from '../game/data.js';
import { describeCond } from '../game/engine.js';
import { INDICATOR_TARGETS, INDICATOR_UNITS, recalcTile, starsFor, winZ } from '../game/batchsim.js';
import TrackEditor, {
  loadEditorTrack, toGameTracks, saveEditorTrack,
  TrackTileEditor, loadTrackTiles, loadTrackTileCap,
} from './TrackEditor.jsx';
import SimulationPanel from './SimulationPanel.jsx';
import NewDeckEditor, { loadNewWorkers, NEWWORKERS_KEY, ImpiegatiDeckEditor } from './NewDeckEditor.jsx';

// Default "utente": salvato con "Rendi default". Se presente, sovrascrive il default di codice.
function readDef(key, fallback) {
  try { const r = localStorage.getItem(key + '-def'); if (r) return JSON.parse(r); } catch { /* no-op */ }
  return typeof fallback === 'function' ? fallback() : structuredClone(fallback);
}
function writeDef(key, val) {
  try { localStorage.setItem(key + '-def', JSON.stringify(val)); } catch { /* no-op */ }
}
function saveLS(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* no-op */ } }
function loadLS(key, codeDefault, validate) {
  try { const r = localStorage.getItem(key); if (r) { const v = JSON.parse(r); if (!validate || validate(v)) return v; } } catch { /* no-op */ }
  return readDef(key, codeDefault);
}

// --- Plancia giocatore: slot Sopra/Sotto per reparto + Direzione, Tensione iniziale ---
const SLOTS_DEFAULT = { terziario: { sopra: 3, sotto: 2 }, secondario: { sopra: 3, sotto: 2 }, primario: { sopra: 3, sotto: 2 }, direzione: { sopra: 3, sotto: 0 } };
const TENSION_DEFAULT = { terziario: 0, secondario: 0, primario: 0 };
const ROLE_LABELS = { terziario: 'Terziario', secondario: 'Secondario', primario: 'Primario', direzione: 'Direzione' };
export const loadSlots = () => loadLS('officina1907-slots-v1', SLOTS_DEFAULT);
export const loadTension = () => loadLS('officina1907-tension-v1', TENSION_DEFAULT);

// --- Commesse: quante carte estrarre dal pool, quante scoperte, PV 1° posto ---
// Combo per taglia (filtrate per difficoltà): piccole 7, medie 6, grandi 15.
// Pool = combo × copie (CONTRACT_COPIES: piccole/medie ×2, grandi ×1) → piccole 14, medie 12, grandi 15.
// «Carte nel mazzo» = quante estrarre a caso dal pool per formare il mazzo di gioco (max = pool).
const COMBO_UNIQUE = { small: 7, medium: 6, large: 15 };
const COMBO_MAX = { small: COMBO_UNIQUE.small * CONTRACT_COPIES.small, medium: COMBO_UNIQUE.medium * CONTRACT_COPIES.medium, large: COMBO_UNIQUE.large * CONTRACT_COPIES.large };
const COUNT_DEFAULT = { small: 6, medium: 6, large: 6 };
const MARKET_DEFAULT = 2;
const SIZE_ROWS = [['small', 'Piccole (3 risorse)'], ['medium', 'Medie (5 risorse)'], ['large', 'Grandi (7 risorse)']];
export const loadCount = () => loadLS('officina1907-contractcount-v4', COUNT_DEFAULT);
export const loadMarket = () => loadLS('officina1907-market-v2', MARKET_DEFAULT);
// requisito milestone (0-3) per completare commesse di ogni taglia
const MILESTONEREQ_DEFAULT = { small: 0, medium: 0, large: 0 };
export const loadMilestoneReq = () => loadLS('officina1907-contractmsreq-v2', MILESTONEREQ_DEFAULT);

// --- Clock: quante commesse completate chiudono la partita, per numero di giocatori (durata) ---
const CLOCKS_DEFAULT = { ...CLOCK_THRESHOLD };
export const loadClocks = () => loadLS('officina1907-clocks-v1', CLOCKS_DEFAULT);

// --- Bersagli indicatori (sezione 5 "fuori range"): [min,max] per indicatore, decisi dal designer ---
const TARGETS_DEFAULT = structuredClone(INDICATOR_TARGETS);
const validTargets = v => v && typeof v === 'object' && Object.keys(INDICATOR_TARGETS).every(k => Array.isArray(v[k]) && v[k].length === 2);
export const loadTargets = () => loadLS('officina1907-targets-v1', TARGETS_DEFAULT, validTargets);

export const loadWelfareEnabled = () => loadLS('officina1907-welfareenabled-v1', true);

function PlanciaEditor({ slots, setSlots, tension, setTension, track, setTrack, trackModel, setTrackModel }) {
  const updSlot = (role, side, v) => { const next = structuredClone(slots); next[role][side] = Math.max(0, Math.min(9, Number(v) || 0)); setSlots(next); saveLS('officina1907-slots-v1', next); };
  const updTen = (role, v) => { const next = { ...tension, [role]: Math.max(0, Math.min(9, Number(v) || 0)) }; setTension(next); saveLS('officina1907-tension-v1', next); };
  return (
    <div className="track-editor">
      <p className="hint">Carte installabili per reparto (Sopra / Sotto) e Tensione iniziale. Salvato nel browser.</p>
      <table className="pv-editor">
        <thead><tr><th>Reparto</th><th>Sopra</th><th>Sotto</th><th>Tensione iniz.</th></tr></thead>
        <tbody>
          {Object.keys(SLOTS_DEFAULT).map(role => (
            <tr key={role}>
              <td style={{ textAlign: 'left' }}>{ROLE_LABELS[role]}</td>
              <td><input type="number" min="0" max="9" value={slots[role].sopra} onChange={e => updSlot(role, 'sopra', e.target.value)} style={{ width: 44 }} /></td>
              <td><input type="number" min="0" max="9" value={slots[role].sotto} onChange={e => updSlot(role, 'sotto', e.target.value)} style={{ width: 44 }} /></td>
              <td>{role === 'direzione' ? <small>—</small> : <input type="number" min="0" max="9" value={tension[role]} onChange={e => updTen(role, e.target.value)} style={{ width: 44 }} />}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="ghost" onClick={() => { const s = readDef('officina1907-slots-v1', SLOTS_DEFAULT), t = readDef('officina1907-tension-v1', TENSION_DEFAULT); setSlots(structuredClone(s)); setTension({ ...t }); saveLS('officina1907-slots-v1', s); saveLS('officina1907-tension-v1', t); }}>Ripristina default</button>
      <button className="ghost" onClick={() => { writeDef('officina1907-slots-v1', slots); writeDef('officina1907-tension-v1', tension); }}>⭐ Rendi questi valori i default</button>
      <hr />
      <h4 style={{ textAlign: 'left' }}>Tracciato produzione</h4>
      <h4 style={{ marginTop: 16 }}>Modello di tracciato</h4>
      <p className="hint">
        <b>Classico</b>: 16 caselle, slot tile e milestone sono due passi distinti.{' '}
        <b>Unito</b>: 12 caselle, come la plancia stampata — D1+D2 e le tre coppie slot+milestone sono
        una casella doppia sola (la tile ne copre due), e arrivarci dà slot e milestone insieme.
        Ogni modello ha il suo tracciato salvato a parte: cambiando qui non perdi le modifiche dell'altro.
      </p>
      <div style={{ margin: '6px 0 12px' }}>
        {Object.entries(TRACK_MODELS).map(([key, m]) => (
          <button key={key} className={trackModel === key ? 'sel' : ''} onClick={() => setTrackModel(key)}>{m.label}</button>
        ))}
      </div>
      <TrackEditor track={track} setTrack={setTrack} model={trackModel} />
    </div>
  );
}

function CommesseEditor({ count, setCount, market, setMarket, pv, setPV, milestoneReq, setMilestoneReq }) {
  const updCount = (size, v) => { const next = { ...count, [size]: Math.max(1, Math.min(COMBO_MAX[size], Number(v) || 1)) }; setCount(next); saveLS('officina1907-contractcount-v4', next); };
  const updPV = (size, v) => { const next = structuredClone(pv); next[size][0] = Math.max(0, Math.min(99, Number(v) || 0)); setPV(next); saveLS('officina1907-contractpv-v1', next); };
  const updMarket = v => { const x = Math.max(1, Math.min(12, Number(v) || 1)); setMarket(x); saveLS('officina1907-market-v2', x); };
  const updMS = (size, v) => { const next = { ...milestoneReq, [size]: Math.max(0, Math.min(3, Number(v) || 0)) }; setMilestoneReq(next); saveLS('officina1907-contractmsreq-v2', next); };
  return (
    <div className="track-editor">
      <p className="hint">Pool per taglia = combo in duplice copia (piccole {COMBO_MAX.small}, medie {COMBO_MAX.medium}) o singola (grandi {COMBO_MAX.large}). A inizio partita il pool è mescolato e ne vengono estratte «Carte nel mazzo» (max = pool) per formare il mazzo di gioco. «Scoperte» = quante visibili a inizio partita (si rinfrescano a completamento). «Milestone» = milestone di tracciato (0-3) per completare una commessa di quella taglia. Salvato nel browser.</p>
      <table className="pv-editor">
        <thead><tr><th>Taglia</th><th>Carte nel mazzo</th><th>PV vincitore</th><th>Milestone richieste</th></tr></thead>
        <tbody>
          {SIZE_ROWS.map(([size, label]) => (
            <tr key={size}>
              <td style={{ textAlign: 'left' }}>{label}</td>
              <td><input type="number" min="1" max={COMBO_MAX[size]} value={count[size]} onChange={e => updCount(size, e.target.value)} style={{ width: 48 }} /> <small>/ {COMBO_MAX[size]}</small></td>
              <td><input type="number" min="0" max="99" value={pv[size][0]} onChange={e => updPV(size, e.target.value)} style={{ width: 48 }} /></td>
              <td>
                <select value={milestoneReq[size]} onChange={e => updMS(size, e.target.value)}>
                  {[0, 1, 2, 3].map(x => <option key={x} value={x}>{x}</option>)}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <label className="hint">Carte scoperte per taglia a inizio partita: <input type="number" min="1" max="12" value={market} onChange={e => updMarket(e.target.value)} style={{ width: 48 }} /></label>
      <div>
        <button className="ghost" onClick={() => { const c = readDef('officina1907-contractcount-v4', COUNT_DEFAULT), m = readDef('officina1907-market-v2', MARKET_DEFAULT), p = readDef('officina1907-contractpv-v1', PV_DEFAULTS), ms = readDef('officina1907-contractmsreq-v2', MILESTONEREQ_DEFAULT); setCount({ ...c }); setMarket(m); setPV(structuredClone(p)); setMilestoneReq({ ...ms }); saveLS('officina1907-contractcount-v4', c); saveLS('officina1907-market-v2', m); saveLS('officina1907-contractpv-v1', p); saveLS('officina1907-contractmsreq-v2', ms); }}>Ripristina default</button>
        <button className="ghost" onClick={() => { writeDef('officina1907-contractcount-v4', count); writeDef('officina1907-market-v2', market); writeDef('officina1907-contractpv-v1', pv); writeDef('officina1907-contractmsreq-v2', milestoneReq); }}>⭐ Rendi questi valori i default</button>
      </div>
    </div>
  );
}

const PV_DEFAULTS = { small: [5, 3], medium: [9, 7], large: [15, 13] };
const PV_LABELS = { small: 'Piccole (3 risorse)', medium: 'Medie (5 risorse)', large: 'Grandi (7 risorse)' };

function loadContractPV() {
  try {
    const raw = localStorage.getItem('officina1907-contractpv-v1');
    if (raw) {
      const v = JSON.parse(raw);
      if (['small', 'medium', 'large'].every(k => Array.isArray(v[k]) && v[k].length === 2)) return v;
    }
  } catch { /* default */ }
  return readDef('officina1907-contractpv-v1', PV_DEFAULTS);
}

const STRIKEPV_DEFAULT = 3;
export function loadStrikePV() {
  try {
    const raw = localStorage.getItem('officina1907-strikepv-v1');
    if (raw !== null) { const v = Number(JSON.parse(raw)); if (Number.isFinite(v) && v >= 0) return v; }
  } catch { /* default */ }
  return readDef('officina1907-strikepv-v1', STRIKEPV_DEFAULT);
}

const STARTCOINS_DEFAULT = [10, 10, 10, 10];

export function loadStartCoins() {
  try {
    const raw = localStorage.getItem('officina1907-startcoins-v1');
    if (raw) {
      const v = JSON.parse(raw);
      if (Array.isArray(v) && v.length === 4 && v.every(x => Number.isFinite(x))) return v;
    }
  } catch { /* default */ }
  return readDef('officina1907-startcoins-v1', STARTCOINS_DEFAULT);
}

function StartCoinsEditor({ coins, setCoins, n }) {
  const upd = (i, value) => {
    const next = coins.map((c, j) => (j === i ? Math.max(0, Math.min(99, Number(value) || 0)) : c));
    setCoins(next);
    try { localStorage.setItem('officina1907-startcoins-v1', JSON.stringify(next)); } catch { /* no-op */ }
  };
  const reset = () => { const d = readDef('officina1907-startcoins-v1', STARTCOINS_DEFAULT); setCoins([...d]); try { localStorage.setItem('officina1907-startcoins-v1', JSON.stringify(d)); } catch { /* no-op */ } };
  return (
    <div className="track-editor">
      <p className="hint">Marchi con cui ogni giocatore inizia la partita (setup). Salvato nel browser.</p>
      <table className="pv-editor">
        <thead><tr><th>Giocatore</th><th>Marchi iniziali</th></tr></thead>
        <tbody>
          {coins.slice(0, n).map((c, i) => (
            <tr key={i}>
              <td>{i + 1}°</td>
              <td><input type="number" min="0" max="99" value={c} onChange={e => upd(i, e.target.value)} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="ghost" onClick={reset}>Ripristina default</button>
      <button className="ghost" onClick={() => writeDef('officina1907-startcoins-v1', coins)}>⭐ Rendi questi valori i default</button>
    </div>
  );
}

const CONV_DEFAULTS = { coinsPerPV: 10, resPerPV: 2 };

export function loadConversions() {
  try {
    const raw = localStorage.getItem('officina1907-conv-v1');
    if (raw) {
      const v = JSON.parse(raw);
      if (v.coinsPerPV >= 1 && v.resPerPV >= 1) return v;
    }
  } catch { /* default */ }
  return readDef('officina1907-conv-v1', CONV_DEFAULTS);
}

function ConversionsEditor({ conv, setConv, strikePV, setStrikePV }) {
  const upd = (key, value) => {
    const next = { ...conv, [key]: Math.max(1, Math.min(20, Number(value) || 1)) };
    setConv(next);
    try { localStorage.setItem('officina1907-conv-v1', JSON.stringify(next)); } catch { /* no-op */ }
  };
  const updStrike = v => { const x = Math.max(0, Math.min(99, Number(v) || 0)); setStrikePV(x); try { localStorage.setItem('officina1907-strikepv-v1', JSON.stringify(x)); } catch { /* no-op */ } };
  return (
    <div className="track-editor">
      <p className="hint">Conversioni di fine partita e penalità Scioperi. Salvato nel browser.</p>
      <table className="pv-editor">
        <tbody>
          <tr>
            <td><input type="number" min="1" max="20" value={conv.coinsPerPV} onChange={e => upd('coinsPerPV', e.target.value)} /> marchi</td>
            <td>= 1 PV</td>
            <td><input type="number" min="1" max="20" value={conv.resPerPV} onChange={e => upd('resPerPV', e.target.value)} /> risorse uguali</td>
            <td>= 1 PV</td>
          </tr>
          <tr>
            <td>Ogni carta bloccata a fine partita</td>
            <td>= −<input type="number" min="0" max="99" value={strikePV} onChange={e => updStrike(e.target.value)} style={{ width: 48 }} /> PV</td>
            <td colSpan="2"><small>(0 = nessuna penalità)</small></td>
          </tr>
        </tbody>
      </table>
      <button className="ghost" onClick={() => { const d = readDef('officina1907-conv-v1', CONV_DEFAULTS); setConv({ ...d }); updStrike(readDef('officina1907-strikepv-v1', STRIKEPV_DEFAULT)); try { localStorage.setItem('officina1907-conv-v1', JSON.stringify(d)); } catch { /* no-op */ } }}>
        Ripristina default
      </button>
      <button className="ghost" onClick={() => { writeDef('officina1907-conv-v1', conv); writeDef('officina1907-strikepv-v1', strikePV); }}>⭐ Rendi questi valori i default</button>
    </div>
  );
}

function TargetEditor({ targets, setTargets }) {
  const isPct = k => INDICATOR_UNITS[k] === '%';
  const upd = (k, idx, val) => {
    const n = Number(val), stored = isPct(k) ? (isFinite(n) ? n / 100 : 0) : (isFinite(n) ? n : 0);
    const next = { ...targets, [k]: idx === 0 ? [stored, targets[k][1]] : [targets[k][0], stored] };
    setTargets(next); saveLS('officina1907-targets-v1', next);
  };
  const disp = (k, idx) => { const v = targets[k][idx]; return isPct(k) ? Math.round(v * 100) : v; };
  return (
    <div className="track-editor">
      <p className="hint">Bersagli che decidi TU per gli indicatori "fuori range" (sezione 5). Il simulatore misura solo la distanza da questi numeri, non sa quale sia giusto. min=0 → mostrato come "&lt;max". Salvato nel browser.</p>
      <table className="pv-editor">
        <thead><tr><th style={{ textAlign: 'left' }}>Indicatore</th><th>min</th><th>max</th><th>unità</th></tr></thead>
        <tbody>
          {Object.keys(targets).map(k => (
            <tr key={k}>
              <td style={{ textAlign: 'left' }}>{k}</td>
              <td><input type="number" value={disp(k, 0)} onChange={e => upd(k, 0, e.target.value)} style={{ width: 56 }} /></td>
              <td><input type="number" value={disp(k, 1)} onChange={e => upd(k, 1, e.target.value)} style={{ width: 56 }} /></td>
              <td><small>{isPct(k) ? '%' : 'valore'}</small></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="ghost" onClick={() => { const d = readDef('officina1907-targets-v1', TARGETS_DEFAULT); setTargets(structuredClone(d)); saveLS('officina1907-targets-v1', d); }}>Ripristina default</button>
      <button className="ghost" onClick={() => writeDef('officina1907-targets-v1', targets)}>⭐ Rendi questi valori i default</button>
    </div>
  );
}

function ClockEditor({ clocks, setClocks }) {
  const upd = (k, v) => { const next = { ...clocks, [k]: Math.max(1, Math.min(60, Number(v) || 0)) }; setClocks(next); saveLS('officina1907-clocks-v1', next); };
  return (
    <div className="track-editor">
      <p className="hint">Il Clock sale +1 a ogni commessa completata; a soglia la partita finisce. Più clock = partita più lunga. Salvato nel browser.</p>
      <table className="pv-editor">
        <thead><tr><th>Giocatori</th><th>Clock a fine partita</th></tr></thead>
        <tbody>
          {[2, 3, 4].map(k => (
            <tr key={k}>
              <td style={{ textAlign: 'left' }}>{k} giocatori</td>
              <td><input type="number" min="1" max="60" value={clocks[k]} onChange={e => upd(k, e.target.value)} style={{ width: 56 }} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="ghost" onClick={() => { const d = readDef('officina1907-clocks-v1', CLOCKS_DEFAULT); setClocks({ ...d }); saveLS('officina1907-clocks-v1', d); }}>Ripristina default</button>
      <button className="ghost" onClick={() => writeDef('officina1907-clocks-v1', clocks)}>⭐ Rendi questi valori i default</button>
    </div>
  );
}

const WSETT = ['Tessile', 'Metallurgica', 'Chimica'];



// --- Piano Industriale: 32 tessere × 3 obiettivi (testo, PV, condizione) ---
const COND_TYPES = ['milestones', 'workers_nation', 'same_nation', 'distinct_nations', 'all_tension_zero', 'activation_coins', 'sotto_each', 'sopra_each', 'direzione', 'full_dept', 'no_blocked_end', 'contracts_mix', 'sector_leader', 'direzione_full'];
const COND_LABELS = {
  milestones: 'Milestone tracciati',
  workers_nation: 'N lavoratori di una nazione',
  same_nation: 'N lavoratori stessa nazione (qualsiasi)',
  distinct_nations: 'N nazioni diverse',
  all_tension_zero: 'Tensioni dei reparti a fine partita',
  activation_coins: 'Marchi/attivazione ≥ N',
  sotto_each: 'N carte Sotto in ogni reparto',
  sopra_each: 'N carte Sopra in ogni reparto',
  direzione: 'N carte in Direzione',
  full_dept: 'Reparto pieno (Sopra+Sotto)',
  no_blocked_end: 'Nessuna carta bloccata a fine partita',
  contracts_mix: 'Mix commesse (piccole/medie/grandi)',
  sector_leader: 'Settore leader + tutte milestone',
  direzione_full: 'Direzione piena (Impiegati)',
};
const TENSION_ROLES = ['terziario', 'secondario', 'primario'];
function defaultCond(type) {
  switch (type) {
    case 'milestones': return { type, sectors: [{ sector: 'Chimica', milestone: 1 }, { sector: 'Tessile', milestone: 1 }] };
    case 'workers_nation': return { type, n: 4, nation: NATIONS[0] };
    case 'same_nation': return { type, n: 4 };
    case 'distinct_nations': return { type, n: 3 };
    case 'activation_coins': return { type, n: 9 };
    case 'sotto_each': return { type, n: 1 };
    case 'sopra_each': return { type, n: 2 };
    case 'direzione': return { type, side: 'sopra', n: 2 };
    case 'full_dept': return { type, sopra: 3, sotto: 2 };
    case 'all_tension_zero': return { type, targets: { terziario: 0, secondario: 0, primario: 0 } };
    case 'contracts_mix': return { type, small: 1, medium: 0, large: 0 };
    case 'sector_leader': return { type, sector: WSETT[0] };
    case 'direzione_full': return { type, sopra: 3, sotto: 0 };
    default: return { type }; // no_blocked_end: nessun parametro
  }
}
function CondParams({ cond, onCh }) {
  const upd = patch => onCh({ ...cond, ...patch });
  const num = (v, max) => Math.max(1, Math.min(max, Number(v) || 1));
  switch (cond.type) {
    case 'milestones': {
      // cond.sectors: [{sector, milestone:1|2|3}] — retrocompatibile con vecchie tessere salvate (stringa nuda = M1).
      const sectorOf = e => (typeof e === 'string' ? e : e.sector);
      const levelOf = e => (typeof e === 'string' ? 1 : (e.milestone ?? 1));
      const setEntry = (s, checked, milestone) => {
        const rest = cond.sectors.filter(e => sectorOf(e) !== s);
        upd({ sectors: checked ? [...rest, { sector: s, milestone }] : rest });
      };
      return WSETT.map(s => {
        const entry = cond.sectors.find(e => sectorOf(e) === s);
        const level = entry ? levelOf(entry) : 1;
        return (
          <label key={s} style={{ marginRight: 6, whiteSpace: 'nowrap' }}>
            <input type="checkbox" checked={!!entry} onChange={e => setEntry(s, e.target.checked, level)} />
            {s.slice(0, 4)}
            {entry && (
              <select value={level} onChange={e => setEntry(s, true, Number(e.target.value))} style={{ marginLeft: 3 }}>
                <option value={1}>M1</option><option value={2}>M2</option><option value={3}>M3</option>
              </select>
            )}
          </label>
        );
      });
    }
    case 'workers_nation':
      return (
        <span>
          <select value={cond.nation} onChange={e => upd({ nation: e.target.value })}>{NATIONS.map(n => <option key={n} value={n}>{n}</option>)}</select>
          <input type="number" min="1" max="14" value={cond.n} onChange={e => upd({ n: num(e.target.value, 14) })} style={{ width: 52 }} />
        </span>
      );
    case 'same_nation':
    case 'distinct_nations':
    case 'sotto_each':
    case 'sopra_each':
      return <input type="number" min="1" max="14" value={cond.n} onChange={e => upd({ n: num(e.target.value, 14) })} style={{ width: 52 }} />;
    case 'activation_coins':
      return <input type="number" min="1" max="20" value={cond.n} onChange={e => upd({ n: num(e.target.value, 20) })} style={{ width: 52 }} />;
    case 'direzione':
      return (
        <span>
          <select value={cond.side} onChange={e => upd({ side: e.target.value })}>
            <option value="sopra">Sopra</option><option value="sotto">Sotto</option><option value="any">Sopra+Sotto</option>
          </select>
          <input type="number" min="1" max="8" value={cond.n} onChange={e => upd({ n: num(e.target.value, 8) })} style={{ width: 40 }} />
        </span>
      );
    case 'full_dept':
      return (
        <span>
          S<input type="number" min="0" max="5" value={cond.sopra} onChange={e => upd({ sopra: Math.max(0, Math.min(5, Number(e.target.value) || 0)) })} style={{ width: 36 }} />
          {' '}s<input type="number" min="0" max="5" value={cond.sotto} onChange={e => upd({ sotto: Math.max(0, Math.min(5, Number(e.target.value) || 0)) })} style={{ width: 36 }} />
          {' '}×<input type="number" min="1" max="3" value={cond.minCount ?? 1} onChange={e => upd({ minCount: Math.max(1, Math.min(3, Number(e.target.value) || 1)) })} style={{ width: 32 }} />
        </span>
      );
    case 'all_tension_zero':
      return TENSION_ROLES.map(r => (
        <label key={r} style={{ marginRight: 6, whiteSpace: 'nowrap' }}>
          {r.slice(0, 4)}
          <input type="number" min="0" max={TENSION_LIMIT} value={cond.targets?.[r] ?? 0}
            onChange={e => upd({ targets: { ...cond.targets, [r]: Math.max(0, Math.min(TENSION_LIMIT, Number(e.target.value) || 0)) } })}
            style={{ width: 44, marginLeft: 3 }} />
        </label>
      ));
    case 'contracts_mix':
      return ['small', 'medium', 'large'].map((s, i) => (
        <label key={s} style={{ marginRight: 6, whiteSpace: 'nowrap' }}>
          {['p', 'm', 'g'][i]}
          <input type="number" min="0" max="8" value={cond[s] || 0}
            onChange={e => upd({ [s]: Math.max(0, Math.min(8, Number(e.target.value) || 0)) })}
            style={{ width: 40, marginLeft: 3 }} />
        </label>
      ));
    case 'sector_leader':
      return <select value={cond.sector} onChange={e => upd({ sector: e.target.value })}>{WSETT.map(s => <option key={s} value={s}>{s}</option>)}</select>;
    case 'direzione_full':
      return (
        <span>
          S<input type="number" min="0" max="9" value={cond.sopra} onChange={e => upd({ sopra: Math.max(0, Math.min(9, Number(e.target.value) || 0)) })} style={{ width: 36 }} />
          {' '}s<input type="number" min="0" max="9" value={cond.sotto} onChange={e => upd({ sotto: Math.max(0, Math.min(9, Number(e.target.value) || 0)) })} style={{ width: 36 }} />
        </span>
      );
    default:
      return <small>—</small>; // no_blocked_end
  }
}
const TILES_LS_KEY = 'officina1907-tiles-v2';
// struttura, non conteggio fisso: il motore itera p.tile.objectives per indice (nessun limite a 32/3) — le tessere
// generate dal modo Famiglie (es. 25 × 2 obiettivi) sono valide quanto le 32 × 3 classiche, già testate su batch da 500.
const validObjective = o => o && typeof o.pv === 'number' && o.cond && typeof o.cond.type === 'string';
const validTiles = v => Array.isArray(v) && v.length > 0 && v.every(t => t && t.id && Array.isArray(t.objectives) && t.objectives.length > 0 && t.objectives.every(validObjective));
export const loadTiles = () => loadLS(TILES_LS_KEY, OBJECTIVE_TILES, validTiles);

// Scheda risultato di un Ricalcola: stesse metriche della SCHEDA TESSERE del report grande, ma su un batch mirato.
// z-score win vs 1/P: confrontabile 1:1 col report grande (es. "+4.3σ → +1.1σ" dopo una modifica). La facilità
// (regalo/muro) invece è relativa alle ALTRE 31 tessere: senza girare anche quelle qui non è calcolabile — restano
// i tre numeri grezzi degli obiettivi, già sufficienti a occhio per uno "è un regalo?".
function TileCard({ r, P }) {
  if (!r) return <small>0 partite valide.</small>;
  const z = winZ(r.wr, r.games, P);
  return (
    <div style={{ fontSize: 12, marginTop: 4 }}>
      <div>win <b>{(100 * r.wr).toFixed(0)}%</b> su {r.games} ({z >= 0 ? '+' : ''}{z.toFixed(1)}σ) · {starsFor(r.games)}</div>
      {r.objRates.map((rate, i) => <div key={i}>obiettivo{i + 1}: {rate == null ? '—' : (100 * rate).toFixed(0) + '%'}</div>)}
      <div>PV: obiettivi {r.pvObjAvg.toFixed(1)} · commesse {r.pvContractsAvg.toFixed(1)} · tracciati {r.pvTrackAvg.toFixed(1)} · commesse/partita {r.nContractsAvg.toFixed(1)}</div>
    </div>
  );
}

function TilesEditor({ tiles, setTiles, baseCfg }) {
  const save = next => { setTiles(next); saveLS(TILES_LS_KEY, next); };
  const updObj = (ti, oi, patch) => save(tiles.map((t, i) => i !== ti ? t : { ...t, objectives: t.objectives.map((o, j) => j !== oi ? o : { ...o, ...patch }) }));
  const [recalc, setRecalc] = useState({}); // tileId -> {running, progress:{done,total}, result}
  const runRecalc = async (tile) => {
    setRecalc(r => ({ ...r, [tile.id]: { running: true, progress: { done: 0, total: 150 } } }));
    const result = await recalcTile(baseCfg, tile, { nGames: 150, onProgress: (done, total) => setRecalc(r => ({ ...r, [tile.id]: { running: true, progress: { done, total } } })) });
    setRecalc(r => ({ ...r, [tile.id]: { running: false, result } }));
  };
  return (
    <div className="track-editor">
      <p className="hint">{tiles.length} tessere Piano Industriale (assegnate a caso a inizio partita, una per giocatore). Il testo è generato dalla condizione, non editabile — cambia PV/condizione/parametri e il testo si aggiorna da solo, niente da riscrivere a mano. "Ricalcola" gira 150 partite forzando questa tessera su un posto (rotante), per una stima rapida senza rifare le 500 partite intere — 4 AI fisse, resto delle regole = impostazioni correnti. Salvato nel browser.</p>
      <div style={{ maxHeight: 420, overflowY: 'auto' }}>
        <table className="pv-editor">
          <thead><tr><th>Tessera</th><th>#</th><th>Testo (generato)</th><th>PV</th><th>Condizione</th><th>Parametri</th></tr></thead>
          <tbody>
            {tiles.map((t, ti) => {
              const rc = recalc[t.id];
              return t.objectives.map((o, oi) => (
                <tr key={`${t.id}-${oi}`}>
                  {oi === 0 && (
                    <td rowSpan={3}>
                      {t.name}
                      <div style={{ marginTop: 6 }}>
                        <button className="ghost" disabled={rc?.running} onClick={() => runRecalc(t)} style={{ fontSize: 11 }}>
                          {rc?.running ? `⏳ ${rc.progress.done}/${rc.progress.total}` : '🔄 Ricalcola (150)'}
                        </button>
                      </div>
                      {rc && !rc.running && <TileCard r={rc.result} P={baseCfg.nPlayers ?? 4} />}
                    </td>
                  )}
                  <td>{oi + 1}</td>
                  <td style={{ textAlign: 'left', maxWidth: 260 }}><small>{describeCond(o.cond)}</small></td>
                  <td><input type="number" min="1" max="20" value={o.pv} onChange={e => updObj(ti, oi, { pv: Math.max(1, Math.min(20, Number(e.target.value) || 1)) })} style={{ width: 52 }} /></td>
                  <td>
                    <select value={o.cond.type} onChange={e => updObj(ti, oi, { cond: defaultCond(e.target.value) })}>
                      {COND_TYPES.map(ct => <option key={ct} value={ct}>{COND_LABELS[ct]}</option>)}
                    </select>
                  </td>
                  <td><CondParams cond={o.cond} onCh={c => updObj(ti, oi, { cond: c })} /></td>
                </tr>
              ));
            })}
          </tbody>
        </table>
      </div>
      <button className="ghost" onClick={() => { const d = readDef(TILES_LS_KEY, OBJECTIVE_TILES); save(structuredClone(d)); }}>Ripristina default</button>
      <button className="ghost" onClick={() => writeDef(TILES_LS_KEY, tiles)}>⭐ Rendi questi valori i default</button>
    </div>
  );
}

// --- Piano Industriale "nuovo": famiglie di obiettivi, 5 per famiglia, editabili. Ogni Piano Industriale
// generato pesca 1 obiettivo per famiglia (prodotto cartesiano) — non si editano le tessere generate, si
// editano i mattoni e la modifica si propaga a tutte le combinazioni che li usano.
// Famiglia Commesse rimossa (ingestibile: il mix di taglie non si lascia calibrare al 70-85% in modo stabile).
const FAMILY_LABELS = ['Nazionalità', 'Industriale'];
const familiesDefault = () => [
  NATIONS_NUOVO.map(nation => ({ pv: 7, cond: { type: 'workers_nation', nation, n: 4 } })),
  [
    { pv: 7, cond: { type: 'sector_leader', sector: 'Tessile' } },
    { pv: 7, cond: { type: 'sector_leader', sector: 'Metallurgica' } },
    { pv: 7, cond: { type: 'sector_leader', sector: 'Chimica' } },
    { pv: 7, cond: { type: 'direzione_full', sopra: 3, sotto: 0 } },
    { pv: 7, cond: { type: 'full_dept', sopra: 3, sotto: 2, minCount: 2 } },
  ],
];
const FAMILIES_LS_KEY = 'officina1907-families-v2';
const validFamilies = v => Array.isArray(v) && v.length === FAMILY_LABELS.length && v.every(f => Array.isArray(f) && f.length > 0);
export const loadFamilies = () => loadLS(FAMILIES_LS_KEY, familiesDefault, validFamilies);
// prodotto cartesiano delle famiglie: ogni Piano Industriale = 1 obiettivo per famiglia (stessa forma di
// OBJECTIVE_TILES, così initGame/batchsim non cambiano — vedono solo un array di tessere più grande).
// Generico sul numero di famiglie: funziona con 2 come con 3+ se in futuro se ne aggiungono altre.
function cartesian(families) {
  return families.reduce((acc, fam) => acc.flatMap(combo => fam.map(o => [...combo, o])), [[]]);
}
export function buildFamilyTiles(families) {
  return cartesian(families).map((objectives, i) => ({ id: `pf${i + 1}`, name: `Piano ${i + 1}`, objectives }));
}
// 5 tessere di esempio (obiettivo i-esimo di ciascuna famiglia, diagonale) — per vederle come tessere vere e
// testarle col Ricalcola, senza dover scorrere tutte le combinazioni. Sola lettura: si editano i mattoni sopra,
// queste si aggiornano da sole.
export function buildShowcaseTiles(families) {
  // famiglie di lunghezza diversa (es. 6 nazioni × 5 industria): itero sulla più corta così ogni
  // riga-esempio ha un obiettivo per famiglia, mai undefined.
  const n = Math.min(...families.map(f => f.length));
  return Array.from({ length: n }, (_, i) => ({ id: `pfshow${i + 1}`, name: `Piano Nuovo ${i + 1}`, objectives: families.map(fam => fam[i]) }));
}

function FamilyEditor({ families, setFamilies, baseCfg }) {
  const save = next => { setFamilies(next); saveLS(FAMILIES_LS_KEY, next); };
  const updObj = (fi, oi, patch) => save(families.map((fam, i) => i !== fi ? fam : fam.map((o, j) => j !== oi ? o : { ...o, ...patch })));
  const showcase = buildShowcaseTiles(families);
  const [recalc, setRecalc] = useState({});
  const runRecalc = async (tile) => {
    setRecalc(r => ({ ...r, [tile.id]: { running: true, progress: { done: 0, total: 150 } } }));
    const result = await recalcTile(baseCfg, tile, { nGames: 150, onProgress: (done, total) => setRecalc(r => ({ ...r, [tile.id]: { running: true, progress: { done, total } } })) });
    setRecalc(r => ({ ...r, [tile.id]: { running: false, result } }));
  };
  return (
    <div className="track-editor">
      <p className="hint">{FAMILY_LABELS.length} famiglie ({families.map(f => f.length).join(' × ')}) = {families.reduce((a, f) => a + f.length, 0)} mattoni. Ogni Piano Industriale nuovo pesca 1 obiettivo per famiglia — {families.reduce((a, f) => a * f.length, 1)} combinazioni generate automaticamente, non editabili una per una: modifica qui i mattoni e si propaga a tutte le tessere che li usano. Testo generato dalla condizione. Per usarli in partita/simulazione, attiva "Piano Industriale: nuovo" sopra. Salvato nel browser.</p>
      <div style={{ maxHeight: 420, overflowY: 'auto' }}>
        <table className="pv-editor">
          <thead><tr><th>Famiglia</th><th>#</th><th>Testo (generato)</th><th>PV</th><th>Condizione</th><th>Parametri</th></tr></thead>
          <tbody>
            {families.map((fam, fi) => fam.map((o, oi) => (
              <tr key={`${fi}-${oi}`}>
                {oi === 0 && <td rowSpan={fam.length}>{FAMILY_LABELS[fi]}</td>}
                <td>{oi + 1}</td>
                <td style={{ textAlign: 'left', maxWidth: 260 }}><small>{describeCond(o.cond)}</small></td>
                <td><input type="number" min="1" max="20" value={o.pv} onChange={e => updObj(fi, oi, { pv: Math.max(1, Math.min(20, Number(e.target.value) || 1)) })} style={{ width: 52 }} /></td>
                <td>
                  <select value={o.cond.type} onChange={e => updObj(fi, oi, { cond: defaultCond(e.target.value) })}>
                    {COND_TYPES.map(ct => <option key={ct} value={ct}>{COND_LABELS[ct]}</option>)}
                  </select>
                </td>
                <td><CondParams cond={o.cond} onCh={c => updObj(fi, oi, { cond: c })} /></td>
              </tr>
            )))}
          </tbody>
        </table>
      </div>
      <button className="ghost" onClick={() => save(familiesDefault())}>Ripristina default</button>
      <button className="ghost" onClick={() => writeDef(FAMILIES_LS_KEY, families)}>⭐ Rendi questi valori i default</button>

      <p className="hint" style={{ marginTop: 16 }}>Tessere di esempio (1 combinazione per riga delle famiglie sopra, non tutte) — sola lettura, si aggiornano da sole se modifichi i mattoni. "Ricalcola" gira 150 partite come nell'editor Tessere fisse.</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        {showcase.map(t => {
          const rc = recalc[t.id];
          return (
            <div key={t.id} className="pv-editor" style={{ border: '1px solid #444', borderRadius: 6, padding: 10, width: 260 }}>
              <b>{t.name}</b>
              <ul style={{ margin: '6px 0', paddingLeft: 18, fontSize: 12 }}>
                {t.objectives.map((o, i) => <li key={i}>{describeCond(o.cond)} ({o.pv} PV)</li>)}
              </ul>
              <button className="ghost" disabled={rc?.running} onClick={() => runRecalc(t)} style={{ fontSize: 11 }}>
                {rc?.running ? `⏳ ${rc.progress.done}/${rc.progress.total}` : '🔄 Ricalcola (150)'}
              </button>
              {rc && !rc.running && <TileCard r={rc.result} P={baseCfg.nPlayers ?? 4} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const TRATTATIVA_DEFAULT = {
  resetOwn:    { enabled: true, cost: 0 },
  attackOther: { enabled: true, cost: 0 },
  unblock:     { enabled: true, cost: 2 },
};
const TRATT_ACTIONS = [
  { key: 'resetOwn', label: 'Azzera la propria Tensione', extra: 'cost', extraLabel: 'Costo (ⓜ)' },
  { key: 'attackOther', label: 'Aumenta Tensione avversario (+1)', extra: 'cost', extraLabel: 'Costo (ⓜ)' },
  { key: 'unblock', label: 'Sblocca carta bloccata', extra: 'cost', extraLabel: 'Costo (ⓜ)' },
];

export function loadTrattativa() {
  try {
    const raw = localStorage.getItem('officina1907-trattativa-v2');
    if (raw) {
      const v = JSON.parse(raw);
      const out = {};
      for (const k of Object.keys(TRATTATIVA_DEFAULT)) out[k] = { ...TRATTATIVA_DEFAULT[k], ...(v[k] || {}) };
      return out;
    }
  } catch { /* default */ }
  return readDef('officina1907-trattativa-v2', TRATTATIVA_DEFAULT);
}

function TrattativaEditor({ tratt, setTratt }) {
  const upd = (key, field, value) => {
    const next = structuredClone(tratt);
    next[key][field] = field === 'enabled' ? value : Math.max(0, Math.min(20, Number(value) || 0));
    setTratt(next);
    try { localStorage.setItem('officina1907-trattativa-v2', JSON.stringify(next)); } catch { /* no-op */ }
  };
  return (
    <div className="track-editor">
      <p className="hint">Azioni della Trattativa al Sindacato. Azzera Tensione + attacco sono un blocco unico sempre attivo; Sblocca carta è opzionale e a pagamento. Nessun requisito di Impiegati. Salvato nel browser.</p>
      <table className="pv-editor">
        <thead><tr><th>Azione</th><th>Attiva</th><th>Costo</th></tr></thead>
        <tbody>
          {TRATT_ACTIONS.map(a => (
            <tr key={a.key}>
              <td style={{ textAlign: 'left' }}>{a.label}</td>
              <td><input type="checkbox" checked={tratt[a.key].enabled} onChange={e => upd(a.key, 'enabled', e.target.checked)} /></td>
              <td>{a.extra
                ? <><input type="number" min="0" max="20" value={tratt[a.key][a.extra]} disabled={!tratt[a.key].enabled} onChange={e => upd(a.key, a.extra, e.target.value)} style={{ width: 48 }} /> <small>{a.extraLabel}</small></>
                : <small>—</small>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="ghost" onClick={() => { const d = readDef('officina1907-trattativa-v2', TRATTATIVA_DEFAULT); setTratt(structuredClone(d)); try { localStorage.setItem('officina1907-trattativa-v2', JSON.stringify(d)); } catch { /* no-op */ } }}>
        Ripristina azioni di default
      </button>
      <button className="ghost" onClick={() => writeDef('officina1907-trattativa-v2', tratt)}>⭐ Rendi questi valori i default</button>
    </div>
  );
}

// --- Azioni Città: sell = risorsa→marchi, convert = risorsa→risorsa a scelta. 1 uso ciascuna per visita. ---
// modello di tracciato selezionato: 'classico' (16 caselle) o 'unito' (12, come la plancia stampata)
const TRACKMODEL_KEY = 'officina1907-trackmodel-v1';

const BORSA_DEFAULT = {
  sell:      { enabled: true, give: 1, get: 2 },
  convert:   { enabled: true, give: 1, get: 1 },
};
const BORSA_ACTIONS = [
  { key: 'sell', label: 'Vendi risorsa → marchi' },
  { key: 'convert', label: 'Scambia risorsa → risorsa a scelta' },
];
export function loadBorsa() {
  try {
    const raw = localStorage.getItem('officina1907-borsa-v2');
    if (raw) {
      const v = JSON.parse(raw);
      const out = {};
      for (const k of Object.keys(BORSA_DEFAULT)) out[k] = { ...BORSA_DEFAULT[k], ...(v[k] || {}) };
      return out;
    }
  } catch { /* default */ }
  return readDef('officina1907-borsa-v2', BORSA_DEFAULT);
}

// Alternativa alle Commesse alla Borsa: esci con un bonus fisso, e/o rinfresca un mercato a scelta —
// esclusiva con completare Commesse nella stessa visita (homebrew, non ancora nel regolamento).
const BORSA_EXIT_DEFAULT = { enabled: true, coins: 2 };
const BORSA_REFRESH_DEFAULT = { enabled: true };
export const loadBorsaExit = () => loadLS('officina1907-borsaexit-v1', BORSA_EXIT_DEFAULT);
export const loadBorsaRefresh = () => loadLS('officina1907-borsarefresh-v1', BORSA_REFRESH_DEFAULT);


// --- Editor mappa esagoni (pointy-top odd-r): clic per aggiungere/cambiare, adiacenza calcolata dalla griglia ---
const FM_COLS = 12, FM_ROWS = 7, FM_DIV = 6, FM_S = 20, FM_SQ3 = Math.sqrt(3);
const fmCenter = (c, r) => [30 + FM_SQ3 * FM_S * (c + 0.5 * (r & 1)), 26 + 1.5 * FM_S * r];
const fmPts = (cx, cy) => { let a = []; for (let i = 0; i < 6; i++) { const g = Math.PI / 180 * (60 * i - 30); a.push((cx + FM_S * Math.cos(g)).toFixed(1) + ',' + (cy + FM_S * Math.sin(g)).toFixed(1)); } return a.join(' '); };
const fmToCube = (c, r) => { const x = c - (r - (r & 1)) / 2; return [x, -x - r, r]; };
const fmFromCube = (x, z) => [x + (z - (z & 1)) / 2, z];
const FM_DIRS = [[1, -1, 0], [1, 0, -1], [0, 1, -1], [-1, 1, 0], [-1, 0, 1], [0, -1, 1]];
const fmNeighbors = (c, r) => { const cu = fmToCube(c, r); return FM_DIRS.map(d => fmFromCube(cu[0] + d[0], cu[2] + d[2]).join(',')); };
function mapToState(map) { // {hexes:[{id,col,row,type,isola}]} → { "c,r": {t,isl} }
  const st = {};
  for (const h of map.hexes) st[h.col + ',' + h.row] = { t: h.type === 'risorsa' ? 'r' : 'o', isl: h.isola };
  return st;
}
function stateToMap(st) { // → {hexes, adj} con id L#/R# row-major e adiacenza calcolata
  const L = [], R = [];
  for (const k of Object.keys(st)) { const [c, r] = k.split(',').map(Number); (st[k].isl === 'L' ? L : R).push({ k, c, r }); }
  const ord = (a, b) => a.r - b.r || a.c - b.c; L.sort(ord); R.sort(ord);
  const id = {}; L.forEach((h, i) => id[h.k] = 'L' + (i + 1)); R.forEach((h, i) => id[h.k] = 'R' + (i + 1));
  const hexes = [], adj = {};
  for (const k of Object.keys(st)) {
    const [c, r] = k.split(',').map(Number), s = st[k];
    hexes.push({ id: id[k], col: c, row: r, type: s.t === 'r' ? 'risorsa' : 'costruibile', isola: s.isl });
    adj[id[k]] = fmNeighbors(c, r).filter(nk => st[nk]).map(nk => id[nk]).sort();
  }
  hexes.sort((a, b) => a.id < b.id ? -1 : 1);
  return { hexes, adj };
}
function FactoryMapEditor({ map, onChange }) {
  const [st, setSt] = React.useState(() => mapToState(map || FACTORY_MAP));
  const commit = next => { setSt(next); onChange(stateToMap(next)); };
  const hit = k => {
    const next = { ...st };
    if (!next[k]) { const c = +k.split(',')[0]; next[k] = { t: 'o', isl: c < FM_DIV ? 'L' : 'R' }; } // isl solo per gli id L#/R#
    else if (next[k].t === 'o') next[k] = { ...next[k], t: 'r' };
    else delete next[k];
    commit(next);
  };
  let nRes = 0; for (const k in st) if (st[k].t === 'r') nRes++;
  const per = Math.min(3, Math.floor(nRes / SECTORS.length)); // stessa formula di setupFactoryResources (bilanciato)
  const extra = nRes - per * SECTORS.length;
  const cells = [];
  for (let r = 0; r < FM_ROWS; r++) for (let c = 0; c < FM_COLS; c++) {
    const k = c + ',' + r, s = st[k], [cx, cy] = fmCenter(c, r);
    let fill = 'rgba(255,255,255,0.03)', stroke = 'rgba(200,180,150,0.18)', sw = 1;
    if (s) { fill = s.t === 'r' ? '#3a281a' : '#c8823a'; stroke = '#fff'; sw = 2; }
    cells.push(<polygon key={k} points={fmPts(cx, cy)} fill={fill} stroke={stroke} strokeWidth={sw}
      strokeDasharray={s ? undefined : '2,2'} style={{ cursor: 'pointer' }} onClick={() => hit(k)} />);
  }
  const W = 30 + FM_SQ3 * FM_S * (FM_COLS + 0.5) + FM_S, H = 26 + 1.5 * FM_S * FM_ROWS + FM_S;
  return (
    <div>
      <p className="hint" style={{ margin: '6px 0' }}>clic: vuoto → costruibile → risorsa → vuoto</p>
      <div style={{ overflowX: 'auto' }}><svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: W }}>{cells}</svg></div>
      <p className="hint">{Object.keys(st).length} esagoni · {nRes} risorse. Adiacenza calcolata dalla griglia.</p>
      <p className="hint">
        Suddivisione colori (bilanciato, posizioni casuali a inizio partita): {SECTORS.map(s => `${per} ${s}`).join(' · ')}
        {extra > 0 ? ` · +${extra} extra a caso` : ''}
        {' '}(con "del tutto casuale" nessuna garanzia per colore).
      </p>
    </div>
  );
}

const BORSA_FABBRICHE_KEY = 'officina1907-borsafabbriche-v1';
function loadBorsaFabbriche() {
  return loadLS(BORSA_FABBRICHE_KEY, BORSA_FABBRICHE_DEFAULT, v => v && Array.isArray(v.costCurve));
}
function BorsaFabbricheEditor({ bf, setBf }) {
  const [mapN, setMapN] = React.useState(4); // quale mappa (2/3/4 giocatori) sto editando
  const upd = patch => { const next = { ...structuredClone(bf), ...patch }; setBf(next); saveLS(BORSA_FABBRICHE_KEY, next); };
  const updCost = (i, val) => { const c = [...bf.costCurve]; c[i] = Math.max(0, Math.min(99, Number(val) || 0)); upd({ costCurve: c }); };
  const num = (v, on) => <input type="number" value={v} onChange={e => on(e.target.value)} style={{ width: 46 }} />;
  return (
    <div className="track-editor">
      <p className="hint">
        Fabbriche sulla mappa esagonale. Costo a scalare. Mappa e adiacenze editabili sotto, una distinta per
        2/3/4 giocatori (adiacenza calcolata dalla griglia). Il <b>Modello fabbrica</b> qui sotto decide se la
        fondazione dipende dalle milestone (Legata) o no (Neutra).
      </p>
      <h4>Sistema fabbriche</h4>
      <label style={{ display: 'block', margin: '4px 0' }}>
        <button className={bf.enabled ? 'sel' : ''} onClick={() => upd({ enabled: true })}>Attiva</button>
        <button className={!bf.enabled ? 'sel' : ''} onClick={() => upd({ enabled: false })}>Disattiva</button>
        <span className="hint" style={{ marginLeft: 8 }}>disattiva TUTTO il sistema fabbriche (per togliere solo la dipendenza dalle milestone usa "Modello fabbrica → Neutra")</span>
      </label>
      <h4>Modello fabbrica (dipendenza dalle milestone)</h4>
      <label style={{ display: 'block', margin: '4px 0' }}>
        <button className={bf.neutralFactory !== false ? 'sel' : ''} onClick={() => upd({ neutralFactory: true })}>Neutra — NO milestone</button>
        <button className={bf.neutralFactory === false ? 'sel' : ''} onClick={() => upd({ neutralFactory: false })}>Legata — milestone richiesta</button>
        <span className="hint" style={{ marginLeft: 8 }}>{bf.neutralFactory !== false
          ? 'si fonda solo con marchi, nessun credito-milestone e nessun settore proprio; la forza verso un settore = quante tue fabbriche sono adiacenti alle risorse di quel colore'
          : 'ogni milestone di reparto dà un credito per fondare una fabbrica di quel settore, accanto a una risorsa dello stesso colore; forza = fabbriche di quel settore'}</span>
      </label>
      {bf.neutralFactory !== false && (
        <label style={{ display: 'block', margin: '4px 0' }}>
          <button className={bf.milestoneGate ? 'sel' : ''} onClick={() => upd({ milestoneGate: true })}>Cancello milestone ON</button>
          <button className={!bf.milestoneGate ? 'sel' : ''} onClick={() => upd({ milestoneGate: false })}>OFF</button>
          <span className="hint" style={{ marginLeft: 8 }}>{bf.milestoneGate
            ? 'fondi solo se hai crediti-milestone non spesi (1 per ogni milestone attraversata, qualsiasi reparto). Ritarda la 1ª fabbrica alla 1ª milestone. NB: nel probe non ha domato lo snowball'
            : 'nessun cancello: fondi appena hai i marchi (attuale)'}</span>
        </label>
      )}
      <h4>Risorsa immediata alla fondazione</h4>
      <label style={{ display: 'block', margin: '4px 0' }}>
        <button className={bf.foundingResource !== false ? 'sel' : ''} onClick={() => upd({ foundingResource: true })}>Attiva</button>
        <button className={bf.foundingResource === false ? 'sel' : ''} onClick={() => upd({ foundingResource: false })}>Disattiva</button>
        <span className="hint" style={{ marginLeft: 8 }}>{bf.foundingResource !== false
          ? (bf.neutralFactory !== false ? 'fondando incassi 1 risorsa per ogni colore adiacente distinto' : 'fondando incassi 1 risorsa del settore')
          : 'nessuna risorsa alla fondazione'}</span>
      </label>
      <h4>Costo a scalare (n-esima fabbrica)</h4>
      <table className="mini"><tbody><tr>
        {bf.costCurve.map((c, i) => <td key={i} style={{ textAlign: 'center' }}>{i + 1}ª<br />{num(c, v => updCost(i, v))} ⓜ</td>)}
      </tr></tbody></table>
      <p className="hint">L'ultima cifra vale anche oltre (7ª+ fabbrica). Abbassarle alza il "realizzo" (crediti → fabbriche, ~20% a d4).</p>
      <h4>Colori delle risorse (assegnati a caso a inizio partita)</h4>
      <label>Distribuzione:{' '}
        <select value={bf.setupBalance === 'random' ? 'random' : 'bilanciato'} onChange={e => upd({ setupBalance: e.target.value })}>
          <option value="bilanciato">≥3 di ogni colore, posizioni casuali (niente maggioranze)</option>
          <option value="random">del tutto casuale</option>
        </select>
      </label>
      <p className="hint">Bilanciato: con 9 risorse = 3 Tessili + 3 Metallurgici + 3 Chimici sparsi a caso. Mappe più piccole (es. 2p, 4 risorse): il massimo possibile per colore, poi il resto casuale.</p>
      <h4>Rendita per turno</h4>
      <label style={{ display: 'block', margin: '4px 0' }}>
        <button className={bf.passiveIncome !== false ? 'sel' : ''} onClick={() => upd({ passiveIncome: true })}>Attiva</button>
        <button className={bf.passiveIncome === false ? 'sel' : ''} onClick={() => upd({ passiveIncome: false })}>Disattiva</button>
        <span className="hint" style={{ marginLeft: 8 }}>{bf.passiveIncome === false ? 'solo la risorsa immediata alla fondazione, niente rendita' : '+1 risorsa/turno per fabbrica + quella immediata'}</span>
      </label>
      <h4>Fabbriche potenziano le attivazioni</h4>
      <label style={{ display: 'block', margin: '4px 0' }}>
        <button className={bf.factoryActivates ? 'sel' : ''} onClick={() => upd({ factoryActivates: true })}>Attiva</button>
        <button className={!bf.factoryActivates ? 'sel' : ''} onClick={() => upd({ factoryActivates: false })}>Disattiva</button>
        <span className="hint" style={{ marginLeft: 8 }}>{bf.factoryActivates ? 'attivando un reparto, le carte Sotto scattano N volte = forza verso quel settore' : 'le carte Sotto scattano una volta (normale)'}</span>
      </label>
      {bf.factoryActivates && (
        <label style={{ display: 'block', margin: '4px 0' }}>
          Tetto del moltiplicatore: {num(bf.factoryMultCap ?? 3, v => upd({ factoryMultCap: Math.max(0, Math.min(9, Number(v) || 0)) }))}
          <span className="hint" style={{ marginLeft: 8 }}>{(bf.factoryMultCap ?? 3) === 0 ? 'nessun tetto: le Sotto scattano quante volte la forza' : `le Sotto scattano al massimo ${bf.factoryMultCap ?? 3}× anche con forza superiore`} · 0 = illimitato</span>
        </label>
      )}
      <h4>Maggioranza territoriale</h4>
      <label style={{ display: 'block', margin: '4px 0' }}>
        <button className={bf.majorityBonus?.enabled ? 'sel' : ''} onClick={() => upd({ majorityBonus: { pv: 10, ...bf.majorityBonus, enabled: true } })}>Attiva</button>
        <button className={!bf.majorityBonus?.enabled ? 'sel' : ''} onClick={() => upd({ majorityBonus: { pv: 10, ...bf.majorityBonus, enabled: false } })}>Disattiva</button>
        {bf.majorityBonus?.enabled && <span className="hint" style={{ marginLeft: 8 }}>
          a fine partita, {num(bf.majorityBonus.pv ?? 10, v => upd({ majorityBonus: { ...bf.majorityBonus, pv: Math.max(0, Math.min(99, Number(v) || 0)) } }))} PV
          a chi ha più fabbriche del settore attorno a ciascun giacimento (pareggio → decide la milestone del reparto; pareggio anche lì → nessuno prende PV)
        </span>}
      </label>
      <h4>Mappa esagoni — una per numero di giocatori</h4>
      <label style={{ display: 'block', marginBottom: 6 }}>Modifica mappa per:{' '}
        {[2, 3, 4].map(n => <button key={n} className={mapN === n ? 'sel' : ''} onClick={() => setMapN(n)}>{n} giocatori{bf.maps?.[n] ? ' *' : ''}</button>)}
        {bf.maps?.[mapN] && <span className="hint" style={{ marginLeft: 8 }}>* personalizzata</span>}
      </label>
      <FactoryMapEditor key={mapN + (bf.maps?.[mapN] ? 'c' : 'd')} map={bf.maps?.[mapN] || DEFAULT_FACTORY_MAPS[mapN]}
        onChange={m => upd({ maps: { ...bf.maps, [mapN]: m } })} />
      {bf.maps?.[mapN] && <p className="hint"><button className="ghost" onClick={() => { const maps = { ...bf.maps }; delete maps[mapN]; upd({ maps }); }}>↺ Torna alla mappa di default ({mapN}p)</button></p>}
      <p className="hint" style={{ marginTop: 10 }}>
        <button className="ghost" onClick={() => { const d = readDef(BORSA_FABBRICHE_KEY, BORSA_FABBRICHE_DEFAULT); setBf(structuredClone(d)); saveLS(BORSA_FABBRICHE_KEY, d); }}>↺ Ripristina default</button>{' '}
        <button className="ghost" onClick={() => writeDef(BORSA_FABBRICHE_KEY, bf)}>⭐ Rendi questi valori i default</button>
      </p>
    </div>
  );
}

function BorsaEditor({ borsa, setBorsa, borsaExit, setBorsaExit, borsaRefresh, setBorsaRefresh }) {
  const upd = (key, field, value) => {
    const next = structuredClone(borsa);
    next[key][field] = field === 'enabled' ? value : Math.max(0, Math.min(20, Number(value) || 0));
    setBorsa(next);
    try { localStorage.setItem('officina1907-borsa-v2', JSON.stringify(next)); } catch { /* no-op */ }
  };
  const updExit = (field, value) => {
    const next = { ...borsaExit, [field]: field === 'enabled' ? value : Math.max(0, Math.min(20, Number(value) || 0)) };
    setBorsaExit(next);
    saveLS('officina1907-borsaexit-v1', next);
  };
  const updRefresh = enabled => { const next = { ...borsaRefresh, enabled }; setBorsaRefresh(next); saveLS('officina1907-borsarefresh-v1', next); };
  return (
    <div className="track-editor">
      <p className="hint">Azioni disponibili entrando in Città, una sola volta ciascuna per visita. "give" = quante risorse cedi, "get" = quante ne ricevi (marchi per vendi, risorsa a scelta per scambia). Salvato nel browser.</p>
      <table className="pv-editor">
        <thead><tr><th>Azione</th><th>Attiva</th><th>give</th><th>get</th></tr></thead>
        <tbody>
          {BORSA_ACTIONS.map(a => (
            <tr key={a.key}>
              <td style={{ textAlign: 'left' }}>{a.label}</td>
              <td><input type="checkbox" checked={borsa[a.key].enabled} onChange={e => upd(a.key, 'enabled', e.target.checked)} /></td>
              <td><input type="number" min="0" max="20" value={borsa[a.key].give} disabled={!borsa[a.key].enabled} onChange={e => upd(a.key, 'give', e.target.value)} style={{ width: 48 }} /></td>
              <td><input type="number" min="0" max="20" value={borsa[a.key].get} disabled={!borsa[a.key].enabled} onChange={e => upd(a.key, 'get', e.target.value)} style={{ width: 48 }} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="ghost" onClick={() => { const d = readDef('officina1907-borsa-v2', BORSA_DEFAULT); setBorsa(structuredClone(d)); try { localStorage.setItem('officina1907-borsa-v2', JSON.stringify(d)); } catch { /* no-op */ } }}>
        Ripristina azioni di default
      </button>
      <button className="ghost" onClick={() => writeDef('officina1907-borsa-v2', borsa)}>⭐ Rendi questi valori i default</button>

      <h4 style={{ marginTop: 20 }}>Esci senza Commesse (homebrew)</h4>
      <p className="hint">Alternativa: invece di completare Commesse in questa visita, il giocatore esce con un bonus fisso e/o rinfresca un mercato a scelta (Welfare o banchi operai). Una volta usata una di queste, non può più completare Commesse nella stessa visita — e viceversa. Non è nel regolamento ufficiale.</p>
      <table className="pv-editor">
        <tbody>
          <tr>
            <td style={{ textAlign: 'left' }}>Esci con bonus fisso</td>
            <td><input type="checkbox" checked={borsaExit.enabled} onChange={e => updExit('enabled', e.target.checked)} /></td>
            <td>marchi: <input type="number" min="0" max="20" value={borsaExit.coins} disabled={!borsaExit.enabled} onChange={e => updExit('coins', e.target.value)} style={{ width: 48 }} /></td>
          </tr>
          <tr>
            <td style={{ textAlign: 'left' }}>Refresh gratuito (Welfare o banchi, a scelta)</td>
            <td><input type="checkbox" checked={borsaRefresh.enabled} onChange={e => updRefresh(e.target.checked)} /></td>
            <td></td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function ExportConfig({ cfg }) {
  const json = JSON.stringify(cfg);
  const [copied, setCopied] = useState(false);
  const copy = () => { try { navigator.clipboard.writeText(json); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* fallback: selezione manuale */ } };
  return (
    <div className="track-editor">
      <p className="hint">Configurazione completa in JSON (tutti gli editor: tracce, commesse, worker, welfare, clock, bersagli…). Copiala per condividerla o per girarla nei batch.</p>
      <textarea readOnly value={json} onFocus={e => e.target.select()} style={{ width: '100%', height: 150, fontFamily: 'monospace', fontSize: 11 }} />
      <button className="ghost" onClick={copy}>{copied ? '✓ Copiato' : '📋 Copia negli appunti'}</button>
    </div>
  );
}

// chiave localStorage per ciascun editor — usata per capire cosa importare e per salvare ciò che si importa
// (altrimenti l'import aggiorna solo lo stato React di questa sessione e sparisce al primo reload).
const IMPORT_FIELDS = [
  ['contractPV', 'officina1907-contractpv-v1'],
  ['conversions', 'officina1907-conv-v1'],
  ['strikePenaltyPV', 'officina1907-strikepv-v1'],
  ['startingCoins', 'officina1907-startcoins-v1'],
  ['trattativa', 'officina1907-trattativa-v2'],
  ['borsa', 'officina1907-borsa-v2'],
  ['borsaFabbriche', BORSA_FABBRICHE_KEY],
  ['borsaExit', 'officina1907-borsaexit-v1'],
  ['borsaRefresh', 'officina1907-borsarefresh-v1'],
  ['slots', 'officina1907-slots-v1'],
  ['startTension', 'officina1907-tension-v1'],
  ['contractCount', 'officina1907-contractcount-v4'],
  ['contractMarket', 'officina1907-market-v2'],
  ['contractMilestoneReq', 'officina1907-contractmsreq-v2'],
  ['welfareEnabled', 'officina1907-welfareenabled-v1'],
  ['tiles', 'officina1907-tiles-v2'],
  ['trackTiles', 'officina1907-tracktiles-v2'],
  ['trackTileCap', 'officina1907-tracktilecap-v1'],
  ['clockThreshold', 'officina1907-clocks-v1'],
  ['indicatorTargets', 'officina1907-targets-v1'],
  ['newWorkers', NEWWORKERS_KEY], // stessa chiave dell'editor (bumpata a ogni cambio di formato): duplicarla qui la fa divergere in silenzio
  ['tileMode', 'officina1907-tilemode-v1'],
  ['families', 'officina1907-families-v2'],
];
// Scrive un JSON di configurazione esportata nelle chiavi localStorage (senza toccare lo stato React).
// Usata sia dall'import manuale sia dal bootstrap baseline (main.jsx). Ritorna i campi scritti.
export function writeConfigToLS(json) {
  const applied = [];
  for (const [key, lsKey] of IMPORT_FIELDS) {
    if (json[key] === undefined) continue;
    saveLS(lsKey, json[key]);
    applied.push(key);
  }
  // json.tracks è lo shape per initGame ({terziario,secondario,primario}, sempre stesso array ora):
  // l'editor ne salva solo uno, sono identici.
  if (Array.isArray(json.tracks?.terziario) && json.tracks.terziario.length === 17) {
    saveEditorTrack(json.tracks.terziario, json.tracks.terziario.length === 13 ? 'unito' : 'classico');
    applied.push('tracks');
  }
  return applied;
}

function ImportConfig({ setters }) {
  const [raw, setRaw] = useState('');
  const [msg, setMsg] = useState(null);
  const apply = () => {
    let json;
    try { json = JSON.parse(raw); } catch { setMsg({ ok: false, text: 'JSON non valido — controlla di aver incollato tutto il testo esportato.' }); return; }
    const applied = writeConfigToLS(json);
    for (const [key] of IMPORT_FIELDS) if (json[key] !== undefined) setters[key](json[key]);
    if (applied.includes('tracks')) setters.tracks(json.tracks.terziario);
    setMsg(applied.length
      ? { ok: true, text: `Importati ${applied.length} campi: ${applied.join(', ')}.` }
      : { ok: false, text: 'Nessun campo riconosciuto in questo JSON — è davvero una configurazione esportata da qui?' });
  };
  return (
    <div className="track-editor">
      <p className="hint">Incolla qui il JSON di "📋 Esporta configurazione" (di questa sessione o di una precedente) per ripristinare tutti gli editor in un colpo solo. Sovrascrive i valori correnti e li salva nel browser.</p>
      <textarea value={raw} onChange={e => setRaw(e.target.value)} placeholder="{...}" style={{ width: '100%', height: 150, fontFamily: 'monospace', fontSize: 11 }} />
      <button className="primary" onClick={apply}>⬆ Importa</button>
      {msg && <p className={msg.ok ? 'hint' : 'hint'} style={{ color: msg.ok ? '#7cb87c' : '#d98080' }}>{msg.text}</p>}
    </div>
  );
}

export default function SetupScreen({ onStart }) {
  const [n, setN] = useState(4);
  const [players, setPlayers] = useState([
    { name: 'Primo', isAI: true, boardId: 'p2', personality: 'neutro' },
    { name: 'Secondo', isAI: true, boardId: 'p3', personality: 'neutro' },
    { name: 'Terzo', isAI: true, boardId: 'p4', personality: 'neutro' },
    { name: 'Quarto', isAI: true, boardId: 'p6', personality: 'neutro' },
  ]);
  const [seed, setSeed] = useState('');
  const [trattativa, setTrattativa] = useState(loadTrattativa);
  const [borsa, setBorsa] = useState(loadBorsa);
  const [borsaExit, setBorsaExit] = useState(loadBorsaExit);
  const [borsaRefresh, setBorsaRefresh] = useState(loadBorsaRefresh);
  const [borsaFabbriche, setBorsaFabbriche] = useState(loadBorsaFabbriche);
  const [strikePV, setStrikePV] = useState(loadStrikePV);
  const [trackModel, setTrackModelRaw] = useState(() => loadLS(TRACKMODEL_KEY, TRACK_MODEL_DEFAULT, v => !!TRACK_MODELS[v]));
  const [track, setTrack] = useState(() => loadEditorTrack(loadLS(TRACKMODEL_KEY, TRACK_MODEL_DEFAULT, v => !!TRACK_MODELS[v])));
  // cambiare modello ricarica il tracciato salvato di QUEL modello (i due non si sovrascrivono)
  const setTrackModel = m => { setTrackModelRaw(m); saveLS(TRACKMODEL_KEY, m); setTrack(loadEditorTrack(m)); };
  const [trackTiles, setTrackTiles] = useState(loadTrackTiles);
  const [trackTileCap, setTrackTileCap] = useState(loadTrackTileCap);
  const [contractPV, setContractPV] = useState(loadContractPV);
  const [conversions, setConversions] = useState(loadConversions);
  const [startCoins, setStartCoins] = useState(loadStartCoins);
  const [slots, setSlots] = useState(loadSlots);
  const [tension, setTension] = useState(loadTension);
  const [count, setCount] = useState(loadCount);
  const [market, setMarket] = useState(loadMarket);
  const [milestoneReq, setMilestoneReq] = useState(loadMilestoneReq);
  const [tiles, setTiles] = useState(loadTiles);
  const [families, setFamilies] = useState(loadFamilies);
  const [tileMode, setTileMode] = useState(() => loadLS('officina1907-tilemode-v1', 'families'));
  const [clocks, setClocks] = useState(loadClocks);
  const [targets, setTargets] = useState(loadTargets);
  const [welfareEnabled, setWelfareEnabled] = useState(loadWelfareEnabled);
  const [newWorkers, setNewWorkers] = useState(loadNewWorkers);
  const [open, setOpen] = useState(''); // quale editor è aperto (accordion)

  const upd = (i, patch) => setPlayers(ps => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const chosen = players.slice(0, n).map(p => p.boardId).filter(Boolean);
  const setTileModeAndSave = m => { setTileMode(m); saveLS('officina1907-tilemode-v1', m); };

  const cfg = () => ({
    coinsRepeat: true, endOnTrigger: false, singlePlace: true, strikePenalty: true,
    trackModel,
    tracks: toGameTracks(track),
    contractPV, conversions, startingCoins: startCoins, trattativa, borsa, borsaExit, borsaRefresh,
    // maps sempre esplicite (custom o default) nell'export: altrimenti un export "non toccato" dipende
    // silenziosamente da DEFAULT_FACTORY_MAPS lato codice, e un futuro cambio lì rende l'export non riproducibile.
    borsaFabbriche: { ...borsaFabbriche, maps: { 2: borsaFabbriche.maps?.[2] || DEFAULT_FACTORY_MAPS[2], 3: borsaFabbriche.maps?.[3] || DEFAULT_FACTORY_MAPS[3], 4: borsaFabbriche.maps?.[4] || DEFAULT_FACTORY_MAPS[4] } },
    strikePenaltyPV: strikePV,
    slots, startTension: tension, contractCount: count, contractMarket: market,
    contractMilestoneReq: milestoneReq,
    // toggle in "Editor nuovo mazzo": mazzo unificato 84 carte (lavoratori+impiegati), 6 nazioni (+Greci),
    // 5 mazzetti fisici (nodeBanks) al posto delle coppie di nazioni adiacenti. Niente più azione separata
    // a Servizi per gli Impiegati — sempre Welfare/Macchinari classico lì (servicesMode di default).
    workers: newWorkers,
    nations: NATIONS_NUOVO,
    nodeBanks: NEW_NODE_BANKS,
    tiles: tileMode === 'families' ? buildFamilyTiles(families) : tiles,
    // Welfare/Macchinari rimossi dal design (Officina 2.0, poi esteso al mazzo Classico): Direzione contiene
    // solo Impiegati (sempre Sopra, cap in `slots.direzione.sopra`, default 3) + tile R&D. Sempre off, non
    // più un toggle per-partita. Mercato tile (trackTiles/trackTileCap) ora si compra alla Borsa (Ricerca
    // e Sviluppo, esclusivo con le Commesse nella stessa visita), non più al nodo Servizi.
    welfareEnabled: false,
    // campi grezzi (oltre a quelli già risolti sopra) solo per far tornare l'export/import completo:
    // newWorkers/tileMode/families sono lo stato "editor", workers/tiles sopra sono già il valore risolto per il motore.
    // deckMode non esportato: sempre 'nuovo' ora (editor mazzo vecchio ritirato). welfare/workersRaw (Welfare/Macchinari
    // e lavoratori classici) non esportati: editor rimossi, dati morti.
    newWorkers, tileMode, families,
    trackTiles, trackTileCap,
    clockThreshold: clocks, indicatorTargets: targets,
  });
  const start = () => {
    onStart({
      ...cfg(),
      seed: seed.trim() === '' ? undefined : (Number(seed) || 0),
      players: players.slice(0, n).map(p => ({ name: p.name.trim() || undefined, isAI: p.isAI, boardId: p.boardId || undefined, personality: p.isAI ? p.personality : undefined })),
    });
  };

  return (
    <div className={`setup${open ? ' wide' : ''}`}>
      <h1>OFFICINA 1907</h1>
      <p className="tagline">Tu possiedi la fabbrica. Loro ci lavorano dentro.</p>
      <div className="setup-box">
        <label>Numero di giocatori:{' '}
          {[2, 3, 4].map(k => (
            <button key={k} className={k === n ? 'sel' : ''} onClick={() => setN(k)}>{k}</button>
          ))}
        </label>
        <table>
          <thead><tr><th></th><th>Nome</th><th>Tipo</th><th>Personalità</th><th>Plancia Fabbrica</th></tr></thead>
          <tbody>
            {players.slice(0, n).map((p, i) => (
              <tr key={i}>
                <td>{i + 1}°</td>
                <td><input value={p.name} onChange={e => upd(i, { name: e.target.value })} /></td>
                <td>
                  <button className={!p.isAI ? 'sel' : ''} onClick={() => upd(i, { isAI: false })}>Umano</button>
                  <button className={p.isAI ? 'sel' : ''} onClick={() => upd(i, { isAI: true })}>AI</button>
                </td>
                <td>
                  {p.isAI ? (
                    <select value={p.personality || 'neutro'} onChange={e => upd(i, { personality: e.target.value })}>
                      <option value="neutro">Neutro (baseline)</option>
                      <option value="padrone">Il Padrone (aggressivo/commesse)</option>
                      <option value="ingegnere">L'Ingegnere (tableau/pacifico)</option>
                      <option value="speculatore">Lo Speculatore (economia)</option>
                    </select>
                  ) : <small>—</small>}
                </td>
                <td>
                  <select value={p.boardId} onChange={e => upd(i, { boardId: e.target.value })}>
                    <option value="">Casuale</option>
                    {BOARDS.map(b => (
                      <option key={b.id} value={b.id} disabled={chosen.includes(b.id) && p.boardId !== b.id}>
                        {b.name} ({b.terziario} / {b.secondario} / {b.primario})
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <label className="seed">Seed (opzionale): <input value={seed} onChange={e => setSeed(e.target.value)} placeholder="casuale" /></label>
        <label style={{ display: 'block', margin: '8px 0' }}>
          Piano Industriale:{' '}
          <button className={tileMode === 'classic' ? 'sel' : ''} onClick={() => setTileModeAndSave('classic')}>Tessere fisse ({tiles.length})</button>
          <button className={tileMode === 'families' ? 'sel' : ''} onClick={() => setTileModeAndSave('families')}>Nuovo (6 nazionalità × 5 industria, 30 combinazioni)</button>
        </label>
        <p className="hint">Welfare/Macchinari rimossi dal design: Direzione contiene solo Impiegati (sempre Sopra) + tile R&D.</p>
        <div style={{ margin: '10px 0', display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {[
            ['plancia', '🏭 Editor plancia giocatore'],
            ['commesse', '🏆 Editor commesse'],
            ['tratt', '✊ Editor azioni Trattativa'],
            ['borsa', '🏙 Editor azioni città'],
            ['borsafabbriche', '🏭 Editor Borsa a fabbriche'],
            ['conv', '⚖ Editor conversioni e penalità'],
            ['monete', '🪙 Editor monete iniziali'],
            ['newdeck', '🃏 Editor nuovo mazzo'],
            ['impiegati', '👔 Editor carte Impiegato'],
            ['tiles', '📜 Editor Piano Industriale (tessere fisse)'],
            ['families', '🧬 Editor Famiglie (nuovo)'],
            ['tracktiles', '🧩 Editor tile tracciato'],
            ['target', '🎯 Editor bersagli indicatori'],
            ['clock', '⏱ Editor clock (durata partita)'],
            ['export', '📋 Esporta configurazione'],
            ['import', '⬆ Importa configurazione'],
            ['sim', '🤖 Simulazione automatica'],
          ].map(([key, label]) => (
            <button key={key} onClick={() => setOpen(open === key ? '' : key)}>{label} {open === key ? '▾' : '▸'}</button>
          ))}
        </div>
        {open === 'plancia' && <PlanciaEditor slots={slots} setSlots={setSlots} tension={tension} setTension={setTension} track={track} setTrack={setTrack} trackModel={trackModel} setTrackModel={setTrackModel} />}
        {open === 'commesse' && <CommesseEditor count={count} setCount={setCount} market={market} setMarket={setMarket} pv={contractPV} setPV={setContractPV} milestoneReq={milestoneReq} setMilestoneReq={setMilestoneReq} />}
        {open === 'tratt' && <TrattativaEditor tratt={trattativa} setTratt={setTrattativa} />}
        {open === 'borsa' && <BorsaEditor borsa={borsa} setBorsa={setBorsa} borsaExit={borsaExit} setBorsaExit={setBorsaExit} borsaRefresh={borsaRefresh} setBorsaRefresh={setBorsaRefresh} />}
        {open === 'borsafabbriche' && <BorsaFabbricheEditor bf={borsaFabbriche} setBf={setBorsaFabbriche} />}
        {open === 'conv' && <ConversionsEditor conv={conversions} setConv={setConversions} strikePV={strikePV} setStrikePV={setStrikePV} />}
        {open === 'monete' && <StartCoinsEditor coins={startCoins} setCoins={setStartCoins} n={n} />}
        {open === 'newdeck' && <NewDeckEditor newWorkers={newWorkers} setNewWorkers={setNewWorkers} />}
        {open === 'impiegati' && <ImpiegatiDeckEditor newWorkers={newWorkers} setNewWorkers={setNewWorkers} />}
        {open === 'tiles' && <TilesEditor tiles={tiles} setTiles={setTiles} baseCfg={{ ...cfg(), nPlayers: 4 }} />}
        {open === 'families' && <FamilyEditor families={families} setFamilies={setFamilies} baseCfg={{ ...cfg(), nPlayers: 4 }} />}
        {open === 'tracktiles' && <TrackTileEditor tiles={trackTiles} setTiles={setTrackTiles} cap={trackTileCap} setCap={setTrackTileCap} />}
        {open === 'target' && <TargetEditor targets={targets} setTargets={setTargets} />}
        {open === 'clock' && <ClockEditor clocks={clocks} setClocks={setClocks} />}
        {open === 'export' && <ExportConfig cfg={cfg()} />}
        {open === 'import' && <ImportConfig setters={{
          contractPV: setContractPV, conversions: setConversions, strikePenaltyPV: setStrikePV,
          startingCoins: setStartCoins, trattativa: setTrattativa, borsa: setBorsa, borsaExit: setBorsaExit, borsaRefresh: setBorsaRefresh, borsaFabbriche: setBorsaFabbriche, slots: setSlots,
          startTension: setTension, contractCount: setCount, contractMarket: setMarket,
          contractMilestoneReq: setMilestoneReq, welfareEnabled: setWelfareEnabled, tiles: setTiles,
          trackTiles: setTrackTiles, trackTileCap: setTrackTileCap,
          clockThreshold: setClocks, indicatorTargets: setTargets, tracks: setTrack,
          newWorkers: setNewWorkers, tileMode: setTileMode, families: setFamilies,
        }} />}
        {open === 'sim' && <SimulationPanel {...cfg()} />}
        <button className="primary" onClick={start}>Inizia la partita</button>
      </div>
      <p className="note">Fine partita: Clock {clocks[2]} / {clocks[3]} / {clocks[4]} per 2 / 3 / 4 giocatori.</p>
    </div>
  );
}
