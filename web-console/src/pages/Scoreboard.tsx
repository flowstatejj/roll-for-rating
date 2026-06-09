import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  getBouts, getMats, getTeams, getTournament, profilesByIds, subscribeTournament,
  type Bout, type Mat, type Profile, type Team,
} from '../lib/api';

export default function Scoreboard() {
  const { id } = useParams<{ id: string }>();
  const tid = id!;
  const [name, setName] = useState('');
  const [mats, setMats] = useState<Mat[]>([]);
  const [bouts, setBouts] = useState<Bout[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});

  const reload = useCallback(async () => {
    const [tt, mt, bt, tm] = await Promise.all([getTournament(tid), getMats(tid), getBouts(tid), getTeams(tid)]);
    setName(tt.name); setMats(mt); setBouts(bt);
    const pids = new Set<string>();
    bt.forEach((b) => { [b.a_entrant, b.b_entrant].forEach((x) => x && pids.add(x)); });
    const profs = await profilesByIds([...pids]);
    const map: Record<string, string> = {};
    Object.values(profs).forEach((p: Profile) => (map[p.id] = p.display_name));
    tm.forEach((t: Team) => (map[t.id] = t.name));
    setNames(map);
  }, [tid]);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => subscribeTournament(tid, reload), [tid, reload]);

  const nameOf = (x: string | null) => (x ? names[x] ?? '…' : '—');
  const sideName = (b: Bout, s: 'a' | 'b') => nameOf(s === 'a' ? (b.a_entrant ?? b.a_team) : (b.b_entrant ?? b.b_team));

  return (
    <div className="tv">
      {mats.length === 0 && <div className="center" style={{ width: '100%' }}><h1 className="muted">{name} — no mats</h1></div>}
      {mats.map((m) => {
        const live = bouts.find((b) => b.mat_id === m.id);
        return (
          <div className="tvmat" key={m.id}>
            <div className="vs" style={{ fontSize: 18 }}>MAT {m.mat_no}</div>
            {live ? (
              <>
                <div className="who">{sideName(live, 'a')}</div>
                <div className="vs">vs</div>
                <div className="who">{sideName(live, 'b')}</div>
                {live.a_score + live.b_score > 0 && <div className="vs" style={{ fontSize: 22, marginTop: 12 }}>{live.a_score} – {live.b_score}</div>}
              </>
            ) : (
              <div className="who muted" style={{ opacity: .5 }}>Idle</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
