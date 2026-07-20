import React from 'react';
import { SECTORS, NEW_WORKERS_MERGED, NATIONS_NUOVO, IMPIEGATI_BANK, IMPIEGATI_MARKET } from '../game/data.js';

// ---------- persistenza (stesso pattern localStorage+"-def" di SetupScreen/TrackEditor) ----------
const DECKMODE_KEY = 'officina1907-deckmode-v1';
// esportata: SetupScreen la riusa in IMPORT_FIELDS — una seconda copia della stringa diverge al primo bump.
export const NEWWORKERS_KEY = 'officina1907-newworkers-v3'; // v3: Impiegati in un mazzo a parte (mercato Servizi), non più sparsi nei mazzetti A-E

function readJSON(key, fallback) {
  try { const r = localStorage.getItem(key); if (r) return JSON.parse(r); } catch { /* no-op */ }
  return structuredClone(fallback);
}
function writeJSON(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* no-op */ } }

// mazzo vecchio ritirato dall'UI: sempre 'nuovo', a prescindere da eventuale valore salvato in sessioni precedenti.
export function loadDeckMode() { return 'nuovo'; }

// carta valida: o normale (sector+effect.verbo) o impiegato (power, 2 settori) — entrambe hanno v+deck.
const validNewWorkers = v => Array.isArray(v) && v.length > 0 && v.every(c => c && c.id && c.deck && typeof c.v === 'number' && (c.power || c.effect?.verbo));
export function loadNewWorkers() {
  const v = readJSON(NEWWORKERS_KEY, null);
  return validNewWorkers(v) ? v : structuredClone(NEW_WORKERS_MERGED);
}
export function saveNewWorkers(v) { writeJSON(NEWWORKERS_KEY, v); }

// ---------- editor lavoratori nuovo mazzo (stessa logica formula {verbo,f1,f2} del vecchio editor) ----------
const VERBI = ['prendi', 'scambia', 'perOgni'];
const CONTA = ['icona', 'tensione', 'fabbrica'];
const WSETT_OPT = [...SECTORS, 'scelta'];
const DECK_GROUPS = ['A', 'B', 'C', 'D', 'E']; // solo i mazzetti lavoratori: gli Impiegati stanno nel loro mazzo, non spostabili

function Fattore({ f, onCh, wn }) {
  const set = patch => onCh({ ...f, ...patch });
  return (
    <span style={{ whiteSpace: 'nowrap' }}>
      <input type="number" min="0" max="20" value={f.q ?? 0} onChange={e => set({ q: wn(e.target.value, 20) })} style={{ width: 38 }} />
      <select value={f.tipo} onChange={e => set({ tipo: e.target.value })}><option value="risorsa">ris.</option><option value="moneta">mon.</option></select>
      {f.tipo === 'risorsa' && <select value={f.settore || 'scelta'} onChange={e => set({ settore: e.target.value })}>{WSETT_OPT.map(s => <option key={s} value={s}>{s}</option>)}</select>}
    </span>
  );
}

const SORT_KEYS = {
  mazzetto: c => c.deck,
  nazione: c => c.nation,
  settore: c => c.sector || '',
};
// patch su una carta per indice nell'array COMPLETO (lavoratori+impiegati): i due editor lavorano su viste
// filtrate dello stesso `newWorkers`, che è il valore che il motore riceve come `config.workers`.
const updater = (workers, setWorkers) => (i, patch) => {
  const next = workers.map((c, j) => (j === i ? { ...c, ...patch } : c));
  setWorkers(next);
  saveNewWorkers(next);
};

function NewWorkersEditor({ workers, setWorkers }) {
  const wn = (v, max) => Math.max(0, Math.min(max, Number(v) || 0));
  const [sortBy, setSortBy] = React.useState('mazzetto');
  const upd = updater(workers, setWorkers);
  const updEff = (i, patch) => upd(i, { effect: { ...workers[i].effect, ...patch } });
  const setVerbo = (i, verbo) => {
    const e = workers[i].effect;
    let f1 = e.f1 ? { ...e.f1 } : { q: 1, tipo: 'risorsa', settore: 'Tessile' };
    if (!f1.q) f1 = { ...f1, q: 1 };
    if ((verbo === 'prendi' || verbo === 'perOgni') && f1.tipo === 'risorsa' && (!f1.settore || f1.settore === 'scelta')) f1 = { ...f1, settore: 'Tessile' };
    const eff = { verbo, f1 };
    if (verbo === 'scambia') eff.f2 = e.f2?.tipo ? e.f2 : { q: 1, tipo: 'risorsa', settore: 'scelta' };
    if (verbo === 'perOgni') eff.f2 = e.f2?.conta ? e.f2 : { conta: 'icona', kind: 'sector', di: 'Tessile' };
    upd(i, { effect: eff });
  };
  // solo i lavoratori: gli Impiegati (c.power) hanno il loro editor, ma vivono nello stesso array
  const rows = workers.map((c, i) => ({ c, i })).filter(({ c }) => !c.power)
    .sort((a, b) => SORT_KEYS[sortBy](a.c).localeCompare(SORT_KEYS[sortBy](b.c)));
  return (
    <div>
      <p>Ordina per:{' '}
        {Object.keys(SORT_KEYS).map(k => (
          <button key={k} className={sortBy === k ? 'sel' : ''} onClick={() => setSortBy(k)}>{k}</button>
        ))}
      </p>
      <div style={{ maxHeight: 420, overflowY: 'auto' }}>
      <table className="pv-editor">
        <thead><tr><th>Mazzetto</th><th>Naz.</th><th>Settore</th><th>V</th><th>verbo</th><th>fattore 1</th><th>fattore 2 / contatore</th></tr></thead>
        <tbody>
          {rows.map(({ c, i }) => {
            const e = c.effect;
            return (
              <tr key={c.id}>
                <td><select value={c.deck} onChange={ev => upd(i, { deck: ev.target.value })}>{DECK_GROUPS.map(g => <option key={g} value={g}>{g}</option>)}</select></td>
                <td><select value={c.nation} onChange={ev => upd(i, { nation: ev.target.value })}>{NATIONS_NUOVO.map(n => <option key={n} value={n}>{n}</option>)}</select></td>
                <td><select value={c.sector} onChange={ev => upd(i, { sector: ev.target.value })}>{SECTORS.map(s => <option key={s} value={s}>{s}</option>)}</select></td>
                <td><input type="number" min="0" max="20" value={c.v} onChange={ev => upd(i, { v: wn(ev.target.value, 20) })} style={{ width: 40 }} /></td>
                <td><select value={e.verbo} onChange={ev => setVerbo(i, ev.target.value)}>{VERBI.map(v => <option key={v} value={v}>{v}</option>)}</select></td>
                <td><Fattore f={e.f1} onCh={f => updEff(i, { f1: f })} wn={wn} /></td>
                <td>
                  {e.verbo === 'scambia' && <Fattore f={e.f2} onCh={f => updEff(i, { f2: f })} wn={wn} />}
                  {e.verbo === 'perOgni' && (
                    <span>
                      <select value={e.f2?.conta || 'icona'} onChange={ev => updEff(i, { f2: { ...e.f2, conta: ev.target.value } })}>{CONTA.map(x => <option key={x} value={x}>{x}</option>)}</select>
                      {e.f2?.conta === 'icona' && <select value={e.f2?.di || 'Tessile'} onChange={ev => updEff(i, { f2: { ...e.f2, kind: 'sector', di: ev.target.value } })}>{SECTORS.map(s => <option key={s} value={s}>{s}</option>)}</select>}
                    </span>
                  )}
                  {e.verbo === 'prendi' && <small>—</small>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </div>
  );
}

// ---------- editor Impiegati (mazzo dedicato, mercato al nodo Servizi) ----------
// Stesso array `newWorkers` dell'editor lavoratori, vista filtrata su c.power: è il valore che il motore
// riceve come config.workers, e il mazzo Impiegati nasce da lì (campo `deck`).
function ImpiegatiEditor({ workers, setWorkers }) {
  const wn = (v, max) => Math.max(0, Math.min(max, Number(v) || 0));
  const upd = updater(workers, setWorkers);
  const rows = workers.map((c, i) => ({ c, i })).filter(({ c }) => c.power);
  // rinomina la chiave del settore mantenendo l'ordine (reparto 1 = quello forte, per convenzione)
  const setSector = (i, c, slot, sector) => {
    const keys = Object.keys(c.power);
    if (keys.includes(sector)) return; // stesso settore due volte: la potenza si fonderebbe in una chiave sola
    const next = {};
    keys.forEach((k, idx) => { next[idx === slot ? sector : k] = c.power[k]; });
    upd(i, { power: next });
  };
  return (
    <div>
      <div style={{ maxHeight: 420, overflowY: 'auto' }}>
        <table className="pv-editor">
          <thead><tr><th>Naz.</th><th>Costo (ⓜ)</th><th>Reparto 1</th><th>Reparto 2</th></tr></thead>
          <tbody>
            {rows.map(({ c, i }) => {
              const [s1, s2] = Object.keys(c.power);
              return (
                <tr key={c.id}>
                  <td><select value={c.nation} onChange={ev => upd(i, { nation: ev.target.value })}>{NATIONS_NUOVO.map(n => <option key={n} value={n}>{n}</option>)}</select></td>
                  <td><input type="number" min="0" max="20" value={c.v} onChange={ev => upd(i, { v: wn(ev.target.value, 20) })} style={{ width: 44 }} /></td>
                  <td>
                    <select value={s1} onChange={ev => setSector(i, c, 0, ev.target.value)}>{SECTORS.map(s => <option key={s} value={s}>{s}</option>)}</select>
                    {' +'}<input type="number" min="0" max="9" value={c.power[s1] ?? 0} onChange={ev => upd(i, { power: { ...c.power, [s1]: wn(ev.target.value, 9) } })} style={{ width: 40 }} />
                  </td>
                  <td>
                    <select value={s2} onChange={ev => setSector(i, c, 1, ev.target.value)}>{SECTORS.map(s => <option key={s} value={s}>{s}</option>)}</select>
                    {' +'}<input type="number" min="0" max="9" value={c.power[s2] ?? 0} onChange={ev => upd(i, { power: { ...c.power, [s2]: wn(ev.target.value, 9) } })} style={{ width: 40 }} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------- pannelli principali ----------
const resetAll = setNewWorkers => () => { setNewWorkers(structuredClone(NEW_WORKERS_MERGED)); saveNewWorkers(NEW_WORKERS_MERGED); };

export default function NewDeckEditor({ newWorkers, setNewWorkers }) {
  const n = newWorkers.filter(c => !c.power).length;
  return (
    <div className="track-editor">
      <p className="hint">{n} lavoratori in 5 mazzetti fisici (A-E, uno per nodo perimetrale), bilanciati per
        V/tipo di bonus alla creazione — la colonna "Mazzetto" è editabile se vuoi ribilanciare a mano. La
        nazionalità resta solo un'etichetta (obiettivi/flag), non determina più il mazzetto. Gli Impiegati non
        sono qui: hanno un mazzo a parte, vedi "👔 Editor carte Impiegato".</p>
      <NewWorkersEditor workers={newWorkers} setWorkers={setNewWorkers} />
      <button className="ghost" onClick={resetAll(setNewWorkers)}>Ripristina default (lavoratori + impiegati)</button>
    </div>
  );
}

export function ImpiegatiDeckEditor({ newWorkers, setNewWorkers }) {
  const n = newWorkers.filter(c => c.power).length;
  return (
    <div className="track-editor">
      <p className="hint">{n} Impiegati in un mazzo a parte (mazzetto "{IMPIEGATI_BANK}", non spostabili in A-E):
        mescolato a inizio partita, forma un mercato di {IMPIEGATI_MARKET} carte scoperte al nodo Servizi che si
        rifornisce dal mazzo a ogni acquisto. Un Impiegato si assume come un lavoratore ma va <b>solo in Direzione
        Sopra</b> (cap in "Editor plancia giocatore") e non ha bonus Sotto: invece di avanzare un reparto del proprio
        V, avanza i <b>due</b> reparti indicati della potenza scelta qui. Il costo è in marchi.</p>
      <ImpiegatiEditor workers={newWorkers} setWorkers={setNewWorkers} />
      <button className="ghost" onClick={resetAll(setNewWorkers)}>Ripristina default (lavoratori + impiegati)</button>
    </div>
  );
}
