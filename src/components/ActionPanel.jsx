import React, { useState } from 'react';
import { SECTORS, RESOURCE_OF, SECTOR_COLORS, NATION_FLAGS, NODE_BANKS, UNBLOCK_COST } from '../game/data.js';
import { currentPlayer, legalCommands, WORKER_BY_ID, welfareCount, rankedIndices, indexValue, cellNow, expectedDividend } from '../game/engine.js';

import FactoryMap from './FactoryMap.jsx';

const ROLE_LABEL = { terziario: 'Terziario', secondario: 'Secondario', primario: 'Primario', direzione: 'Direzione' };

export default function ActionPanel({ state, dispatch }) {
  const p = currentPlayer(state);
  if (p.isAI && !state.pending) {
    return <div className="actions"><h3>Azioni</h3><p className="hint">L'AI sta giocando…</p></div>;
  }
  if (state.pending) {
    return <div className="actions"><h3>Azioni</h3><p className="hint">Decisione in corso…</p></div>;
  }
  const legal = legalCommands(state);

  return (
    <div className="actions">
      <h3>Azioni — {p.name}</h3>
      {state.phase === 'move' && <p className="hint">Clicca un nodo della Città per spostare il Procuratore (slot 1 gratis, slot 2 = 1 marco; alla Borsa puoi restare).</p>}
      {state.phase === 'action' && <NodeActions state={state} p={p} legal={legal} dispatch={dispatch} />}
      {state.phase === 'borsa' && <BorsaActions state={state} p={p} legal={legal} dispatch={dispatch} />}
    </div>
  );
}

function NodeActions({ state, p, legal, dispatch }) {
  const hires = legal.filter(c => c.type === 'hire');
  const activate = legal.find(c => c.type === 'activate');
  const welfare = legal.filter(c => c.type === 'buyWelfare');
  const strutture = legal.filter(c => c.type === 'buyStruttura');
  const EFFECT_LABEL = { 'hire-1_Tessile+Chimica': '−1 ⓜ assunzioni a Tessile e Chimica', 'hire-1_Tessile+Metallurgica': '−1 ⓜ assunzioni a Tessile e Metallurgica', 'hire-1_Chimica+Metallurgica': '−1 ⓜ assunzioni a Chimica e Metallurgica', 'freeSecond_Tessile+Chimica': '2° posto gratis a Tessile e Chimica', 'freeSecond_Tessile+Metallurgica': '2° posto gratis a Tessile e Metallurgica', 'freeSecond_Chimica+Metallurgica': '2° posto gratis a Chimica e Metallurgica' };
  // una carta per blocco (non un banco): il mercato Impiegati a Servizi ne scopre 3 sullo stesso banco.
  const hireCards = [...new Set(hires.map(c => c.cardId))];

  return (
    <div>
      <p className="hint">Sei a <b>{p.node}</b>. Scegli una delle azioni del nodo:</p>

      {hireCards.length > 0 && <h4>Assumi un operaio</h4>}
      {hireCards.map(cardId => {
        const w = WORKER_BY_ID[cardId];
        const opts = hires.filter(c => c.cardId === cardId);
        const powerText = w.power && Object.entries(w.power).map(([s, n]) => `${s} +${n}`).join(', ');
        return (
          <div key={cardId} className="hire-block">
            <div className="hire-card" style={{ borderColor: SECTOR_COLORS[w.sector] }}>
              {NATION_FLAGS[w.nation]} <b>{w.nation}</b> · <span style={{ color: SECTOR_COLORS[w.sector] }}>{w.sector || 'Impiegato'}</span> · costo <b>{w.v} ⓜ</b>
              <div className="eff">{powerText ? `avanza ${powerText}` : `«${w.effectText}»`}</div>
            </div>
            <div className="hire-opts">
              {opts.filter(o => o.side === 'sopra').map((o, i) => (
                <button key={'so' + i} onClick={() => dispatch(o)}>Sopra ({ROLE_LABEL[o.role]} — avanza {powerText || `${w.sector} di ${w.v}`})</button>
              ))}
              {opts.filter(o => o.side === 'sotto').map((o, i) => (
                <button key={'st' + i} onClick={() => dispatch(o)}>Sotto in {p.depts[o.role].sector} ({ROLE_LABEL[o.role]})</button>
              ))}
              {opts.length === 0 && <small>non installabile / marchi insufficienti</small>}
            </div>
          </div>
        );
      })}

      {activate && (
        <>
          <h4>Attiva un reparto</h4>
          <button className="primary" onClick={() => dispatch(activate)}>
            Attiva {activate.sector} (Tensione +1, produci dal tracciato + carte Sotto)
          </button>
        </>
      )}

      {p.node === 'Servizi' && state.servicesMode === 'struttura' && (
        <>
          <h4>Acquista carta Struttura</h4>
          {strutture.length === 0 && <small>Nessun acquisto possibile (marchi insufficienti o mercato esaurito).</small>}
          <div className="welfare-list">
            {[...new Set(strutture.map(c => c.idx))].map(idx => {
              const card = state.strutturaCards[idx];
              const sides = strutture.filter(c => c.idx === idx);
              return (
                <div key={idx} className="welfare-item">
                  <b>Struttura #{idx + 1}</b> — {card.cost} ⓜ · Sopra: potenza T{card.power.Tessile || 0}/M{card.power.Metallurgica || 0}/C{card.power.Chimica || 0} · Sotto: {EFFECT_LABEL[card.effect] || card.effect}
                  <div>
                    {sides.map((c, i) => <button key={i} onClick={() => dispatch(c)}>{c.side === 'sopra' ? 'Sopra (tracciati)' : 'Sotto (effetto)'}</button>)}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {p.node === 'Servizi' && state.borsaFabbriche?.enabled && (
        <>
          <h4>Borsa — fabbriche {legal.some(c => c.type === 'buildFactory') ? `(costo ${state.borsaFabbriche.costCurve[Math.min(p.factories.length, state.borsaFabbriche.costCurve.length - 1)]} ⓜ)` : ''}</h4>
          {!legal.some(c => c.type === 'buildFactory') && <small>Nessuna fondazione possibile ora (serve una milestone di reparto, un posto adiacente a una risorsa dello stesso colore, e i marchi).</small>}
          <FactoryMap state={state} legal={legal} dispatch={dispatch} />
        </>
      )}

      {p.node === 'Servizi' && state.borsaIndici?.enabled && !state.borsaFabbriche?.enabled && (
        <>
          <h4>Borsa — azioni Q{state.quad + 1} ({state.borsaIndici.prices[state.quad] ?? '—'} ⓜ l'una)</h4>
          {(() => {
            const buys = legal.filter(c => c.type === 'buyShare');
            const ranked = rankedIndices(state);
            return (
              <>
                <table className="mini">
                  <thead><tr><th>Indice</th><th>valore</th><th>rango</th><th>casella</th><th>investitori</th><th>se entri</th><th /></tr></thead>
                  <tbody>
                    {ranked.map(name => {
                      const mine = !!p.shares[name];
                      const investors = state.players.filter(q => q.shares[name]).length;
                      const cmd = buys.find(c => c.index === name);
                      return (
                        <tr key={name} style={{ opacity: mine ? 0.55 : 1 }}>
                          <td><b>{name}</b></td>
                          <td>{indexValue(state, name)}</td>
                          <td>{ranked.indexOf(name) + 1}°</td>
                          <td>{cellNow(state, name)} PV</td>
                          <td>{investors}</td>
                          <td>{expectedDividend(state, name, mine)} PV</td>
                          <td>{mine ? <small>già investito</small> : cmd ? <button onClick={() => dispatch(cmd)}>Compra</button> : <small>—</small>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <small>
                  Il dividendo è la casella ÷ i giocatori che ci sono dentro: entrare dove c'è già qualcuno lo dimezza per
                  entrambi. Paga alla chiusura di Q{state.quad + 1} (Clock {state.borsaIndici.quadBounds[state.quad]}), poi l'azione scade.
                </small>
              </>
            );
          })()}
        </>
      )}

      {p.node === 'Servizi' && state.servicesMode !== 'struttura' && state.welfareEnabled && (
        <>
          <h4>Acquista Welfare / Macchinario</h4>
          {welfare.length === 0 && <small>Nessun acquisto possibile (marchi o slot Direzione).</small>}
          <div className="welfare-list">
            {[...new Set(welfare.map(c => c.cardId))].map(id => {
              const wf = state.welfareById[id];
              const sides = welfare.filter(c => c.cardId === id);
              return (
                <div key={id} className="welfare-item">
                  <b>{wf.name}</b> — {wf.v} ⓜ · avanza {wf.s1} +{wf.t1} / {wf.s2} +{wf.t2} · macchinario: {wf.perUse.map(s => RESOURCE_OF[s]).join('+')} ×{wf.usesMax}
                  <div>
                    {sides.map((c, i) => (
                      <button key={i} onClick={() => dispatch(c)}>{c.side === 'sopra' ? 'Welfare (Sopra)' : 'Macchinario (Sotto)'}</button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {p.node === 'Sindacato' && <TrattativaBuilder state={state} p={p} dispatch={dispatch} />}

      <div className="pass-row">
        <button className="ghost" onClick={() => dispatch({ type: 'pass' })}>Rinuncia all'azione</button>
      </div>
    </div>
  );
}

function TrattativaBuilder({ state, p, dispatch }) {
  const wf = welfareCount(p);
  const roles = ['terziario', 'secondario', 'primario'];
  const opponents = state.players.filter(q => q.id !== p.id);
  const [resetRole, setResetRole] = useState('primario');
  const [targetPlayer, setTargetPlayer] = useState(opponents[0].id);
  const [targetRole, setTargetRole] = useState('primario');
  const [f2, setF2] = useState(wf >= 1 ? 'refresh' : '');
  const [f2card, setF2card] = useState('');
  const [f3, setF3] = useState('');
  const [f3role, setF3role] = useState('primario');

  const blockedCards = roles.flatMap(r => p.depts[r].blocked.map(id => ({ role: r, id })));
  const cmd = { type: 'trattativa', resetRole, targetPlayer: Number(targetPlayer), targetRole };
  if (wf >= 1 && f2 === 'refresh') cmd.f2 = 'refresh';
  if (wf >= 1 && f2 === 'unblock' && f2card) {
    const found = blockedCards.find(b => b.id === f2card);
    Object.assign(cmd, { f2: 'unblock', f2role: found.role, f2card });
  }
  if (wf >= 2 && f3 === 'tension') Object.assign(cmd, { f3: 'tension', f3role });

  return (
    <div className="tratt">
      <h4>Trattativa sindacale (gratuita)</h4>
      <div className="tratt-row">
        <label>Azzera Tensione del tuo reparto:{' '}
          <select value={resetRole} onChange={e => setResetRole(e.target.value)}>
            {roles.map(r => <option key={r} value={r}>{p.depts[r].sector} (Tens. {p.depts[r].tension})</option>)}
          </select>
        </label>
        <label>+1 Tensione a:{' '}
          <select value={targetPlayer} onChange={e => setTargetPlayer(e.target.value)}>
            {opponents.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <select value={targetRole} onChange={e => setTargetRole(e.target.value)}>
            {roles.map(r => {
              const d = state.players[Number(targetPlayer)].depts[r];
              return <option key={r} value={r}>{d.sector} (Tens. {d.tension}{d.sopra.length + d.sotto.length === 0 ? ', vuoto' : ''})</option>;
            })}
          </select>
        </label>
      </div>
      {wf >= 1 && (
        <div className="tratt-row">
          <label>Fase 2 ({wf} Welfare):{' '}
            <select value={f2} onChange={e => setF2(e.target.value)}>
              <option value="">— niente —</option>
              <option value="refresh">Refresh del mercato</option>
              {blockedCards.length > 0 && p.coins >= UNBLOCK_COST && <option value="unblock">Elimina uno Sciopero ({UNBLOCK_COST} ⓜ)</option>}
            </select>
          </label>
          {f2 === 'unblock' && (
            <select value={f2card} onChange={e => setF2card(e.target.value)}>
              <option value="">scegli carta…</option>
              {blockedCards.map(b => <option key={b.id} value={b.id}>{WORKER_BY_ID[b.id].effectText} ({p.depts[b.role].sector})</option>)}
            </select>
          )}
        </div>
      )}
      {wf >= 2 && (
        <div className="tratt-row">
          <label>Fase 3 (2 Welfare):{' '}
            <select value={f3} onChange={e => setF3(e.target.value)}>
              <option value="">— niente —</option>
              <option value="tension">Riduci Tensione di 1</option>
            </select>
          </label>
          {f3 === 'tension' && (
            <select value={f3role} onChange={e => setF3role(e.target.value)}>
              {roles.map(r => <option key={r} value={r}>{p.depts[r].sector} (Tens. {p.depts[r].tension})</option>)}
            </select>
          )}
          <small>(L'acquisto scontato di un lavoratore è disponibile per l'AI; per gli umani sarà nella prossima versione)</small>
        </div>
      )}
      <button className="primary" onClick={() => dispatch(cmd)}>Esegui Trattativa</button>
    </div>
  );
}

function BorsaActions({ state, p, legal, dispatch }) {
  const sells = legal.filter(c => c.type === 'exchange' && c.kind === 'sell');
  const converts = legal.filter(c => c.type === 'exchange' && c.kind === 'convert');
  const completes = legal.filter(c => c.type === 'completeContract');
  const exitCmd = legal.find(c => c.type === 'borsaExit');
  const refreshes = legal.filter(c => c.type === 'refreshMarket');
  const tileBuys = legal.filter(c => c.type === 'buyTrackTile');
  const exitPathUsed = state.borsaExitUsed || state.borsaRefreshUsed || state.borsaTileUsed;
  const SIZE_LABEL = { small: 'piccola', medium: 'media', large: 'grande' };
  const REFRESH_LABEL = { welfare: 'Rinfresca mercato Welfare', workers: 'Rinfresca banchi operai' };

  return (
    <div>
      <p className="hint">
        Sei alla <b>Città</b>: Vendi {state.sellUsedThisVisit}/1 · Scambia {state.convertUsedThisVisit}/1 usati
        questa visita, max 2 Commesse per visita ({state.contractsThisVisit}/2 completate).
      </p>
      <h4>Cambio risorse</h4>
      <div className="btn-row">
        {sells.map((c, i) => <button key={i} onClick={() => dispatch(c)}>{c.giveQty} {RESOURCE_OF[c.give]} → {c.getQty} ⓜ</button>)}
      </div>
      <div className="btn-row">
        {converts.map((c, i) => <button key={i} onClick={() => dispatch(c)}>{c.giveQty} {RESOURCE_OF[c.give]} → {c.getQty} {RESOURCE_OF[c.take]}</button>)}
      </div>
      <h4>Completa Commesse</h4>
      {state.contractsThisVisit === 0 && exitPathUsed && <small>Non completabili: hai già scelto di uscire con bonus/refresh/tile in questa visita.</small>}
      {state.contractsThisVisit < 2 && !exitPathUsed && completes.length === 0 && <small>Nessuna commessa completabile con le risorse attuali.</small>}
      <div className="btn-row col">
        {completes.map((c, i) => {
          const slot = state.contracts[c.size].active[c.slotIndex ?? 0];
          const place = state.singlePlace ? 0 : (slot.places[0] === null ? 0 : 1);
          return (
            <button key={i} className="primary" onClick={() => dispatch(c)}>
              Commessa {SIZE_LABEL[c.size]} — {slot.card.reqs[c.reqIndex].map(s => RESOURCE_OF[s]).join(', ')} → {slot.card.pv[place]} PV{state.singlePlace ? '' : ` (${place + 1}°)`}
            </button>
          );
        })}
      </div>
      {(exitCmd || refreshes.length > 0) && (
        <>
          <h4>Esci senza Commesse</h4>
          <p className="hint">Alternativa alle Commesse in questa visita: una volta scelta, non potrai più completarne.</p>
          <div className="btn-row">
            {exitCmd && <button onClick={() => dispatch(exitCmd)}>Esci con {exitCmd.coins} ⓜ</button>}
            {refreshes.map((c, i) => <button key={i} onClick={() => dispatch(c)}>{REFRESH_LABEL[c.target]}</button>)}
          </div>
        </>
      )}
      {tileBuys.length > 0 && (
        <>
          <h4>Ricerca e Sviluppo</h4>
          <p className="hint">Il secondo palazzo della Borsa: mercato tile tracciato. Alternativa alle Commesse in questa visita (combinabile con bonus/refresh sopra).</p>
          {Object.entries(tileBuys.reduce((acc, c) => { (acc[`${c.role}-${c.pos}`] ??= []).push(c); return acc; }, {})).map(([key, opts]) => (
            <div key={key} className="btn-row col">
              <small>{ROLE_LABEL[opts[0].role]} — slot pos.{opts[0].pos}</small>
              <div className="btn-row">
                {opts.map((c, i) => {
                  const t = state.trackTileById[c.tileId];
                  return <button key={i} onClick={() => dispatch(c)}>{t.name} ({t.cost} {RESOURCE_OF[p.depts[c.role].sector]})</button>;
                })}
              </div>
            </div>
          ))}
        </>
      )}
      <div className="pass-row">
        <button onClick={() => dispatch({ type: 'endTurn' })}>Fine turno</button>
      </div>
    </div>
  );
}
