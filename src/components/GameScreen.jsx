import React, { useState } from 'react';
import CityBoard from './CityBoard.jsx';
import FactoryBoard from './FactoryBoard.jsx';
import ContractsPanel from './ContractsPanel.jsx';
import ActionPanel from './ActionPanel.jsx';
import PendingModal from './PendingModal.jsx';
import { currentPlayer } from '../game/engine.js';
import { deciderId } from '../game/ai.js';

export default function GameScreen({ state, dispatch, undo, aiDelay, setAiDelay, paused, setPaused, onAbandon }) {
  const [logOpen, setLogOpen] = useState(true);
  const p = currentPlayer(state);
  const decider = state.players[deciderId(state)];
  const humanPending = state.pending && !decider.isAI;

  return (
    <div className="game">
      <header>
        <strong>OFFICINA 1907</strong>
        <span>Turno {state.turn} — tocca a <b style={{ color: p.color }}>{p.name}</b>{p.isAI ? ' (AI)' : ''}</span>
        <span className="clock">Clock {state.clock}/{state.clockThreshold}{state.finalRound ? ' — ULTIMO GIRO' : ''}</span>
        <span className="controls">
          AI: <select value={aiDelay} onChange={e => setAiDelay(Number(e.target.value))}>
            <option value={0}>istantanea</option>
            <option value={300}>veloce</option>
            <option value={600}>normale</option>
            <option value={1200}>lenta</option>
          </select>
          <button onClick={() => setPaused(!paused)}>{paused ? '▶ Riprendi' : '⏸ Pausa'}</button>
          {undo && <button onClick={undo}>↩ Annulla</button>}
          <button onClick={() => { if (confirm('Abbandonare la partita?')) onAbandon(); }}>✕ Esci</button>
        </span>
      </header>

      <div className="main">
        <div className="left">
          <CityBoard state={state} dispatch={dispatch} />
          <ContractsPanel state={state} />
        </div>
        <div className="center">
          {state.players.map(pl => (
            <FactoryBoard key={pl.id} state={state} player={pl} isCurrent={pl.id === p.id} />
          ))}
        </div>
        <div className={`right ${logOpen ? '' : 'closed'}`}>
          <ActionPanel state={state} dispatch={dispatch} />
          <div className="log">
            <h3 onClick={() => setLogOpen(!logOpen)}>Registro {logOpen ? '▾' : '▸'}</h3>
            {logOpen && (
              <ul>
                {[...state.log].reverse().slice(0, 60).map((l, i) => (
                  <li key={i}><em>T{l.turn}</em> {l.text}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {humanPending && <PendingModal state={state} dispatch={dispatch} />}
    </div>
  );
}
