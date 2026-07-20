import React from 'react';
import { NODES, NODE_BANKS, NATION_FLAGS, SECTOR_COLORS, IMPIEGATI_BANK, nodeLabel } from '../game/data.js';
import { WORKER_BY_ID, currentPlayer, legalCommands, bankMarket } from '../game/engine.js';

// Posizioni pentagono (percentuali sul riquadro)
const NODE_POS = {
  Tessile: { left: '50%', top: '4%' },
  Metallurgica: { left: '92%', top: '38%' },
  Chimica: { left: '76%', top: '88%' },
  Servizi: { left: '24%', top: '88%' },
  Sindacato: { left: '8%', top: '38%' },
  Borsa: { left: '50%', top: '47%' },
};
const BANK_POS = {
  Italiani: { left: '76%', top: '16%' },   // Tessile-Metallurgica
  Polacchi: { left: '92%', top: '66%' },   // Metallurgica-Chimica
  Spagnoli: { left: '50%', top: '96%' },   // Chimica-Servizi
  Tedeschi: { left: '8%', top: '66%' },    // Servizi-Sindacato
  Francesi: { left: '24%', top: '16%' },   // Sindacato-Tessile
  Greci: { left: '50%', top: '70%' },      // mazzo nuovo (6ª nazione): nessuno slot pentagono libero, posizione provvisoria vicino a Borsa
  // mazzo nuovo: bankIds 'A'..'E' (1 mazzetto per nodo, NEW_NODE_BANKS) — riuso le stesse coordinate degli slot
  // nazione sopra, un edge adiacente al nodo di ciascun mazzetto, per non introdurre nuove sovrapposizioni.
  A: { left: '24%', top: '16%' },   // Tessile
  B: { left: '76%', top: '16%' },   // Metallurgica
  C: { left: '92%', top: '66%' },   // Chimica
  D: { left: '50%', top: '96%' },   // Servizi
  E: { left: '8%', top: '66%' },    // Sindacato
  [IMPIEGATI_BANK]: { left: '39%', top: '72%' }, // mercato Impiegati: 2° banco di Servizi, nel vuoto tra E, Borsa e il nodo Servizi (3 carte scoperte, vedi .bank.market)
};
const NATION_FLAGS_ALL = { ...NATION_FLAGS, Greci: '🇬🇷' };

export default function CityBoard({ state, dispatch }) {
  const p = currentPlayer(state);
  const canMove = state.phase === 'move' && !p.isAI && !state.pending;
  const moves = canMove ? legalCommands(state).filter(c => c.type === 'move') : [];

  return (
    <div className="city">
      <h3>La Città</h3>
      <div className="city-map">
        {NODES.map(node => {
          const mv = moves.find(m => m.node === node);
          const here = state.players.filter(q => q.node === node);
          const sectorColor = SECTOR_COLORS[node];
          return (
            <div key={node}
              className={`node ${mv ? 'clickable' : ''} ${node === 'Borsa' ? 'borsa' : ''}`}
              style={{ ...NODE_POS[node], borderColor: sectorColor || '#888' }}
              onClick={() => mv && dispatch(mv)}
              title={mv ? `Vai a ${nodeLabel(node)}${mv.cost ? ` (${mv.cost} marco)` : ' (gratis)'}` : nodeLabel(node)}>
              {/* nodeLabel: gli id 'Servizi'/'Borsa' a schermo sono "Borsa"/"Città" (vedi NODE_LABEL in data.js) */}
              <div className="node-name">{node === 'Borsa' ? '🏙 Città' : SECTOR_COLORS[node] ? `⚙ ${node}` : node === 'Servizi' ? '📈 Borsa' : '✊ Sindacato'}</div>
              {mv && <div className="cost">{mv.cost ? `${mv.cost} ⓜ` : 'gratis'}</div>}
              <div className="meeples">
                {here.map(q => <span key={q.id} className="meeple" style={{ background: q.color }} title={q.name} />)}
              </div>
            </div>
          );
        })}
        {state.bankIds.map(nat => {
          const bank = state.banks[nat];
          // banchi lavoratori: solo la cima. Mercato Impiegati (Servizi): 3 carte scoperte.
          const market = bankMarket(state, nat).map(id => WORKER_BY_ID[id]);
          return (
            <div key={nat} className={nat === IMPIEGATI_BANK ? 'bank market' : 'bank'} style={BANK_POS[nat]}>
              <div className="bank-name">{NATION_FLAGS_ALL[nat] || ''} {nat} ({bank.length})</div>
              {market.length ? market.map(c => (
                <div key={c.id} className="bank-card" style={{ borderColor: SECTOR_COLORS[c.sector] }} title={c.effectText || 'nessun bonus (impiegato)'}>
                  <span className="v">V{c.v}</span>
                  <span className="sec" style={{ color: SECTOR_COLORS[c.sector] }}>{c.sector || Object.keys(c.power || {}).join('+')}</span>
                  <div className="eff">{c.effectText || 'avanza ' + Object.entries(c.power || {}).map(([s, n]) => `${s} +${n}`).join(', ')}</div>
                </div>
              )) : <div className="bank-card empty">esaurito</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
