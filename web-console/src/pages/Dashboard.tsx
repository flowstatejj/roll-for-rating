import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth';
import { myLeagues, myTournaments, WEEKDAYS, type League, type Tournament } from '../lib/api';

export default function Dashboard() {
  const { session } = useAuth();
  const uid = session!.user.id;
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [leagues, setLeagues] = useState<League[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([myTournaments(uid), myLeagues(uid)])
      .then(([t, l]) => { setTournaments(t); setLeagues(l); })
      .catch((e) => console.warn(e))
      .finally(() => setLoading(false));
  }, [uid]);

  if (loading) return <div className="spin">Loading…</div>;

  return (
    <div className="col" style={{ gap: 28, maxWidth: 1100 }}>
      <div className="spread">
        <h1>Organizer dashboard</h1>
        <span className="muted">{session!.user.email}</span>
      </div>

      <section>
        <h2>Tournaments</h2>
        <p className="muted">Create tournaments in the mobile app; manage &amp; run them here.</p>
        {tournaments.length === 0 ? (
          <div className="empty">No tournaments yet — create one in the app, then it shows up here to run.</div>
        ) : (
          <div className="wrap">
            {tournaments.map((t) => (
              <Link key={t.id} to={`/t/${t.id}`} className="card" style={{ width: 320 }}>
                <div className="spread">
                  <strong style={{ fontSize: 17 }}>{t.name}</strong>
                  <span className={`tag ${t.status === 'running' ? 'on' : ''}`}>{t.status}</span>
                </div>
                <div className="wrap" style={{ marginTop: 8 }}>
                  <span className="tag">{t.format.replace('_', ' ')}</span>
                  <span className="tag">{t.team_rule === 'none' ? '1v1' : `${t.team_size}v${t.team_size} ${t.team_rule}`}</span>
                  <span className="tag">{t.ranked ? 'ranked' : 'casual'}</span>
                  <span className="tag">{t.mats} mat{t.mats > 1 ? 's' : ''}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2>Leagues</h2>
        {leagues.length === 0 ? (
          <div className="empty">No leagues you organize yet.</div>
        ) : (
          <div className="wrap">
            {leagues.map((l) => (
              <Link key={l.id} to={`/l/${l.id}`} className="card" style={{ width: 320 }}>
                <strong style={{ fontSize: 17 }}>{l.name}</strong>
                <div className="wrap" style={{ marginTop: 8 }}>
                  <span className="tag">{l.ranked ? 'ranked' : 'casual'}</span>
                  <span className="tag">{WEEKDAYS[l.meet_day]}{l.meet_time ? ` · ${l.meet_time}` : ''}</span>
                  <span className="tag">{l.weeks} weeks</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
