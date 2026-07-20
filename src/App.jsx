import React, { useState, useEffect, useRef, useCallback } from 'react';
import { initGame, applyCommand } from './game/engine.js';
import { chooseCommand, deciderId } from './game/ai.js';
import SetupScreen from './components/SetupScreen.jsx';
import GameScreen from './components/GameScreen.jsx';
import EndScreen from './components/EndScreen.jsx';

export default function App() {
  const [state, setState] = useState(null);
  const [history, setHistory] = useState([]);
  const [aiDelay, setAiDelay] = useState(600);
  const [paused, setPaused] = useState(false);
  const timer = useRef(null);

  const dispatch = useCallback((cmd) => {
    setState(prev => {
      if (!prev) return prev;
      setHistory(h => [...h.slice(-60), prev]);
      try {
        return applyCommand(prev, cmd);
      } catch (e) {
        console.error('Comando fallito', cmd, e);
        return prev;
      }
    });
  }, []);

  const undo = useCallback(() => {
    setHistory(h => {
      if (h.length === 0) return h;
      setState(h[h.length - 1]);
      return h.slice(0, -1);
    });
  }, []);

  // Loop AI: se il decisore corrente è un'AI, gioca automaticamente
  useEffect(() => {
    if (!state || state.gameOver || paused) return;
    const decider = state.players[deciderId(state)];
    if (!decider.isAI) return;
    timer.current = setTimeout(() => {
      // chooseCommand è FUORI dal try/catch di dispatch: se lancia (o torna null su turno non finito)
      // l'effect non ri-scatta e l'app si congela in silenzio. Cattura → metti in pausa, non freezare.
      let cmd;
      try { cmd = chooseCommand(state); }
      catch (e) { console.error('AI in stallo (chooseCommand ha lanciato) — partita in pausa', e); setPaused(true); return; }
      if (cmd) dispatch(cmd);
      else { console.error('AI senza mosse legali su turno non finito — partita in pausa', { turn: state.turn, phase: state.phase, current: state.current }); setPaused(true); }
    }, aiDelay);
    return () => clearTimeout(timer.current);
  }, [state, paused, aiDelay, dispatch]);

  if (!state) {
    return <SetupScreen onStart={cfg => { setHistory([]); setState(initGame(cfg)); }} />;
  }
  if (state.gameOver) {
    return <EndScreen state={state} onRestart={() => setState(null)} />;
  }
  return (
    <GameScreen
      state={state}
      dispatch={dispatch}
      undo={history.length > 0 ? undo : null}
      aiDelay={aiDelay} setAiDelay={setAiDelay}
      paused={paused} setPaused={setPaused}
      onAbandon={() => setState(null)}
    />
  );
}
