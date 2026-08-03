import { useEffect, useState } from 'react';
import type { ChannelStatus, SourceStatus, LogEntry } from '../lib/types';

interface StatusData {
  now: string;
  channels: number;
  activeChannels: number;
  sources: Record<string, SourceStatus>;
  channelStatus: Record<string, ChannelStatus>;
  totals: Record<string, number>;
  missingDescriptions: Record<string, number>;
  log: LogEntry[];
  dataDir: string;
}

interface ChannelsData {
  id: string;
  name: string;
  country: string;
  group: string;
  sources: { source: string; site_id: string; xmltv_id: string }[];
  active: boolean;
}

function fmt(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('nl-BE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export default function AdminPanel() {
  const [status, setStatus] = useState<StatusData | null>(null);
  const [channels, setChannels] = useState<ChannelsData[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  function load() {
    setLoading(true);
    Promise.all([fetch('/api/status').then((r) => r.json()), fetch('/api/channels').then((r) => r.json())])
      .then(([s, c]) => {
        setStatus(s as StatusData);
        setChannels(c as ChannelsData[]);
      })
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function runImport() {
    setImporting(true);
    setMsg(null);
    try {
      const r = await fetch('/api/update', { method: 'POST' });
      const d = await r.json();
      setMsg(r.ok ? d.message ?? 'Import gestart.' : d.error ?? 'Mislukt.');
      setTimeout(load, 1500);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setImporting(false);
    }
  }

  if (loading) return <div className="spinner" />;

  const sources = Object.values(status?.sources ?? {});
  const totalProgrammes = Object.values(status?.totals ?? {}).reduce((a, b) => a + b, 0);
  const totalMissing = Object.values(status?.missingDescriptions ?? {}).reduce((a, b) => a + b, 0);

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <button className="btn btn-primary" onClick={runImport} disabled={importing}>
          {importing ? 'Bezig…' : '↻ Import nu'}
        </button>
        <button className="btn" onClick={load}>Ververs</button>
        {msg && <span style={{ color: 'var(--accent)', fontSize: 13, alignSelf: 'center' }}>{msg}</span>}
      </div>

      <div className="stat-grid">
        <div className="stat-card"><div className="k">Zenders</div><div className="v">{status?.activeChannels}/{status?.channels}</div></div>
        <div className="stat-card"><div className="k">Programma's</div><div className="v">{totalProgrammes}</div></div>
        <div className="stat-card"><div className="k">Zonder omschrijving</div><div className="v">{totalMissing}</div></div>
        <div className="stat-card"><div className="k">Laatste check</div><div className="v" style={{ fontSize: 14 }}>{fmt(status?.now ?? null)}</div></div>
      </div>

      <h2 className="page-title" style={{ fontSize: 16, margin: '18px 0 8px' }}>EPG-bronnen</h2>
      <div className="table-wrap">
        <table className="grid">
          <thead>
            <tr><th>Bron</th><th>Status</th><th>Laatste update</th><th>Zenders</th><th>Programma's</th><th>Dagen</th><th>Fout</th></tr>
          </thead>
          <tbody>
            {sources.map((s) => (
              <tr key={s.source}>
                <td>{s.source}</td>
                <td className={s.ok ? 'badge-ok' : 'badge-err'}>{s.ok ? 'OK' : 'fout'}</td>
                <td>{fmt(s.lastUpdate)}</td>
                <td>{s.channels}</td>
                <td>{s.programmes}</td>
                <td>{s.days}</td>
                <td>{s.lastError ? <span className="badge-err">{s.lastError}</span> : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="page-title" style={{ fontSize: 16, margin: '18px 0 8px' }}>Per zender</h2>
      <div className="table-wrap">
        <table className="grid">
          <thead>
            <tr>
              <th>Zender</th><th>Land</th><th>Bron</th><th>site_id</th><th>xmltv_id</th>
              <th>Gratis</th><th>Dagen EPG</th><th>Laatste update</th><th>Omschrijving</th><th>Programma's</th>
            </tr>
          </thead>
          <tbody>
            {channels.map((c) => {
              const st = status?.channelStatus[c.id];
              const src = c.sources[0];
              return (
                <tr key={c.id} style={{ opacity: c.active ? 1 : 0.5 }}>
                  <td>{c.name}</td>
                  <td>{c.country}</td>
                  <td>{src?.source}</td>
                  <td><code>{src?.site_id}</code></td>
                  <td><code>{src?.xmltv_id || '—'}</code></td>
                  <td className="badge-ok">ja</td>
                  <td>{st?.daysAvailable ?? 0}</td>
                  <td>{fmt(st?.lastUpdate ?? null)}</td>
                  <td className={st?.descriptionAvailable ? 'badge-ok' : 'badge-warn'}>
                    {st?.descriptionAvailable ? 'ja' : 'nee'}
                  </td>
                  <td>{st?.programmesCount ?? 0}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h2 className="page-title" style={{ fontSize: 16, margin: '18px 0 8px' }}>Logboek</h2>
      <div className="table-wrap">
        <table className="grid">
          <thead><tr><th>Tijd</th><th>Niveau</th><th>Bron</th><th>Bericht</th></tr></thead>
          <tbody>
            {[...(status?.log ?? [])].reverse().slice(0, 40).map((l, i) => (
              <tr key={i}>
                <td>{fmt(l.ts)}</td>
                <td className={l.level === 'error' ? 'badge-err' : l.level === 'warn' ? 'badge-warn' : ''}>{l.level}</td>
                <td>{l.source}</td>
                <td>{l.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p style={{ color: 'var(--muted)', fontSize: 12 }}>
        Data-map: <code>{status?.dataDir}</code>. Automatische updates: dagelijks (in productie elke 6 uur, zie
        <code> src/lib/schedule.ts</code>). De importer houdt vorige gegevens bij als een bron tijdelijk niet bereikbaar is.
      </p>
    </div>
  );
}
