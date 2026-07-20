import React from 'react';
import { SECTOR_COLORS, CLOCK_REFRESH } from '../game/data.js';

const SIZE_LABEL = { small: 'Piccola (3)', medium: 'Media (5)', large: 'Grande (7)' };
const RES_DOT = { Tessile: '🧵', Metallurgica: '⚒', Chimica: '⚗' };

export default function ContractsPanel({ state }) {
  return (
    <div className="contracts">
      <h3>Commesse attive <small>(Clock avanza solo qui — refresh banchi a {CLOCK_REFRESH.join('/')})</small></h3>
      <div className="contract-row">
        {['small', 'medium', 'large'].map(size => (
          state.contracts[size].active.map((slot, si) => (
            <div key={`${size}-${si}`} className="contract-card">
              <div className="contract-title">{SIZE_LABEL[size]} — <b>{slot ? (state.singlePlace ? `${slot.card.pv[0]} PV` : `${slot.card.pv[0]}/${slot.card.pv[1]} PV`) : '—'}</b></div>
              {slot ? slot.card.reqs.map((req, i) => (
                <div key={i} className={`req ${slot.doneReq[i] ? 'done' : ''}`}>
                  {req.map((s, j) => <span key={j} title={s} style={{ color: SECTOR_COLORS[s] }}>{RES_DOT[s]}</span>)}
                  {slot.doneReq[i] && <span className="done-mark"> ✔</span>}
                </div>
              )) : <div className="req">mazzo esaurito</div>}
              {slot && (state.singlePlace
                ? <div className="podium">Vincitore: {slot.places[0] !== null ? state.players[slot.places[0]].name : '—'}</div>
                : <div className="podium">1° {slot.places[0] !== null ? state.players[slot.places[0]].name : '—'} · 2° {slot.places[1] !== null ? state.players[slot.places[1]].name : '—'}</div>
              )}
            </div>
          ))
        ))}
      </div>
      <h3 className="contracts-next-title"><small>Prossime in arrivo (mazzo a faccia in su)</small></h3>
      <div className="contract-row">
        {['small', 'medium', 'large'].map(size => {
          const next = state.contracts[size].deck[0];
          return (
            <div key={`next-${size}`} className="contract-card next">
              <div className="contract-title">{SIZE_LABEL[size]} — <b>{next ? (state.singlePlace ? `${next.pv[0]} PV` : `${next.pv[0]}/${next.pv[1]} PV`) : '—'}</b></div>
              {next ? next.reqs.map((req, i) => (
                <div key={i} className="req">
                  {req.map((s, j) => <span key={j} title={s} style={{ color: SECTOR_COLORS[s] }}>{RES_DOT[s]}</span>)}
                </div>
              )) : <div className="req">mazzo esaurito</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
