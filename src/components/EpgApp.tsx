import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChannelWithStatus, EpgResponse, Programme, SearchHit, SportEvent } from '../lib/types';
import { brusselsDateKey, brusselsDayStart } from '../lib/normalise';
import { filterSearchIndex, airingsForTitle } from '../lib/match';
import { downloadJSON, readJSONFile } from '../lib/sync';

const TZ = 'Europe/Brussels';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const STORAGE_KEY = 'tvgids.selected';
const WATCH_KEY = 'tvgids.watchlist';
const GOLD_KEY = 'tvgids.goldline';
const GOLD_HIT = 22;
const BASE = (import.meta.env.BASE_URL || '/').replace(/\/?$/, '/');

const SPORT_ICONS: Record<string, string> = {
  Voetbal: '⚽',
  Wielrennen: '🚴',
  Tennis: '🎾',
  Basketbal: '🏀',
  Golf: '⛳',
  Motorsport: '🏎️',
  Volleybal: '🏐',
  Handbal: '🤾',
  Hockey: '🏒',
  Rugby: '🏉',
  Darts: '🎯',
  Biljart: '🎱',
  Boksen: '🥊',
  Vechtsport: '🥋',
  Atletiek: '🏃',
  Padel: '🏓',
  Korfbal: '🏐',
  Paardensport: '🐎',
};

/** Zoekindex per dag cachen (per-dag bestanden; geen 2,8 MB monolith meer). */
const searchDayCache = new Map<string, Promise<SearchHit[]>>();
function loadSearchDay(date: string): Promise<SearchHit[]> {
  let p = searchDayCache.get(date);
  if (!p) {
    p = fetch(`${BASE}data/search/${date}.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<SearchHit[]>;
      })
      .catch((e) => {
        searchDayCache.delete(date);
        throw e;
      });
    searchDayCache.set(date, p);
  }
  return p;
}

/** Zoekindex over alle beschikbare dagen (voor "Alle dagen"-tab en kijklijst). */
function loadSearchAll(dates: string[]): Promise<SearchHit[]> {
  return Promise.all(dates.map(loadSearchDay)).then((parts) => parts.flat());
}

/** Kijklijst: één item per programmatitel (alle afleveringen samen). */
interface WatchEntry {
  title: string;
  savedAt: number;
  first: {
    id: string;
    type: 'programme' | 'sport';
    date: string;
    channelId: string;
    channelName: string;
    start: number;
    end: number;
    description: string | null;
    category: string[];
    image: string | null;
  };
}

function normTitle(t: string): string {
  return t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

interface TooltipState {
  prog: Programme;
  mx: number;
  my: number;
}

const timeFmt = new Intl.DateTimeFormat('nl-BE', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: TZ });
const dateLongFmt = new Intl.DateTimeFormat('nl-BE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ });
const dateShortFmt = new Intl.DateTimeFormat('nl-BE', { weekday: 'short', day: 'numeric', month: 'short', timeZone: TZ });

function fmtTime(ms: number): string {
  return timeFmt.format(ms);
}

function addDays(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d) + n * DAY);
  return brusselsDateKey(dt);
}

function loadSelected(): string[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const arr = JSON.parse(raw);
    return Array.isArray(arr) && arr.every((x) => typeof x === 'string') ? arr : null;
  } catch {
    return null;
  }
}

function loadGoldTime(): number | null {
  try {
    const raw = localStorage.getItem(GOLD_KEY);
    if (raw == null) return null;
    const v = parseInt(raw, 10);
    return Number.isFinite(v) ? Math.min(Math.max(0, v), 24 * HOUR) : null;
  } catch {
    return null;
  }
}

const SPORT_IDS = new Set([
  'playsports1', 'playsports2', 'playsports3', 'playsports4', 'playsports-premierleague',
  'playsports-golf', 'playsports-open', 'dazn1', 'dazn2', 'dazn3', 'dazn-jpl1', 'dazn-jpl2', 'dazn-jpl3',
]);

export default function EpgApp() {
  const todayKey = useMemo(() => brusselsDateKey(new Date()), []);
  const [date, setDate] = useState(todayKey);
  const [selected, setSelected] = useState<string[]>(() => loadSelected() ?? []);
  const [data, setData] = useState<EpgResponse | null>(null);
  const [channelsData, setChannelsData] = useState<ChannelWithStatus[] | null>(null);
  const [metaDates, setMetaDates] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [mounted, setMounted] = useState(false);
  const [hover, setHover] = useState<TooltipState | null>(null);
  const [sheet, setSheet] = useState<Programme | SportEvent | null>(null);
  const [pph, setPph] = useState(160);
  const [query, setQuery] = useState('');
  const [searchTab, setSearchTab] = useState<'day' | 'all'>('day');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchHit[]>([]);
  const [sportPanelOpen, setSportPanelOpen] = useState(false);
  const [sportOnly, setSportOnly] = useState(false);
  const [goldTimeOfDay, setGoldTimeOfDay] = useState<number>(() => {
    const stored = loadGoldTime();
    if (stored != null) return stored;
    const t = Date.now() - brusselsDayStart(brusselsDateKey(new Date()));
    return Math.min(Math.max(0, t), 24 * HOUR - 1);
  });
  const [watchlist, setWatchlist] = useState<WatchEntry[]>(() => {
    try {
      const raw = localStorage.getItem(WATCH_KEY);
      const arr: unknown = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? (arr as WatchEntry[]) : [];
    } catch {
      return [];
    }
  });
  const [watchOpen, setWatchOpen] = useState(false);
  const [watchAirings, setWatchAirings] = useState<Record<string, SearchHit[]>>({});
  const [watchLoading, setWatchLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const watchTitles = useMemo(() => new Set(watchlist.map((w) => normTitle(w.title))), [watchlist]);

  function toggleWatch(title: string, airing: WatchEntry['first']) {
    setWatchlist((prev) => {
      const k = normTitle(title);
      const exists = prev.some((w) => normTitle(w.title) === k);
      return exists ? prev.filter((w) => normTitle(w.title) !== k) : [...prev, { title, savedAt: Date.now(), first: airing }];
    });
  }

  function removeFromWatch(title: string) {
    setWatchlist((prev) => prev.filter((w) => normTitle(w.title) !== normTitle(title)));
  }

  // Kijklijstpersistentie.
  useEffect(() => {
    try {
      localStorage.setItem(WATCH_KEY, JSON.stringify(watchlist));
    } catch {
      /* negeer */
    }
  }, [watchlist]);

  // Bij openen van de kijklijst alle uitzendingen per titel ophalen (client-zijde).
  useEffect(() => {
    if (!watchOpen || watchlist.length === 0) return;
    let cancelled = false;
    setWatchLoading(true);
    const dates = metaDates ?? data?.availableDates ?? [];
    loadSearchAll(dates)
      .then((index) => {
        if (cancelled) return;
        const pairs = watchlist.map((w) => [w.title, airingsForTitle(index, w.title)] as const);
        setWatchAirings(Object.fromEntries(pairs));
      })
      .catch(() => {
        if (!cancelled) setWatchAirings({});
      })
      .finally(() => {
        if (!cancelled) setWatchLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [watchOpen, watchlist]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const pendingScroll = useRef(false);
  const pendingOpen = useRef<SearchHit | null>(null);
  const lastManualScroll = useRef(0);

  // Handmatig scrollen bijhouden (voor het volgen van de NU-lijn).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      lastManualScroll.current = Date.now();
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // Responsieve pixels-per-uur.
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)');
    const lq = window.matchMedia('(max-height: 480px)');
    const apply = () => {
      if (mq.matches) setPph(110);
      else if (lq.matches) setPph(130);
      else setPph(160);
    };
    apply();
    mq.addEventListener('change', apply);
    lq.addEventListener('change', apply);
    return () => {
      mq.removeEventListener('change', apply);
      lq.removeEventListener('change', apply);
    };
  }, []);

  // Meta + zenders los laden (dagbestanden bevatten geen channels meer).
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch(`${BASE}data/meta.json`).then((r) => (r.ok ? r.json() : null)),
      fetch(`${BASE}data/channels.json`).then((r) => (r.ok ? (r.json() as Promise<ChannelWithStatus[]>) : Promise.resolve([]))),
    ])
      .then(([meta, chans]) => {
        if (cancelled) return;
        if (meta && Array.isArray(meta.availableDates)) setMetaDates(meta.availableDates as string[]);
        setChannelsData(chans);
      })
      .catch(() => {
        /* dagbestanden blijven als fallback werken */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Data ophalen (statische JSON per dag).
  useEffect(() => {
    let cancelled = false;
    const hasPref = loadSelected() !== null;
    setLoading(true);
    setError(null);
    fetch(`${BASE}data/epg/${date}.json`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const d = (await r.json()) as EpgResponse;
        if (cancelled) return;
        setData(d);
        if (date === todayKey) pendingScroll.current = true;
        setSelected((prev) => {
          if (hasPref || prev.length) return prev;
          // nog geen voorkeur → alle actieve zenders, en bewaar als standaard
          const all = (channelsData ?? d.channels).map((c) => c.id);
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
          } catch {
            /* negeer */
          }
          return all;
        });
        // Navigatie vanuit zoekresultaten: open het gevonden programma.
        if (pendingOpen.current) {
          const hit = pendingOpen.current;
          pendingOpen.current = null;
          requestAnimationFrame(() => {
            const el = document.getElementById(`prog-${hit.id}`);
            if (el) el.scrollIntoView({ inline: 'center', block: 'nearest' });
            setSheet(hitToSheet(hit, channelLookup));
          });
        }
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [date]);

  // Zoeken (gedebounced) in de gids-topbar — client-zijde over de statische index.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }
    setSearchLoading(true);
    const dates = metaDates ?? data?.availableDates ?? [date];
    const timer = setTimeout(() => {
      const loader = searchTab === 'day' ? loadSearchDay(date) : loadSearchAll(dates);
      loader
        .then((index) => {
          setSearchResults(filterSearchIndex(index, q, searchTab === 'day' ? date : undefined));
        })
        .catch(() => setSearchResults([]))
        .finally(() => setSearchLoading(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [query, searchTab, date, metaDates, data]);

  // Klok en NU-lijn bijwerken.
  useEffect(() => {
    setMounted(true);
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const lastNowRef = useRef(Date.now());

  // Toast automatisch sluiten.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(t);
  }, [toast]);

  // Hou de rode NU-lijn gecentreerd zolang die in beeld is (en de gebruiker niet scrolt).
  useEffect(() => {
    if (!mounted) return;
    recenterNowIfVisible();
  }, [now]);

  // Gouden lijnpositie onthouden.
  useEffect(() => {
    try {
      localStorage.setItem(GOLD_KEY, String(goldTimeOfDay));
    } catch {
      /* negeer */
    }
  }, [goldTimeOfDay]);

  // Scroll naar 'nu' na dataload.
  useEffect(() => {
    if (loading || !data) return;
    if (pendingScroll.current) {
      pendingScroll.current = false;
      doScrollNow();
    }
  }, [loading, data, pph]);

  const dayStart = useMemo(() => brusselsDayStart(date), [date]);
  const channels = channelsData ?? data?.channels ?? [];
  const channelLookup = useMemo(() => new Map(channels.map((c) => [c.id, c])), [channels]);
  const goldTime = useMemo(() => dayStart + goldTimeOfDay, [dayStart, goldTimeOfDay]);

  // Melding zodra de rode NU-lijn de gouden lijn bereikt.
  useEffect(() => {
    if (date !== todayKey) return;
    const prev = lastNowRef.current;
    lastNowRef.current = now;
    if (prev < goldTime && now >= goldTime) {
      const msg = `De NU-lijn bereikt de gouden lijn (${fmtTime(goldTime)})`;
      setToast(msg);
      try {
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification('TV Gids', { body: msg });
        }
      } catch {
        /* negeer */
      }
    }
  }, [now, date, goldTime, todayKey]);

  const visibleChannels = useMemo(() => {
    const base = sportOnly ? channels.filter((c) => c.group === 'sport' || SPORT_IDS.has(c.id)) : channels;
    const order = selected.length ? selected : base.map((c) => c.id);
    const map = new Map(base.map((c) => [c.id, c]));
    return order.map((id) => map.get(id)).filter((c): c is ChannelWithStatus => Boolean(c));
  }, [channels, selected, sportOnly]);

  const programmesByChannel = useMemo(() => {
    const m = new Map<string, Programme[]>();
    for (const p of data?.programmes ?? []) {
      const arr = m.get(p.channel) ?? [];
      arr.push(p);
      m.set(p.channel, arr);
    }
    return m;
  }, [data]);

  const sportStarts = useMemo(() => {
    const s = new Set<string>();
    for (const e of data?.sport ?? []) s.add(`${e.start}:${e.channels[0] ?? ''}`);
    return s;
  }, [data]);

  const nowOffset = (now - dayStart) / HOUR * pph;
  const showNowLine = date === todayKey && nowOffset >= 0 && nowOffset <= 24 * pph;

  const hasData = (data?.programmes.length ?? 0) > 0;

  // Markeer gevonden programma's in de tijdlijn (alleen bij "deze dag").
  const matchIds = useMemo(() => {
    if (searchTab !== 'day' || query.trim().length < 2) return null;
    const s = new Set<string>();
    for (const h of searchResults) if (h.type === 'programme' && h.date === date) s.add(h.id);
    return s;
  }, [searchResults, searchTab, query, date]);

  function doScrollNow() {
    const el = scrollRef.current;
    if (!el) return;
    const channelCol = parseFloat(getComputedStyle(el).getPropertyValue('--channel-col')) || 128;
    const target = channelCol + nowOffset - el.clientWidth * 0.5;
    el.scrollTo({ left: Math.max(0, target), top: 0, behavior: 'smooth' });
  }

  // Centreer de rode NU-lijn als die in beeld is en de gebruiker niet handmatig scrolt.
  function recenterNowIfVisible() {
    if (date !== todayKey) return;
    const el = scrollRef.current;
    if (!el) return;
    if (Date.now() - lastManualScroll.current < 15000) return;
    const channelCol = parseFloat(getComputedStyle(el).getPropertyValue('--channel-col')) || 128;
    const off = ((Date.now() - dayStart) / HOUR) * pph;
    if (off < 0 || off > 24 * pph) return;
    const contentX = channelCol + off;
    if (contentX < el.scrollLeft - 60 || contentX > el.scrollLeft + el.clientWidth + 60) return;
    el.scrollTo({ left: Math.max(0, contentX - el.clientWidth * 0.5), top: 0, behavior: 'smooth' });
  }

  function goToNow() {
    if (date !== todayKey) {
      pendingScroll.current = true;
      setDate(todayKey);
    } else {
      doScrollNow();
    }
  }

  function goPrev() { setDate(addDays(date, -1)); }
  function goNext() { setDate(addDays(date, 1)); }

  function goldPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* negeer */
    }
    // Delta-gebaseerd: de lijn volgt de vinger exact, onafhankelijk van
    // horizontale scroll en de breedte van de kanaalkolom.
    const startX = e.clientX;
    const startTime = goldTimeOfDay;
    const move = (ev: PointerEvent) => {
      const t = startTime + ((ev.clientX - startX) / pph) * HOUR;
      setGoldTimeOfDay(Math.min(Math.max(0, t), 24 * HOUR - 1));
    };
    const end = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }

  function openHit(hit: SearchHit) {
    setSearchOpen(false);
    if (hit.date !== date) {
      pendingOpen.current = hit;
      setDate(hit.date);
      return;
    }
    const el = document.getElementById(`prog-${hit.id}`);
    if (el) el.scrollIntoView({ inline: 'center', behavior: 'smooth', block: 'nearest' });
    setSheet(hitToSheet(hit, channelLookup));
  }

  /** Bouw een kijklijst-item uit het geopende programma/sportevent. */
  function airingFromSheet(): WatchEntry['first'] | null {
    if (!sheet) return null;
    const isSport = 'channels' in sheet;
    const ev = isSport ? (sheet as SportEvent) : null;
    const p = sheet as Programme;
    const evChannelId = ev?.channelIds?.[0] ?? ev?.channels[0] ?? '';
    const evChannel = ev ? channels.find((c) => c.id === evChannelId) : undefined;
    const channel = !ev && p.channel ? channels.find((c) => c.id === p.channel) : undefined;
    if (ev) {
      return {
        id: ev.id,
        type: 'sport' as const,
        date: brusselsDateKey(ev.start),
        channelId: evChannelId,
        channelName: evChannel?.name ?? ev.channels[0] ?? '',
        start: ev.start,
        end: ev.end,
        description: ev.description,
        category: [],
        image: null,
      };
    }
    return {
      id: p.id,
      type: 'programme' as const,
      date: brusselsDateKey(p.start),
      channelId: p.channel,
      channelName: channel?.name ?? '',
      start: p.start,
      end: p.end,
      description: p.description,
      category: p.category,
      image: p.image,
    };
  }

  function openWatchAiring(h: SearchHit) {
    setWatchOpen(false);
    openHit(h);
  }

  function importWatchlist(entries: WatchEntry[] | null, error?: string) {
    if (error || !entries) {
      setToast(error ?? 'Importeren mislukt');
      return;
    }
    setWatchlist(entries);
    setToast(`Kijklijst geïmporteerd (${entries.length} ${entries.length === 1 ? 'titel' : 'titels'})`);
  }

  const hours = useMemo(() => Array.from({ length: 24 }, (_, i) => i), []);

  return (
    <div className="epg-page">
      {toast && <div className="epg-toast">{toast}</div>}
      <div className="epg-topbar">
        <div className="epg-date-nav">
          <button className="icon-btn" onClick={goPrev} aria-label="Vorige dag">‹</button>
          <span className="epg-date-label">
            <span className="weekday">{capitalize(dateLongFmt.format(dayStart).split(' ')[0])}</span>{' '}
            {dateLongFmt.format(dayStart).split(' ').slice(1).join(' ')}
          </span>
          <button className="icon-btn" onClick={goNext} aria-label="Volgende dag">›</button>
          <button className="btn hide-sm hide-landscape" onClick={() => setDate(todayKey)}>Vandaag</button>
          <button className="btn hide-sm hide-landscape" onClick={() => setDate(addDays(todayKey, 1))}>Morgen</button>
          <input
            type="date"
            className="input hide-landscape"
            value={date}
            min={metaDates?.[0] ?? data?.availableDates[0] ?? addDays(todayKey, -1)}
            max={metaDates?.[metaDates.length - 1] ?? data?.availableDates[data.availableDates.length - 1] ?? addDays(todayKey, 7)}
            onChange={(e) => e.target.value && setDate(e.target.value)}
          />
          <button className="btn epg-now-btn" onClick={goToNow}>● Nu</button>
        </div>
        <button className="btn sport-panel-btn" onClick={() => setSportPanelOpen(true)} aria-label="Sportoverzicht">
          ⚽ Sport
        </button>
        <button
          className={'btn sport-only-btn' + (sportOnly ? ' on' : '')}
          onClick={() => setSportOnly((v) => !v)}
          aria-pressed={sportOnly}
          title={sportOnly ? 'Toon alle zenders' : 'Toon enkel sportzenders'}
        >
          🏆 Sport-only
        </button>
        <button className="btn watch-btn" onClick={() => setWatchOpen(true)} aria-label="Mijn kijklijst">
          ★<span className="watch-label hide-sm"> Mijn kijklijst</span>
          {watchlist.length > 0 && <span className="watch-count">{watchlist.length}</span>}
        </button>
        <div
          className="epg-search"
          onFocus={() => setSearchOpen(true)}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget)) setSearchOpen(false);
          }}
        >
          <input
            type="search"
            className="input search-input"
            placeholder="Zoek programma of sport… bv. koers"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
          {searchOpen && (
            <div className="search-pop">
              <div className="search-chips">
                {[['Voetbal', 'voetbal'], ['Wielrennen', 'koers'], ['Tennis', 'tennis'], ['F1', 'formule 1']].map(([label, term]) => (
                  <button
                    key={term}
                    className={'chip' + (query.trim() === term ? ' active' : '')}
                    onClick={() => {
                      setQuery(term);
                      setSearchTab('day');
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {query.trim().length >= 2 ? (
                <>
                  <div className="search-tabs">
                    <button className={searchTab === 'day' ? 'active' : ''} onClick={() => setSearchTab('day')}>Deze dag</button>
                    <button className={searchTab === 'all' ? 'active' : ''} onClick={() => setSearchTab('all')}>Alle dagen</button>
                  </div>
                  {searchLoading ? (
                    <div className="search-status">Zoeken…</div>
                  ) : searchResults.length === 0 ? (
                    <div className="search-status">Geen resultaten voor "{query.trim()}". Probeer bv. koers, voetbal of tennis.</div>
                  ) : (
                    <div className="search-list">
                      {searchResults.slice(0, 40).map((h) => (
                        <SearchRow
                          key={`${h.type}:${h.id}:${h.date}`}
                          hit={h}
                          saved={watchTitles.has(normTitle(h.title))}
                          onToggleSave={() =>
                            toggleWatch(h.title, {
                              id: h.id,
                              type: h.type,
                              date: h.date,
                              channelId: h.channelId,
                              channelName: h.channelName,
                              start: h.start,
                              end: h.end,
                              description: h.description,
                              category: h.category,
                              image: h.image,
                            })
                          }
                          onPick={openHit}
                        />
                      ))}
                      {searchResults.length > 40 && (
                        <div className="search-status">+ {searchResults.length - 40} meer</div>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <div className="search-status">Typ minstens 2 tekens, of kies een sportchip hierboven.</div>
              )}
            </div>
          )}
        </div>
        {loading && <span className="spinner" style={{ margin: '0 4px', width: 18, height: 18 }} />}
      </div>

      <div className="epg-scroll" ref={scrollRef} style={{ ['--pph' as string]: `${pph}px` }}>
        <div className="epg-canvas" ref={canvasRef}>
          <div className="epg-ruler">
            {hours.map((h) => (
              <div key={h} className="hour-line" style={{ left: h * pph }} />
            ))}
          </div>

          <div className="epg-header">
            <div className="epg-corner">Zenders</div>
            <div className="epg-hours">
              {hours.map((h) => (
                <div key={h} className="epg-hour" style={{ left: h * pph }}>
                  {String(h).padStart(2, '0')}:00
                </div>
              ))}
            </div>
          </div>

          {error && <div className="epg-empty">Fout bij laden: {error}</div>}
          {!error && loading && !data && <div className="epg-empty">Gegevens laden…</div>}
          {!error && data && !loading && !hasData && (
            <div className="epg-empty">
              Geen gegevens voor deze datum. Kies een andere dag of wacht tot de EPG wordt bijgewerkt.
            </div>
          )}

          {visibleChannels.map((ch, i) => (
            <ChannelRow
              key={ch.id}
              index={i}
              channel={ch}
              programmes={programmesByChannel.get(ch.id) ?? []}
              sportStarts={sportStarts}
              dayStart={dayStart}
              pph={pph}
              now={now}
              goldTime={goldTime}
              isSport={SPORT_IDS.has(ch.id)}
              matchIds={matchIds}
              watchTitles={watchTitles}
              onHover={setHover}
              onSelect={setSheet}
              onLeave={() => setHover(null)}
            />
          ))}

          {mounted && showNowLine && (
            <div className="epg-nowline" style={{ left: `calc(var(--channel-col) + ${nowOffset}px)` }}>
              <span className="label">{fmtTime(now)}</span>
            </div>
          )}

          {mounted && (
            <div
              className="epg-goldline"
              style={{ left: `calc(var(--channel-col) + ${(goldTimeOfDay / HOUR) * pph}px)` }}
              onPointerDown={goldPointerDown}
              title="Sleep om de gouden lijn te verschuiven"
            >
              <span className="grip" />
              <span className="label">{fmtTime(dayStart + goldTimeOfDay)}</span>
              <div className="hitline" />
            </div>
          )}
        </div>
      </div>

      {hover && !sheet && (
        <ProgrammeTooltip hover={hover} />
      )}

      {sheet && (
        <ProgrammeSheet
          prog={sheet}
          channel={
            'channel' in sheet
              ? channels.find((c) => c.id === sheet.channel)
              : channels.find((c) => c.id === (sheet.channelIds?.[0] ?? '')) || undefined
          }
          sport={
            'channel' in sheet
              ? data?.sport.find((s) => s.channels[0] === sheet.channel && s.start === sheet.start)
              : data?.sport.find((s) => s.start === sheet.start)
          }
          saved={watchTitles.has(normTitle(sheet.title))}
          onToggleSave={() => {
            const a = airingFromSheet();
            if (a) toggleWatch(sheet.title, a);
          }}
          onClose={() => setSheet(null)}
        />
      )}

      {watchOpen && (
        <WatchlistPanel
          entries={watchlist}
          airings={watchAirings}
          loading={watchLoading}
          now={now}
          onPick={openWatchAiring}
          onRemove={removeFromWatch}
          onImport={importWatchlist}
          onClose={() => setWatchOpen(false)}
        />
      )}

      {sportPanelOpen && (
        <SportPanel
          date={date}
          events={data?.sport ?? []}
          now={now}
          onPick={(ev) => {
            setSportPanelOpen(false);
            setSheet(ev);
          }}
          onClose={() => setSportPanelOpen(false)}
        />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Rij                                                                 */
/* ---------------------------------------------------------------- */

function ChannelRow(props: {
  index: number;
  channel: ChannelWithStatus;
  programmes: Programme[];
  sportStarts: Set<string>;
  dayStart: number;
  pph: number;
  now: number;
  goldTime: number | null;
  isSport: boolean;
  matchIds: Set<string> | null;
  watchTitles: Set<string>;
  onHover: (t: TooltipState) => void;
  onSelect: (p: Programme) => void;
  onLeave: () => void;
}) {
  const { index, channel, programmes, sportStarts, dayStart, pph, now, goldTime, isSport, matchIds, watchTitles, onHover, onSelect, onLeave } = props;
  const dayEnd = dayStart + DAY;

  const blocks = useMemo(() => {
    return programmes
      .filter((p) => p.end > dayStart && p.start < dayEnd)
      .map((p) => {
        let left = ((p.start - dayStart) / HOUR) * pph;
        let width = ((p.end - p.start) / HOUR) * pph;
        const clippedStart = left < 0;
        const clippedEnd = left + width > 24 * pph;
        if (clippedStart) {
          width = width + left;
          left = 0;
        }
        if (left + width > 24 * pph) width = 24 * pph - left;
        return { p, left, width, clippedStart, clippedEnd };
      });
  }, [programmes, dayStart, pph]);

  const isNow = (p: Programme) => now >= p.start && now < p.end;

  return (
    <div className={'epg-row' + (index % 2 === 1 ? ' alt' : '')}>
      <div className="epg-channel">
        <img
          className="logo"
          src={`${BASE}icons/channels/${channel.id}.svg`}
          alt={channel.name}
          loading="lazy"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none';
          }}
        />
        <span className="name">{channel.name}</span>
      </div>
      <div className="epg-grid">
        {blocks.map(({ p, left, width, clippedStart, clippedEnd }) => {
          const offair = /geen uitzending/i.test(p.title);
          const live = isNow(p);
          const gold = goldTime != null && p.start <= goldTime && goldTime < p.end;
          const saved = watchTitles.has(normTitle(p.title));
          const sport = sportStarts.has(`${p.start}:${p.channel}`) || (isSport && /\s[–—-]\s/.test(p.title));
          const cls = [
            'prog',
            live ? 'live' : '',
            gold ? 'gold' : '',
            sport ? 'sport' : '',
            offair ? 'offair' : '',
            saved ? 'saved' : '',
            matchIds?.has(p.id) ? 'prog-match' : '',
            clippedStart ? 'clipped-start' : '',
            clippedEnd ? 'clipped-end' : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <div
              key={p.id}
              id={`prog-${p.id}`}
              className={cls}
              style={{ left, width }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelect(p);
                }
              }}
              onMouseEnter={(e) => onHover({ prog: p, mx: e.clientX, my: e.clientY })}
              onMouseMove={(e) => onHover({ prog: p, mx: e.clientX, my: e.clientY })}
              onMouseLeave={onLeave}
              onClick={() => onSelect(p)}
            >
              <span className="t">{p.title}</span>
              {width > 110 && <span className="time">{fmtTime(p.start)} – {fmtTime(p.end)}</span>}
              {saved && <span className="saved-star" aria-hidden="true">★</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Tooltip                                                            */
/* ---------------------------------------------------------------- */

function ProgrammeTooltip({ hover }: { hover: TooltipState }) {
  const { prog, mx, my } = hover;
  const style: React.CSSProperties = { left: 0, top: 0 };
  const w = 260;
  const left = mx + 16 + w > window.innerWidth - 8 ? mx - 16 - w : mx + 16;
  const top = Math.min(Math.max(8, my + 14), window.innerHeight - 60);
  style.left = Math.max(8, left);
  style.top = top;
  return (
    <div className="tooltip" style={style}>
      {prog.image && <img src={prog.image} alt="" />}
      <h4>{prog.title}</h4>
      <div className="meta">
        <span>{fmtTime(prog.start)} – {fmtTime(prog.end)}</span>
        <span>{prog.channel}</span>
      </div>
      {prog.description ? (
        <p className="desc">{prog.description}</p>
      ) : (
        <p className="desc">Geen programmabeschrijving beschikbaar.</p>
      )}
      {prog.category.length > 0 && (
        <div className="tags">
          {prog.category.slice(0, 3).map((c) => <span key={c} className="tag">{c}</span>)}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Bottom sheet                                                       */
/* ---------------------------------------------------------------- */

function ProgrammeSheet(props: {
  prog: Programme | SportEvent;
  channel?: ChannelWithStatus;
  sport?: SportEvent;
  saved: boolean;
  onToggleSave: () => void;
  onClose: () => void;
}) {
  const { prog, channel, sport, saved, onToggleSave, onClose } = props;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  const p = prog as Programme;
  const isSport = Boolean(sport) || ('home' in prog && (prog as SportEvent).home);
  const ev = isSport ? (prog as SportEvent) : null;
  const category = Array.isArray(p.category) ? p.category : [];

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="grabber" />
        {p.image && <img className="hero" src={p.image} alt="" />}
        {isSport && (
          <div className="tags" style={{ marginBottom: 8 }}>
            <span className="tag sport">{SPORT_ICONS[ev?.sport ?? ''] ?? '⚽'} {ev?.sport ?? 'Sport'}</span>
            {ev?.competition && <span className="tag">{ev.competition}</span>}
          </div>
        )}
        <h3>{ev?.title ?? prog.title}</h3>
        <div className="sheet-meta">
          <span>🕒 {fmtTime(p.start)} – {fmtTime(p.end)}</span>
          {channel && <span>📺 {channel.name}</span>}
          {ev?.competition && <span>🏆 {ev.competition}</span>}
          {ev?.platforms && ev.platforms.length > 0 && <span>📡 {ev.platforms.join(' · ')}</span>}
          {ev && ev.status !== 'onbekend' && (
            <span>{ev.status === 'live' ? '● Live' : ev.status === 'aankomend' ? 'Aankomend' : 'Afgelopen'}</span>
          )}
        </div>
        {p.description ? (
          <p className="sheet-desc">{p.description}</p>
        ) : (
          <p className="sheet-desc"><span className="muted">Geen programmabeschrijving beschikbaar.</span></p>
        )}
        {category.length > 0 && (
          <div className="tags" style={{ marginBottom: 14 }}>
            {category.slice(0, 5).map((c) => <span key={c} className="tag">{c}</span>)}
          </div>
        )}
        <div className="sheet-actions">
          <button className="btn" onClick={onToggleSave} aria-pressed={saved}>
            <span className={'save-star' + (saved ? ' on' : '')}>{saved ? '★' : '☆'}</span>
            {saved ? 'In kijklijst' : 'Bewaar in kijklijst'}
          </button>
          <button className="btn btn-primary" onClick={onClose}>Sluiten</button>
          {channel?.website && <a className="btn" href={channel.website} target="_blank" rel="noreferrer">Naar {channel.name}</a>}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Kijklijst-paneel                                                    */
/* ---------------------------------------------------------------- */

function WatchlistPanel({
  entries,
  airings,
  loading,
  now,
  onPick,
  onRemove,
  onImport,
  onClose,
}: {
  entries: WatchEntry[];
  airings: Record<string, SearchHit[]>;
  loading: boolean;
  now: number;
  onPick: (h: SearchHit) => void;
  onRemove: (title: string) => void;
  onImport: (entries: WatchEntry[] | null, error?: string) => void;
  onClose: () => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  function exportList() {
    downloadJSON('tvgids-kijklijst.json', { app: 'tvgids', version: 1, entries });
  }

  async function importList(file: File) {
    try {
      const data = (await readJSONFile(file)) as { entries?: unknown };
      const raw = Array.isArray(data?.entries) ? (data.entries as unknown[]) : null;
      if (!raw) throw new Error('Ongeldig bestand: "entries" ontbreekt');
      const list = raw.filter(isWatchEntry);
      if (list.length === 0) throw new Error('Geen geldige kijklijst-items gevonden');
      onImport(list);
    } catch (e) {
      onImport(null, e instanceof Error ? e.message : 'Importeren mislukt');
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet watch-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Mijn kijklijst">
        <div className="grabber" />
        <h3>★ Mijn kijklijst</h3>
        <p className="sheet-desc muted" style={{ marginTop: 4 }}>
          Bewaarde programma's. Alle afleveringen in de gids worden gemarkeerd; één titel per item.
        </p>
        <div className="sheet-toolbar">
          <button className="btn" onClick={exportList}>Export</button>
          <button className="btn" onClick={() => fileRef.current?.click()}>Import</button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importList(f);
              e.currentTarget.value = '';
            }}
          />
        </div>
        {entries.length === 0 ? (
          <p className="sheet-desc" style={{ marginTop: 16 }}>
            Nog geen programma's bewaard. Tik in een programma of zoekresultaat op de ster.
          </p>
        ) : (
          <div className="watch-list">
            {loading && entries.length > 0 && <div className="search-status">Uitzendingen laden…</div>}
            {entries.map((w) => {
              const list = airings[normTitle(w.title)];
              const all: SearchHit[] = list && list.length ? list : [{ ...w.first, title: w.title }];
              const upcoming = all.filter((a) => a.end > now);
              const next = upcoming[0] ?? all[all.length - 1];
              const nextIsFuture = next ? next.end > now : false;
              return (
                <div className="watch-row" key={normTitle(w.title)}>
                  <span className="watch-star on">★</span>
                  <div className="watch-info">
                    <span className="watch-title">{w.title}</span>
                    <span className="watch-sub">
                      {next
                        ? `${nextIsFuture ? 'Volgende' : 'Laatste'}: ${capitalize(dateShortFmt.format(next.start))} · ${fmtTime(next.start)} · ${next.channelName}`
                        : 'Geen uitzending gevonden'}
                      {list && list.length > 1 ? ` · ${list.length} uitzendingen` : ''}
                    </span>
                  </div>
                  <button className="btn watch-jump" disabled={!next} onClick={() => next && onPick(next)}>
                    Spring
                  </button>
                  <button className="icon-btn" onClick={() => onRemove(w.title)} aria-label={`Verwijder ${w.title}`}>✕</button>
                </div>
              );
            })}
          </div>
        )}
        <div className="sheet-actions">
          <button className="btn btn-primary" onClick={onClose}>Sluiten</button>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Zoekresultaat                                                     */
/* ---------------------------------------------------------------- */

function isWatchEntry(x: unknown): x is WatchEntry {
  if (typeof x !== 'object' || x === null) return false;
  const o = x as Record<string, unknown>;
  const f = o.first as Record<string, unknown> | null;
  return (
    typeof o.title === 'string' &&
    o.title.length > 0 &&
    f !== null &&
    typeof f === 'object' &&
    typeof f.start === 'number' &&
    typeof f.end === 'number' &&
    typeof f.date === 'string' &&
    typeof f.channelId === 'string' &&
    typeof f.channelName === 'string'
  );
}

function SearchRow({
  hit,
  onPick,
  saved,
  onToggleSave,
}: {
  hit: SearchHit;
  onPick: (h: SearchHit) => void;
  saved: boolean;
  onToggleSave: () => void;
}) {
  const dateLabel = hit.date === brusselsDateKey(new Date()) ? 'Vandaag' : capitalize(dateLongFmt.format(new Date(brusselsDayStart(hit.date))).split(' ')[0]);
  return (
    <div
      className="search-row"
      role="button"
      tabIndex={0}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => onPick(hit)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onPick(hit);
        }
      }}
    >
      <span className="sr-time">{fmtTime(hit.start)}</span>
      <span className="sr-body">
        <span className="sr-title">
          {hit.type === 'sport' && <span className="sr-sport">⚽</span>}
          {hit.title}
        </span>
        {hit.description && <span className="sr-desc">{hit.description}</span>}
      </span>
      <span className="sr-meta">
        <span className="sr-chan">{hit.channelName}</span>
        <span className="sr-date">{dateLabel}</span>
      </span>
      <button
        className={'sr-star' + (saved ? ' on' : '')}
        onClick={(e) => {
          e.stopPropagation();
          onToggleSave();
        }}
        aria-pressed={saved}
        aria-label={saved ? `Verwijder ${hit.title} uit kijklijst` : `Voeg ${hit.title} toe aan kijklijst`}
      >
        {saved ? '★' : '☆'}
      </button>
    </div>
  );
}

/** Vertaal een zoekresultaat naar een object dat de bottom-sheet kan tonen. */
function hitToSheet(hit: SearchHit, channelLookup?: Map<string, ChannelWithStatus>): Programme | SportEvent {
  if (hit.type === 'sport') {
    const ids = hit.channelIds?.length ? hit.channelIds : [hit.channelId];
    const names = ids.map((id) => channelLookup?.get(id)?.name ?? hit.channelName).filter(Boolean) as string[];
    return {
      id: hit.id,
      externalId: null,
      title: hit.title,
      home: hit.home ?? null,
      away: hit.away ?? null,
      competition: hit.competition ?? null,
      start: hit.start,
      end: hit.end,
      status: hit.status ?? 'onbekend',
      platforms: hit.platforms ?? names,
      channels: names.length ? names : [hit.channelName],
      channelIds: ids,
      description: hit.description,
      sport: hit.sport ?? null,
      source: 'sport',
    };
  }
  return {
    id: hit.id,
    channel: hit.channelId,
    title: hit.title,
    start: hit.start,
    end: hit.end,
    description: hit.description,
    category: hit.category,
    image: hit.image,
    icon: null,
    source: 'telenet.tv',
    season: null,
    episode: null,
    actors: [],
    live: false,
  };
}

/* ---------------------------------------------------------------- */
/* Sportoverzicht                                                     */
/* ---------------------------------------------------------------- */

function SportPanel({
  date,
  events,
  now,
  onPick,
  onClose,
}: {
  date: string;
  events: SportEvent[];
  now: number;
  onPick: (e: SportEvent) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  const groups = useMemo(() => {
    const m = new Map<string, SportEvent[]>();
    for (const e of events) {
      const key = e.competition ?? 'Overig';
      const arr = m.get(key) ?? [];
      arr.push(e);
      m.set(key, arr);
    }
    const out = [...m.entries()]
      .map(([competition, evs]) => ({ competition, evs: evs.sort((a, b) => a.start - b.start) }))
      .sort((a, b) => (a.evs[0]?.start ?? 0) - (b.evs[0]?.start ?? 0));
    return out;
  }, [events]);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet sport-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="grabber" />
        <h3>⚽ Sport — {capitalize(dateLongFmt.format(brusselsDayStart(date)).split(' ')[0])} {dateLongFmt.format(brusselsDayStart(date)).split(' ').slice(1).join(' ')}</h3>
        {events.length === 0 ? (
          <p className="sheet-desc"><span className="muted">Geen sportevenementen voor deze dag.</span></p>
        ) : (
          groups.map((g) => (
            <div key={g.competition} className="sport-group">
              <div className="sport-group-title">{g.competition}</div>
              {g.evs.map((e) => {
                const live = e.status === 'live';
                const nowIdx = e.status === 'afgelopen';
                return (
                  <div key={e.id} className={'sport-item' + (nowIdx ? ' over' : '')} role="button" tabIndex={0} onClick={() => onPick(e)} onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onPick(e); } }}>
                    <span className="sport-item-time">{fmtTime(e.start)}</span>
                    <span className="sport-item-body">
                      <span className="sport-item-title">
                        {live && <span className="live-dot" title="Live" />}
                        {SPORT_ICONS[e.sport ?? ''] ?? '⚽'} {e.home || e.away ? `${e.home ?? ''} – ${e.away ?? ''}` : e.title}
                      </span>
                      <span className="sport-item-meta">{(e.platforms?.length ? e.platforms.join(' · ') : e.channels.join(' · '))}</span>
                    </span>
                    {live && <span className="sport-item-status">● Live</span>}
                  </div>
                );
              })}
            </div>
          ))
        )}
        <div className="sheet-actions">
          <button className="btn btn-primary" onClick={onClose}>Sluiten</button>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Helpers                                                            */
/* ---------------------------------------------------------------- */

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
