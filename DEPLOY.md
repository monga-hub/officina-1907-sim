# Simulazioni da telefono, Mac spento

Il simulatore gira **tutto nel browser** (motore, batch, report, editor). Una volta pubblicato
`dist/index.html` su GitHub Pages, apri l'URL dal telefono e simuli lì. Il Mac serve solo per
compilare nuove versioni del *codice*, non per far girare quella esistente.

## Prima volta (dal Mac, ~5 min)

1. Crea un repo su https://github.com/new — es. `officina-1907-sim`, privato va bene.
   NON aggiungere README/gitignore (il repo locale c'è già).
2. Collega il remote e carica il codice (sostituisci UTENTE):
   ```bash
   cd "/Users/daniele/CoudeCode/officina-1907-sim-2.0"
   git remote add origin https://github.com/UTENTE/officina-1907-sim.git
   git push -u origin main
   ```
3. Pubblica la build sul branch gh-pages:
   ```bash
   ./deploy.sh
   ```
4. Su GitHub: repo → Settings → Pages → Source = branch `gh-pages`, cartella `/ (root)` → Save.
5. Dopo ~1 minuto l'app è a: `https://UTENTE.github.io/officina-1907-sim/`
   Aprila sul telefono e salvala nella schermata Home per comodità.

## Uso quotidiano dal telefono (Mac spento)

- Apri l'URL. Config e regole si modificano dagli editor (si salvano nel telefono, localStorage).
- Tab "🤖 Simulazione automatica" → Avvia. **Batch piccoli** (10-15 partite) o rollout d2:
  la CPU del telefono è lenta, d4×30 ci mette minuti.
- Report: **📋 Copia risultati** (HTTPS → clipboard funziona) o **📤 Condividi** → Note/Mail/chat.

## Quando cambi il CODICE (nuova meccanica) — serve il Mac

```bash
cd "/Users/daniele/CoudeCode/officina-1907-sim-2.0"
git add -A && git commit -m "descrizione"
git push
./deploy.sh          # ricompila e ripubblica; l'URL resta lo stesso
```

Le modifiche di *regole/config* (editor) NON richiedono questo: si fanno dal telefono.

## Config baseline (parte già impostata)

La build include una **config baseline congelata** (`src/game/baseline-config.json`): fabbrica
neutra, cancello-milestone OFF, slot 3/2, ecc. Al primo caricamento su un dispositivo la scrive
automaticamente negli editor. Poi ogni modifica fatta dal telefono persiste normalmente (localStorage).

- **Telefono nuovo / mai aperto** → parte già con questa config.
- **Telefono che aveva la vecchia config** → al primo reload dopo il deploy la sovrascrive **una volta**.
- **Cambi la baseline e vuoi riforzarla su tutti i dispositivi** → alza `BASELINE_VERSION` in
  `src/main.jsx` (es. `v1`→`v2`), poi `./deploy.sh`. Al reload i dispositivi riapplicano la nuova baseline
  una volta (sovrascrive gli edit locali di config — è voluto: "torna alla baseline").
