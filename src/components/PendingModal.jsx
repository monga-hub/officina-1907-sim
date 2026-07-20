import React from 'react';
import { SECTORS, RESOURCE_OF, SECTOR_COLORS, NATION_FLAGS } from '../game/data.js';
import { legalCommands, WORKER_BY_ID } from '../game/engine.js';

export default function PendingModal({ state, dispatch }) {
  const pend = state.pending;
  const owner = state.players[pend.playerId];
  const legal = legalCommands(state);

  return (
    <div className="modal-back">
      <div className="modal">
        {pend.type === 'sciopero' ? (
          <>
            <h3>✊ SCIOPERO — {owner.name}</h3>
            <p>La Tensione in <b>{owner.depts[pend.role].sector}</b> ha raggiunto il limite: scegli una carta da bloccare (resta nello slot ma smette di produrre).</p>
            <div className="btn-row col">
              {legal.map((c, i) => {
                const w = WORKER_BY_ID[c.cardId];
                const side = owner.depts[pend.role].sopra.includes(c.cardId) ? 'Sopra' : 'Sotto';
                return (
                  <button key={i} onClick={() => dispatch(c)}>
                    {NATION_FLAGS[w.nation]} <span style={{ color: SECTOR_COLORS[w.sector] }}>{w.sector}</span> V{w.v} ({side}) — «{w.effectText}»
                  </button>
                );
              })}
            </div>
          </>
        ) : pend.type === 'trackTile' ? (
          <TrackTileChoice state={state} pend={pend} owner={owner} legal={legal} dispatch={dispatch} />
        ) : (
          <EffectChoice state={state} pend={pend} owner={owner} legal={legal} dispatch={dispatch} />
        )}
      </div>
    </div>
  );
}

// Scelta della tile nel momento in cui si raggiunge la milestone che apre il mercato (non più alla Borsa).
const CELL_LABEL = {
  coins: n => `+${n} ⓜ a ogni attivazione`,
  coinsPerIcon: n => `+${n} ⓜ per icona del settore, a ogni attivazione`,
  coinsPerTension: n => `+${n} ⓜ per Tensione, a ogni attivazione`,
  res: n => `+${n} risorse a ogni attivazione`,
  resPerIcon: n => `+${n} risorsa per icona del settore, a ogni attivazione`,
  resPerTension: n => `+${n} risorsa per Tensione, a ogni attivazione`,
  coinsPerFactory: n => `+${n} ⓜ per fabbrica del settore, a ogni attivazione`,
  resPerFactory: n => `+${n} risorsa per fabbrica del settore, a ogni attivazione`,
  pv: n => `+${n} PV a fine partita`,
  pvPerIcon: n => `+${n} PV per icona del settore, a fine partita`,
  pvPerTension: n => `+${n} PV per Tensione, a fine partita`,
  pvPerFactory: n => `+${n} PV per fabbrica del settore, a fine partita`,
};
function TrackTileChoice({ state, pend, owner, legal, dispatch }) {
  const sector = owner.depts[pend.role].sector;
  const useOpts = legal.filter(c => c.use);
  return (
    <>
      <h3>🧩 Ricerca e Sviluppo — {owner.name}</h3>
      <p>
        <b>{sector}</b> ha raggiunto la milestone {pend.market}: scegli la tile da installare sulla casella{' '}
        <b>{pend.pos}</b> del tracciato. Produrrà a ogni attivazione del reparto.
      </p>
      <div className="btn-row col">
        {useOpts.map((c, i) => {
          const t = state.trackTileById[c.tileId];
          return (
            <button key={i} onClick={() => dispatch(c)}>
              <b>{t.name}</b> — {(CELL_LABEL[t.cellType] || (n => `${t.cellType} ${n}`))(t.amount)}
              {t.cost > 0 && ` · costa ${t.cost} ${RESOURCE_OF[sector]}`}
            </button>
          );
        })}
        <button className="ghost" onClick={() => dispatch({ type: 'resolveTrackTile', use: false })}>
          Nessuna (lo slot resta vuoto, comprabile alla Borsa)
        </button>
      </div>
    </>
  );
}

function EffectChoice({ state, pend, owner, legal, dispatch }) {
  const w = WORKER_BY_ID[pend.cardId];
  const useOpts = legal.filter(c => c.use);
  return (
    <>
      <h3>Effetto carta — {owner.name}</h3>
      <p>«{w.effectText}» <small>(opzionale)</small></p>
      <div className="btn-row col">
        {useOpts.map((c, i) => (
          <button key={i} onClick={() => dispatch(c)}>
            {w.effect.type === 'swap_res_any' && `1 ${RESOURCE_OF[c.give]} → 1 ${RESOURCE_OF[c.take]}`}
            {w.effect.type === 'buy_res_2m' && `2 ⓜ → 1 ${RESOURCE_OF[c.take]}`}
            {w.effect.type === 'swap_res_3m' && `1 ${RESOURCE_OF[c.give]} → 3 ⓜ`}
          </button>
        ))}
        <button className="ghost" onClick={() => dispatch({ type: 'resolveEffect', use: false })}>Non usare</button>
      </div>
    </>
  );
}
