# TV & Sport Gids

Gratis TV- en sportgids als PWA (installeerbaar op iPhone/iPad/Mac), geïnspireerd op de Telenet-gids.
Toont Belgische en Nederlandse zenders in één tijdlijn met programma-informatie, live "NU"-lijn en sport.

- **Geen betalende databronnen** — alleen gratis, publiek toegankelijke EPG-bronnen.
- **Nooit verzonnen data** — de app toont enkel wat de bronnen leveren; ontbrekende info wordt expliciet aangegeven.
- **Geen streaming** — alleen "wat, waar en wanneer".

## Functies

- EPG-tijdlijn: zenders verticaal, programma's proportioneel horizontaal, sticky uren-rubriek en zenderkolom.
- Datumnavigatie: vorige/vandaag/morgen, datumkiezer en "Nu"-knop.
- Programma-info: hover-tooltip (desktop) en tap-bottom-sheet (mobiel) met omschrijving, afbeelding en categorieën.
- **Mijn zenders**: aan/uit, favorieten (★), sorteren (verslepen/↑↓), zoeken. Opgeslagen per gebruiker in `localStorage`.
- Sportintegratie: sportkanalen (Play Sports 1–4, Premier League, Golf, Open, DAZN 1–3, DAZN Pro League 1–3) en een live sportbalk met aankomende/lopende wedstrijden.
- PWA: installeerbaar, offline shell en caching van de laatst opgehaalde EPG.
- Status/admin-pagina: per zender en bron (beschikbaarheid, dagen, laatste update, ontbrekende omschrijvingen).

## Gratis databronnen

| Bron | Land | Levert | Beschikbaarheid |
|---|---|---|---|
| [telenet.tv](https://www.telenet.be) EPG-service (publiek) | België | VRT 1/Canvas/Ketnet, VTM 1–4, Play 4–7, Play Sports, DAZN | meestal 5+ dagen, incl. omschrijvingen, genres, afbeeldingen en seizoen/episode |
| [tvgids.nl](https://www.tvgids.nl) (publiek) | Nederland | NPO 1–3, RTL 4/5/7/8, SBS6, Net5, Veronica | ~5 dagen, incl. omschrijvingen en afbeeldingen |
| XMLTV-import (optioneel) | eigen | elke XMLTV-feed | afhankelijk van de feed |

De adapters zitten in `src/lib/sources/`. Afbeeldingen worden lokaal niet opgeslagen; er wordt direct verwezen naar de CDN's van de bronnen.

## Installatie & gebruik

```bash
npm install
npm run seed       # zender-catalogus + logo's (data/channels.json)
npm run import     # EPG ophalen (vandaag + 5 dagen)
npm run dev        # development
```

Productie:

```bash
npm run build
npm start          # node dist/server/entry.mjs op http://localhost:4321
```

Bij een lege `data/`-map start de server bij de eerste request automatisch een EPG-import
(uit te schakelen met `AUTO_UPDATE=false`; interval via `AUTO_UPDATE_INTERVAL`, standaard 6 uur).

### CLI-import

```bash
npm run import -- --start 2026-08-01 --days 1   # specifieke datum
npm run import -- --channels npo1,play4          # alleen deze zenders
```

### Data

JSON-bestanden in `data/` (git-ignored):
- `channels.json` — zendercatalogus met bronconfiguratie en logo's
- `epg/{zender}/{datum}.json` — programma's per zender per dag
- `sport/{datum}.json` — sportevenementen (afgeleid uit de sportkanalen)
- `status.json` — beschikbaarheid per bron/zender
- `log.jsonl` — append-only updatelogboek

## Techniek

- [Astro](https://astro.build) 6 + `@astrojs/node` (standalone) + React 19 + TypeScript.
- Bestandsgebaseerde JSON-"database" (geen externe DB) zodat het gratis draait op elke Node-host.
- PWA: `public/manifest.webmanifest`, `public/sw.js` (offline shell + caching), iconen gegenereerd via `npm run gen-icons`.

```bash
npm run typecheck   # tsc --noEmit
npm run build       # productie-build (start)
```

## Bekende beperkingen

- tvgids.nl levert voor "vandaag" geen gedateerde URL (`/gids/{datum}/npo1` → 404); de adapter gebruikt dan de datumloze URL. Automatisch afgehandeld.
- "Geen uitzending"-vullers van Telenet (zender buiten uitzenduren) worden getoond zoals de bron ze levert.
- Beschikbaarheid van dagen verschilt per bron; de app geeft duidelijke waarschuwingen als een datum/zender geen gegevens heeft.
