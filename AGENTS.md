# TV-Gids — Richtsnoeren en werkversie

## Work State
### Completed
- DAZN-adapter `src/lib/sources/dazn.ts` (events-API, FAST-filter, heuristische `assign()` op 6 kanalen) + importpijplijn + `data/channels.json` omgezet naar `source: 'dazn.com'`.
- UI: `.prog.dazn`-klasse + violette gestippelde omlijning/CSS + tooltip-noot ".dazn-note" in `EpgApp.tsx` (`dazn = p.source === 'dazn.com'`).
- Herimport (3 dagen, 63 echte programma's, incl. Standard–Cercle, Gent–Mechelen, Anderlecht–La Louvière op 08–09), sportpaneel herkent JPL-duels ("Voetbal | Jupiler Pro League"), typecheck + build + push + live-check (commit `b0016b3`).
- Play Sports Premier League → **"Play Sports 5"**: naam gewijzigd in `src/lib/channels.ts` én `data/channels.json`; `data/sport/*.json` (11 dagen) geregenereerd; build + push + live (commit `785790f`, live naam geverifieerd). Play Sports Open bewust behouden (verborgen, gebruiker gebruikt het niet).
- **JPL-knop**: `public/icons/jpl.png` (van "Mijn iconen/Jup Pro League Groot.png" 2657px → 256px, 33KB) + topbar-knop `.sport-jpl-btn` (naast "⚽ Sport") + `sportJplOnly` state + `jplOnly`-prop in `SportPanel` (filtert op `competition === 'Jupiler Pro League'`), logo in paneelheader (`.jpl-panel-icon`), actieve-knop-stijl (bruin `#7c2d12`), specifieke lege-staattekst. Typecheck + build OK. Gebruiker koos: "Sportpanel openen, enkel JPL" (dus géén gridfilter).
- Review-fixes (klaar, oncommitted): `src/lib/import.ts` try/catch DAZN-fetch (bij falen → `errors` + log, `daznMap = null`, DAZN-zenders overslaan); `src/lib/sources/dazn.ts` FAST-filter `/^3000/` i.p.v. exacte string + `console.warn` voor dazn-zenders buiten toewijzingsgroepen.
- Datafiles `data/sport/2026-08-07.json`, `data/status.json`, `data/log.jsonl` teruggezet naar committed versie (test-import-bijzaak; werkboom is weer schoon t.a.v. data).

### Active
- (niets — wacht op beslissing gebruiker over committen/pushen)

### Blocked
- Wacht op gebruikersbeslissing over committen/pushen (koos voorlopig enkel "datafiles terugzetten").

## Next Move
1. Commit + push (review-fixes + JPL-knop: `EpgApp.tsx`, `global.css`, `import.ts`, `dazn.ts`, `public/icons/jpl.png`) + build/deploy zodra gebruiker dit vraagt.

## Important Details
- JPL-events → kanalen `dazn-jpl1/2/3`, overige sport → `dazn1/2/3`, violette gestippelde omlijning = "stream niet noodzakelijk op dit kanaal".
- **Overlappingen** op DAZN 1/2/3 (o.a. 08-08: National League-reeks, EWC) bevestigd, maar gebruiker annuleerde het tweelijnen-idee → geen wijzigingen.
- Play Sports ≠ DAZN-API (twee aparte bronnen). Play Sports 2 en 5 zijn match-day/part-time kanalen: alleen fillers tot **21/08** (Telenet-horizon; 22/08 → 404), behalve **16/08** (`sporting5`: UCI ProSeries Mannen [Arctic Race for Norway – Etappe 4] 14:15-16:15; `playsports6`: Formule E). Echte data komt automatisch binnen zodra Telenet ze publiceert (geen bug).
- Kanaalwijziging: `sporting5` = "Play Sports 5". Play Sports Open bestaat niet meer bij Telenet maar blijft bewust in `channels.ts`/`channels.json` (kanaal verborgen).
- JPL-matches hebben `competition === 'Jupiler Pro League'` (exact) in `data/sport/*.json` via `detectCompetition` (`src/lib/sport.ts:218`).
- Iconen-map: enkel "Jup Pro League Groot.png" (2657×2657, RGBA) bestaat; "Klein"-variant is er niet.
- `npm run typecheck` (tsc --noEmit) en `npm run build` (astro) zijn de verificatiecommando's. `prebuild` = `tsx scripts/generate-static.ts` regenereert `public/data` (11 dagen) uit `data/sport/*.json`.
- Alleen committen/pushen wanneer gebruiker dit expliciet vraagt.

## Structuur
- `src/components/EpgApp.tsx` — EPG-grid, topbar (o.a. "⚽ Sport", "JPL", "🏆 Sport-only"), `SportPanel` (groepering per competitie, `jplOnly`-prop)
- `src/lib/sources/dazn.ts` — DAZN events-API adapter (`fetchDaznEvents`, `assign`, `importDaznDay`, `buildProgramme`)
- `src/lib/import.ts` — importpijplijn over alle bronnen
- `src/lib/channels.ts` + `data/channels.json` — zenders (id, sources met site_id/xmltv_id, group, priority)
- `data/sport/*.json` — gegenereerde sportevenementen per dag (bron voor sportpaneel)
- `src/styles/global.css` — alle styling
- `public/icons/jpl.png` — JPL-knopicoon
