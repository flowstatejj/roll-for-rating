import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { BELT_COLOR } from '../App';
import {
  addDivisionEntrant, assignBoutMat, BELTS, createDivision, divisionStandings, generateDivision,
  getBouts, getDivisionEntrants, getDivisions, getMats, getTeams, getTournament, profilesByIds,
  recordBout, recordSubbout, searchProfiles, setMatReferee, subscribeTournament,
  type Bout, type BeltRank, type Division, type Format, type Mat, type Profile, type Standing, type Team, type Tournament,
} from '../lib/api';

type Tab = 'divisions' | 'bracket' | 'run' | 'standings';

export default function TournamentManager() {
  const { id } = useParams<{ id: string }>();
  const tid = id!;
  const [t, setT] = useState<Tournament | null>(null);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [mats, setMats] = useState<Mat[]>([]);
  const [bouts, setBouts] = useState<Bout[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<Tab>('divisions');
  const [divId, setDivId] = useState<string>('');
  const isTeam = t?.team_rule !== 'none';

  const reload = useCallback(async () => {
    const [tt, dv, mt, bt, tm] = await Promise.all([
      getTournament(tid), getDivisions(tid), getMats(tid), getBouts(tid), getTeams(tid),
    ]);
    setT(tt); setDivisions(dv); setMats(mt); setBouts(bt); setTeams(tm);
    // resolve participant names
    const pids = new Set<string>();
    bt.forEach((b) => { [b.a_entrant, b.b_entrant].forEach((x) => x && pids.add(x)); });
    const profs = await profilesByIds([...pids]);
    const map: Record<string, string> = {};
    Object.values(profs).forEach((p: Profile) => (map[p.id] = p.display_name));
    tm.forEach((team) => (map[team.id] = team.name));
    setNames(map);
    if (!divId && dv.length) setDivId(dv[0].id);
  }, [tid, divId]);

  useEffect(() => { reload(); }, [tid]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => subscribeTournament(tid, () => { reload(); }), [tid]); // eslint-disable-line react-hooks/exhaustive-deps

  const nameOf = (id: string | null) => (id ? names[id] ?? '…' : '—');

  if (!t) return <div className="spin">Loading…</div>;

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="spread">
        <div>
          <Link to="/" className="muted">← Dashboard</Link>
          <h1 style={{ margin: '6px 0 0' }}>{t.name}</h1>
          <div className="wrap" style={{ marginTop: 6 }}>
            <span className={`tag ${t.status === 'running' ? 'on' : ''}`}>{t.status}</span>
            <span className="tag">{t.format.replace('_', ' ')}</span>
            <span className="tag">{isTeam ? `${t.team_size}v${t.team_size} ${t.team_rule}` : '1v1'}</span>
            <span className="tag">{t.ranked ? 'ranked' : 'casual'}</span>
          </div>
        </div>
        <Link to={`/t/${tid}/scoreboard`} target="_blank"><button>📺 Open scoreboard</button></Link>
      </div>

      <div className="tabs">
        {(['divisions', 'bracket', 'run', 'standings'] as Tab[]).map((x) => (
          <button key={x} className={tab === x ? 'active' : ''} onClick={() => setTab(x)}>{x[0].toUpperCase() + x.slice(1)}</button>
        ))}
      </div>

      {tab === 'divisions' && <Divisions tid={tid} divisions={divisions} bouts={bouts} reload={reload} />}
      {tab === 'bracket' && (
        <BracketView divisions={divisions} divId={divId} setDivId={setDivId} bouts={bouts} format={t.format} nameOf={nameOf} reload={reload} />
      )}
      {tab === 'run' && <MatBoard tid={tid} mats={mats} bouts={bouts} isTeam={isTeam} nameOf={nameOf} reload={reload} />}
      {tab === 'standings' && (
        <StandingsView divisions={divisions} divId={divId} setDivId={setDivId} nameOf={nameOf} teams={teams} />
      )}
    </div>
  );
}

// ---- Divisions tab ---------------------------------------------------------
function Divisions({ tid, divisions, bouts, reload }: { tid: string; divisions: Division[]; bouts: Bout[]; reload: () => Promise<void> }) {
  const [name, setName] = useState('');
  const [beltMin, setBeltMin] = useState<BeltRank | ''>('');
  const [beltMax, setBeltMax] = useState<BeltRank | ''>('');
  const [gender, setGender] = useState('any');
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await createDivision({ tid, name, beltMin: beltMin || null, beltMax: beltMax || null, gender });
      setName(''); setBeltMin(''); setBeltMax('');
      await reload();
    } catch (e: any) { alert(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="col" style={{ gap: 16, maxWidth: 900 }}>
      <div className="card col">
        <strong>New division</strong>
        <div className="wrap" style={{ alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: 1, minWidth: 180 }}><label>Name</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Adult / Blue / Lightweight" /></div>
          <div className="field"><label>Belt min</label><select value={beltMin} onChange={(e) => setBeltMin(e.target.value as BeltRank)}><option value="">any</option>{BELTS.map((b) => <option key={b} value={b}>{b}</option>)}</select></div>
          <div className="field"><label>Belt max</label><select value={beltMax} onChange={(e) => setBeltMax(e.target.value as BeltRank)}><option value="">any</option>{BELTS.map((b) => <option key={b} value={b}>{b}</option>)}</select></div>
          <div className="field"><label>Gender</label><select value={gender} onChange={(e) => setGender(e.target.value)}><option value="any">any</option><option value="male">male</option><option value="female">female</option></select></div>
          <button disabled={busy} onClick={add}>Add division</button>
        </div>
      </div>

      {divisions.length === 0 ? <div className="empty">No divisions yet.</div> : divisions.map((d) => (
        <DivisionRow key={d.id} d={d} hasBouts={bouts.some((b) => b.division_id === d.id)} reload={reload} />
      ))}
    </div>
  );
}

function DivisionRow({ d, hasBouts, reload }: { d: Division; hasBouts: boolean; reload: () => Promise<void> }) {
  const [entrants, setEntrants] = useState<string[]>([]);
  const [people, setPeople] = useState<Record<string, Profile>>({});
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Profile[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const ids = await getDivisionEntrants(d.id);
    setEntrants(ids);
    setPeople(await profilesByIds(ids));
  }, [d.id]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const h = setTimeout(() => { searchProfiles(q).then(setResults).catch(() => {}); }, 250);
    return () => clearTimeout(h);
  }, [q]);

  async function add(p: Profile) {
    try { await addDivisionEntrant(d.id, p.id); setQ(''); setResults([]); await load(); } catch (e: any) { alert(e.message); }
  }
  async function gen() {
    setBusy(true);
    try { await generateDivision(d.id); await reload(); } catch (e: any) { alert(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="card col">
      <div className="spread">
        <div>
          <strong>{d.name}</strong>{' '}
          <span className="muted">
            {d.belt_min || d.belt_max ? `${d.belt_min ?? 'white'}–${d.belt_max ?? 'black'} · ` : ''}{d.gender !== 'any' ? `${d.gender} · ` : ''}{entrants.length} entrants
          </span>
        </div>
        {hasBouts ? <span className="tag on">bracket generated</span> : (
          <button className="sm" disabled={busy || entrants.length < 2} onClick={gen}>Generate bracket</button>
        )}
      </div>

      <div className="wrap">
        {entrants.map((id) => (
          <span key={id} className="tag"><span className="belt" style={{ background: BELT_COLOR[people[id]?.belt_rank ?? 'white'] }} />{people[id]?.display_name ?? '…'}</span>
        ))}
      </div>

      {!hasBouts && (
        <div className="field" style={{ position: 'relative' }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Add competitor by name…" />
          {results.length > 0 && (
            <div className="card" style={{ position: 'absolute', top: 46, zIndex: 5, width: '100%', maxHeight: 220, overflow: 'auto' }}>
              {results.map((p) => (
                <div key={p.id} className="spread" style={{ padding: '6px 0', cursor: 'pointer' }} onClick={() => add(p)}>
                  <span><span className="belt" style={{ background: BELT_COLOR[p.belt_rank] }} />{p.display_name} <span className="muted">@{p.username}</span></span>
                  <span className="muted">{p.rating}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---- Bracket tab -----------------------------------------------------------
function BracketView({ divisions, divId, setDivId, bouts, format, nameOf, reload }: {
  divisions: Division[]; divId: string; setDivId: (s: string) => void; bouts: Bout[]; format: Format; nameOf: (id: string | null) => string; reload: () => Promise<void>;
}) {
  const dbouts = bouts.filter((b) => b.division_id === divId);
  const rounds = useMemo(() => {
    const m = new Map<number, Bout[]>();
    dbouts.forEach((b) => { if (!m.has(b.round_no)) m.set(b.round_no, []); m.get(b.round_no)!.push(b); });
    return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v.sort((x, y) => x.position - y.position));
  }, [dbouts]);

  return (
    <div className="col">
      <DivPicker divisions={divisions} divId={divId} setDivId={setDivId} />
      {dbouts.length === 0 ? (
        <div className="empty">No bracket yet — add ≥2 entrants in the Divisions tab and Generate.</div>
      ) : format === 'round_robin' || format === 'rr_playoff' ? (
        <div className="col">
          {rounds.map((r, i) => (
            <div key={i} className="card">
              <strong>Round {i + 1}</strong>
              {r.map((b) => (
                <div key={b.id} className="spread" style={{ padding: '6px 0' }}>
                  <span>{sideName(b, 'a', nameOf)} <span className="muted">vs</span> {sideName(b, 'b', nameOf)}</span>
                  <span className={`tag ${b.status === 'done' ? 'on' : ''}`}>{b.status === 'done' ? resultLabel(b, nameOf) : b.status}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div className="bracket">
          {rounds.map((r, i) => (
            <div key={i} className="round">
              {r.map((b) => (
                <div key={b.id} className="bout">
                  <div className={`side ${b.winner === 'a' ? 'win' : ''}`}><span className="nm">{sideName(b, 'a', nameOf)}</span></div>
                  <div className={`side ${b.winner === 'b' ? 'win' : ''}`}><span className="nm">{sideName(b, 'b', nameOf)}</span></div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- Run tab (mat board) ---------------------------------------------------
function MatBoard({ tid, mats, bouts, isTeam, nameOf, reload }: {
  tid: string; mats: Mat[]; bouts: Bout[]; isTeam: boolean; nameOf: (id: string | null) => string; reload: () => Promise<void>;
}) {
  const ready = bouts.filter((b) => b.status !== 'done' && b.status !== 'bye' && hasBoth(b) && !b.mat_id);
  const [refQ, setRefQ] = useState('');
  const [refResults, setRefResults] = useState<Profile[]>([]);
  const [refMat, setRefMat] = useState<string | null>(null);

  useEffect(() => {
    const h = setTimeout(() => { if (refMat) searchProfiles(refQ).then(setRefResults).catch(() => {}); }, 250);
    return () => clearTimeout(h);
  }, [refQ, refMat]);

  async function assign(boutId: string, matId: string) { try { await assignBoutMat(boutId, matId); await reload(); } catch (e: any) { alert(e.message); } }

  return (
    <div className="col">
      <div className="spread"><strong>Mats</strong><span className="muted">{ready.length} bout(s) ready to assign</span></div>
      <div className="mats">
        {mats.map((m) => {
          const live = bouts.find((b) => b.mat_id === m.id);
          return (
            <div className="mat" key={m.id}>
              <h3>Mat {m.mat_no} {m.referee_id ? <span className="muted" style={{ fontSize: 13 }}>ref: {nameOf(m.referee_id)}</span> : <button className="ghost sm" onClick={() => { setRefMat(m.id); setRefQ(''); }}>set ref</button>}</h3>
              {refMat === m.id && (
                <div className="field">
                  <input autoFocus value={refQ} onChange={(e) => setRefQ(e.target.value)} placeholder="Referee name…" />
                  {refResults.map((p) => (
                    <div key={p.id} className="qbout" style={{ cursor: 'pointer' }} onClick={async () => { await setMatReferee(m.id, p.id); setRefMat(null); await reload(); }}>{p.display_name}</div>
                  ))}
                </div>
              )}
              {live ? (
                <RecordCard bout={live} isTeam={isTeam} nameOf={nameOf} reload={reload} />
              ) : (
                <div className="muted" style={{ padding: '12px 0' }}>Idle — assign a bout →</div>
              )}
            </div>
          );
        })}
      </div>

      <div className="card">
        <strong>Up next</strong>
        <div className="queue">
          {ready.length === 0 && <div className="muted">Nothing waiting. Winners feed in automatically as bouts finish.</div>}
          {ready.map((b) => (
            <div key={b.id} className="qbout spread">
              <span>{sideName(b, 'a', nameOf)} <span className="muted">vs</span> {sideName(b, 'b', nameOf)}</span>
              <select defaultValue="" onChange={(e) => e.target.value && assign(b.id, e.target.value)}>
                <option value="">→ mat</option>
                {mats.map((m) => <option key={m.id} value={m.id}>Mat {m.mat_no}</option>)}
              </select>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function RecordCard({ bout, isTeam, nameOf, reload }: { bout: Bout; isTeam: boolean; nameOf: (id: string | null) => string; reload: () => Promise<void> }) {
  const [result, setResult] = useState('submission');
  const [sub, setSub] = useState<'kill' | 'break'>('kill');
  const [busy, setBusy] = useState(false);

  async function rec(winner: 'a' | 'b' | 'draw') {
    setBusy(true);
    try {
      const subCat = result === 'submission' ? sub : null;
      if (isTeam) await recordSubbout(bout.id, winner, result, subCat);
      else await recordBout(bout.id, winner, result, subCat);
      await reload();
    } catch (e: any) { alert(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="col" style={{ gap: 8 }}>
      <div style={{ fontWeight: 800 }}>{sideName(bout, 'a', nameOf)} <span className="muted">vs</span> {sideName(bout, 'b', nameOf)}</div>
      {isTeam && <div className="muted" style={{ fontSize: 13 }}>Team score {bout.a_score}–{bout.b_score} · record each fighter</div>}
      <div className="row">
        <select value={result} onChange={(e) => setResult(e.target.value)}>
          <option value="submission">Submission</option><option value="points">Points</option>
          <option value="advantage">Advantage</option><option value="decision">Decision</option>
        </select>
        {result === 'submission' && (
          <select value={sub} onChange={(e) => setSub(e.target.value as any)}><option value="kill">Choke (kill)</option><option value="break">Lock (break)</option></select>
        )}
      </div>
      <div className="row">
        <button className="sm" disabled={busy} onClick={() => rec('a')}>◀ {sideName(bout, 'a', nameOf)}</button>
        <button className="sm ghost" disabled={busy} onClick={() => rec('draw')}>Draw</button>
        <button className="sm" disabled={busy} onClick={() => rec('b')}>{sideName(bout, 'b', nameOf)} ▶</button>
      </div>
    </div>
  );
}

// ---- Standings tab ---------------------------------------------------------
function StandingsView({ divisions, divId, setDivId, nameOf, teams }: {
  divisions: Division[]; divId: string; setDivId: (s: string) => void; nameOf: (id: string | null) => string; teams: Team[];
}) {
  const [rows, setRows] = useState<Standing[]>([]);
  useEffect(() => { if (divId) divisionStandings(divId).then(setRows).catch(() => setRows([])); }, [divId]);
  return (
    <div className="col">
      <DivPicker divisions={divisions} divId={divId} setDivId={setDivId} />
      {rows.length === 0 ? <div className="empty">No results recorded yet.</div> : (
        <div className="card">
          <table>
            <thead><tr><th>#</th><th>Competitor</th><th>P</th><th>W</th><th>L</th><th>D</th><th>Pts</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.participant}>
                  <td className={i < 3 ? `medal${i + 1}` : ''}>{i + 1}</td>
                  <td>{nameOf(r.participant ?? null)}</td>
                  <td>{r.played}</td><td>{r.wins}</td><td>{r.losses}</td><td>{r.draws}</td>
                  <td style={{ fontWeight: 800 }}>{r.points}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---- helpers ---------------------------------------------------------------
function DivPicker({ divisions, divId, setDivId }: { divisions: Division[]; divId: string; setDivId: (s: string) => void }) {
  if (divisions.length === 0) return <div className="empty">Create a division first.</div>;
  return (
    <div className="tabs">
      {divisions.map((d) => (
        <button key={d.id} className={divId === d.id ? 'active' : ''} onClick={() => setDivId(d.id)}>{d.name}</button>
      ))}
    </div>
  );
}
function hasBoth(b: Bout) { return (b.a_entrant && b.b_entrant) || (b.a_team && b.b_team); }
function sideName(b: Bout, s: 'a' | 'b', nameOf: (id: string | null) => string) {
  return nameOf(s === 'a' ? (b.a_entrant ?? b.a_team) : (b.b_entrant ?? b.b_team));
}
function resultLabel(b: Bout, nameOf: (id: string | null) => string) {
  if (b.winner === 'draw') return 'draw';
  return `${sideName(b, b.winner === 'a' ? 'a' : 'b', nameOf)} ✓`;
}
