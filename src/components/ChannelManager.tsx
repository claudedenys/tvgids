import { useEffect, useMemo, useState } from 'react';
import type { ChannelWithStatus } from '../lib/types';

const BASE = (import.meta.env.BASE_URL || '/').replace(/\/?$/, '/');
const SEL_KEY = 'tvgids.selected';
const FAV_KEY = 'tvgids.favs';

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* negeer */
  }
}

const GROUP_LABELS: Record<string, string> = {
  belgie: 'België',
  nederland: 'Nederland',
  sport: 'Sport',
  overig: 'Overig',
};

export default function ChannelManager() {
  const [channels, setChannels] = useState<ChannelWithStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string[]>(() => load(SEL_KEY, []));
  const [favs, setFavs] = useState<string[]>(() => load(FAV_KEY, []));
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'order' | 'name'>('order');
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  useEffect(() => {
    fetch(`${BASE}data/channels.json`)
      .then((r) => r.json())
      .then((d: ChannelWithStatus[]) => {
        setChannels(d);
        if (load<string[]>(SEL_KEY, []).length === 0) {
          const all = d.filter((c) => c.active).map((c) => c.id);
          setSelected(all);
          save(SEL_KEY, all);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => save(SEL_KEY, selected), [selected]);
  useEffect(() => save(FAV_KEY, favs), [favs]);

  const ordered = useMemo(() => {
    const orderMap = new Map(selected.map((id, i) => [id, i]));
    const sorted = [...channels].sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name, 'nl');
      const ia = orderMap.get(a.id);
      const ib = orderMap.get(b.id);
      if (ia === undefined && ib === undefined) return a.name.localeCompare(b.name, 'nl');
      if (ia === undefined) return 1;
      if (ib === undefined) return -1;
      return ia - ib;
    });
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      return sorted.filter((c) => c.name.toLowerCase().includes(q) || (c.country || '').toLowerCase().includes(q));
    }
    return sorted;
  }, [channels, selected, query, sort]);

  const grouped = useMemo(() => {
    const g = new Map<string, ChannelWithStatus[]>();
    for (const c of ordered) {
      const arr = g.get(c.group) ?? [];
      arr.push(c);
      g.set(c.group, arr);
    }
    return g;
  }, [ordered]);

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function move(id: string, dir: -1 | 1) {
    setSelected((prev) => {
      const i = prev.indexOf(id);
      if (i === -1) return prev;
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  function onDrop(targetId: string) {
    if (dragIdx === null) return;
    setSelected((prev) => {
      const srcId = prev[dragIdx];
      if (!srcId) return prev;
      const next = prev.filter((x) => x !== srcId);
      const ti = next.indexOf(targetId);
      next.splice(ti === -1 ? next.length : ti, 0, srcId);
      return next;
    });
    setDragIdx(null);
  }

  function toggleFav(id: string) {
    setFavs((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  const selectedCount = selected.length;

  if (loading) return <div className="spinner" />;

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
        <input
          className="input"
          placeholder="Zoek zender…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ flex: 1, minWidth: 180 }}
        />
        <select className="select" value={sort} onChange={(e) => setSort(e.target.value as 'order' | 'name')}>
          <option value="order">Mijn volgorde</option>
          <option value="name">Naam</option>
        </select>
        <button className="btn" onClick={() => setSelected(channels.filter((c) => c.active).map((c) => c.id))}>Alles aan</button>
        <button className="btn" onClick={() => setSelected([])}>Alles uit</button>
        <span style={{ color: 'var(--muted)', fontSize: 13 }}>{selectedCount} actief</span>
      </div>

      {[...grouped.entries()].map(([group, list]) => (
        <section key={group} className="ch-group">
          <h2>
            {GROUP_LABELS[group] ?? group}
            <span className="count">{list.filter((c) => selected.includes(c.id)).length}/{list.length}</span>
          </h2>
          <div className="ch-list">
            {list.map((c) => {
              const on = selected.includes(c.id);
              const fav = favs.includes(c.id);
              return (
                <div
                  key={c.id}
                  className={`ch-row ${on ? '' : 'off'}`}
                  draggable
                  onDragStart={() => setDragIdx(selected.indexOf(c.id))}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => onDrop(c.id)}
                >
                  <span className="drag" title="Versleep om te sorteren">⠿</span>
                  <img
                    className="logo"
                    src={`${BASE}icons/channels/${c.id}.svg`}
                    alt=""
                    onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
                  />
                  <div className="info">
                    <div className="nm">{c.name}</div>
                    <div className="sub">
                      <span>{c.country === 'BE' ? '🇧🇪' : c.country === 'NL' ? '🇳🇱' : c.country}</span>
                      <span className={c.status.epgAvailable ? 'badge-ok' : 'badge-warn'}>
                        {c.status.epgAvailable ? `EPG ${c.status.daysAvailable}d` : 'geen EPG'}
                      </span>
                    </div>
                  </div>
                  <button
                    className={`star ${fav ? 'on' : ''}`}
                    onClick={() => toggleFav(c.id)}
                    aria-label="Favoriet"
                    title="Favoriet"
                  >
                    ★
                  </button>
                  <button className="icon-btn" onClick={() => move(c.id, -1)} aria-label="Omhoog">↑</button>
                  <button className="icon-btn" onClick={() => move(c.id, 1)} aria-label="Omlaag">↓</button>
                  <div className={`toggle ${on ? 'on' : ''}`} onClick={() => toggle(c.id)} role="switch" aria-checked={on} />
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
