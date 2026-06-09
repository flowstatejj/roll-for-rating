import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { BELT_COLOR } from '../App';
import {
  currentLeagueWeek, generateLeagueWeek, getLeague, leagueFixtures, leagueMembers, leagueStandings, profilesByIds,
  WEEKDAYS, type League, type Standing,
} from '../lib/api';

export default function LeagueManager() {
  const { id } = useParams<{ id: string }>();
  const lid = id!;
  const [l, setL] = useState<League | null>(null);
  const [week, setWeek] = useState(1);
  const [fixtures, setFixtures] = useState<any[]>([]);
  const [standings, setStandings] = useState<Standing[]>([]);
  const [members, setMembers] = useState<any[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const lg = await getLeague(lid);
    setL(lg);
    const w = currentLeagueWeek(lg);
    setWeek(w);
    const [fx, st, mem] = await Promise.all([leagueFixtures(lid, w), leagueStandings(lid), leagueMembers(lid)]);
    setFixtures(fx); setStandings(st); setMembers(mem);
    const profs = await profilesByIds(st.map((s) => s.user_id!).filter(Boolean));
    const map: Record<string, string> = {};
    Object.values(profs).forEach((p) => (map[p.id] = p.display_name));
    setNames(map);
  }, [lid]);

  useEffect(() => { reload(); }, [reload]);

  async function gen() {
    setBusy(true);
    try { await generateLeagueWeek(lid, week); await reload(); } catch (e: any) { alert(e.message); } finally { setBusy(false); }
  }

  if (!l) return <div className="spin">Loading…</div>;

  return (
    <div className="col" style={{ gap: 16, maxWidth: 900 }}>
      <div>
        <Link to="/" className="muted">← Dashboard</Link>
        <h1 style={{ margin: '6px 0 0' }}>{l.name}</h1>
        <div className="wrap" style={{ marginTop: 6 }}>
          <span className="tag">{l.ranked ? 'ranked' : 'casual'}</span>
          <span className="tag">Meets {WEEKDAYS[l.meet_day]}{l.meet_time ? ` · ${l.meet_time}` : ''}</span>
          <span className="tag on">Week {week} of {l.weeks}</span>
        </div>
      </div>

      <div className="card col">
        <div className="spread">
          <strong>This week's fixtures</strong>
          {fixtures.length === 0 && <button className="sm" disabled={busy} onClick={gen}>Generate week {week}</button>}
        </div>
        {fixtures.length === 0 ? <div className="muted">Not generated yet.</div> : fixtures.map((f) => (
          <div key={f.id} className="spread" style={{ padding: '6px 0' }}>
            <span>{f.a?.display_name ?? '?'} {f.player_b ? <><span className="muted">vs</span> {f.b?.display_name ?? '?'}</> : <span className="muted">· bye</span>}</span>
            {f.match_id ? <span className="tag on">played</span> : <span className="tag">pending</span>}
          </div>
        ))}
      </div>

      <div className="card">
        <strong>Standings</strong>
        {standings.length === 0 ? <div className="muted">No results yet.</div> : (
          <table>
            <thead><tr><th>#</th><th>Member</th><th>P</th><th>W</th><th>L</th><th>D</th><th>Pts</th></tr></thead>
            <tbody>
              {standings.map((s, i) => (
                <tr key={s.user_id}>
                  <td className={i < 3 ? `medal${i + 1}` : ''}>{i + 1}</td>
                  <td>{names[s.user_id!] ?? '…'}</td>
                  <td>{s.played}</td><td>{s.wins}</td><td>{s.losses}</td><td>{s.draws}</td>
                  <td style={{ fontWeight: 800 }}>{s.points}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <strong>Members · {members.length}</strong>
        <div className="wrap" style={{ marginTop: 8 }}>
          {members.map((m) => (
            <span key={m.user_id} className="tag"><span className="belt" style={{ background: BELT_COLOR[m.profile?.belt_rank ?? 'white'] }} />{m.profile?.display_name ?? '…'}{m.role === 'organizer' ? ' (org)' : ''}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
