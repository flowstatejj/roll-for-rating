import { supabase } from './supabase';
import type { League, LeagueFixture, LeagueMember, LeagueStanding } from './types';

const PERSON = 'id,display_name,belt_rank,rating';
const MEMBER_SELECT = `*, profile:profiles!league_members_user_id_fkey(${PERSON},avatar_path)`;
const FIXTURE_SELECT = `*, a:profiles!league_fixtures_player_a_fkey(id,display_name,belt_rank), b:profiles!league_fixtures_player_b_fkey(id,display_name,belt_rank)`;

/** Leagues the user belongs to. */
export async function fetchMyLeagues(userId: string): Promise<League[]> {
  const { data, error } = await supabase
    .from('league_members')
    .select('role, league:leagues(*)')
    .eq('user_id', userId);
  if (error) throw error;
  return (data ?? [])
    .filter((r: any) => r.league)
    .map((r: any) => ({ ...r.league, is_member: true, is_organizer: r.role === 'organizer' })) as League[];
}

/** Publicly listed leagues to browse/join. */
export async function fetchOpenLeagues(opts: { city?: string; audience?: string } = {}): Promise<League[]> {
  let q = supabase.from('leagues').select('*').eq('visibility', 'open').order('created_at', { ascending: false }).limit(100);
  if (opts.city?.trim()) q = q.ilike('city', `%${opts.city.trim()}%`);
  if (opts.audience && opts.audience !== 'all') q = q.eq('audience', opts.audience);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as League[];
}

export async function fetchLeague(id: string): Promise<League | null> {
  const { data, error } = await supabase.from('leagues').select('*').eq('id', id).single();
  if (error) return null;
  return data as League;
}

export async function fetchMembers(leagueId: string): Promise<LeagueMember[]> {
  const { data, error } = await supabase
    .from('league_members')
    .select(MEMBER_SELECT)
    .eq('league_id', leagueId)
    .eq('active', true)
    .order('joined_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as LeagueMember[];
}

export async function createLeague(args: {
  createdBy: string;
  name: string;
  description?: string;
  audience: 'all' | 'kids' | 'adults';
  ranked: boolean;
  visibility: 'open' | 'private';
  meetDay: number;
  meetTime?: string;
  location?: string;
  city?: string;
  seasonStarts: string; // YYYY-MM-DD
  weeks: number;
  winPoints: number;
  drawPoints: number;
  lossPoints: number;
  subKillBonus: number;
  subBreakBonus: number;
}): Promise<League> {
  const { data, error } = await supabase
    .from('leagues')
    .insert({
      created_by: args.createdBy,
      name: args.name.trim(),
      description: args.description?.trim() || null,
      audience: args.audience,
      ranked: args.ranked,
      visibility: args.visibility,
      meet_day: args.meetDay,
      meet_time: args.meetTime?.trim() || null,
      location: args.location?.trim() || null,
      city: args.city?.trim() || null,
      season_starts: args.seasonStarts,
      weeks: args.weeks,
      win_points: args.winPoints,
      draw_points: args.drawPoints,
      loss_points: args.lossPoints,
      sub_kill_bonus: args.subKillBonus,
      sub_break_bonus: args.subBreakBonus,
    })
    .select('*')
    .single();
  if (error) throw error;
  const league = data as League;
  // The creator is the organizer + first member.
  const { error: mErr } = await supabase
    .from('league_members')
    .insert({ league_id: league.id, user_id: args.createdBy, role: 'organizer', joined_week: 1 });
  if (mErr) throw mErr;
  return league;
}

export async function joinLeague(userId: string, leagueId: string): Promise<void> {
  const { error } = await supabase
    .from('league_members')
    .upsert({ league_id: leagueId, user_id: userId, role: 'member', active: true }, { onConflict: 'league_id,user_id' });
  if (error) throw error;
}

/** Join via a shared code; returns the league id. */
export async function joinLeagueByCode(code: string): Promise<string> {
  const { data, error } = await supabase.rpc('join_league_by_code', { p_code: code });
  if (error) throw error;
  return data as string;
}

export async function leaveLeague(userId: string, leagueId: string): Promise<void> {
  const { error } = await supabase.from('league_members').delete().eq('league_id', leagueId).eq('user_id', userId);
  if (error) throw error;
}

export async function fetchFixtures(leagueId: string, week: number): Promise<LeagueFixture[]> {
  const { data, error } = await supabase
    .from('league_fixtures')
    .select(FIXTURE_SELECT)
    .eq('league_id', leagueId)
    .eq('week_no', week)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as LeagueFixture[];
}

/** Organizer: auto-pair the given week (idempotent). */
export async function generateWeek(leagueId: string, week: number): Promise<void> {
  const { error } = await supabase.rpc('generate_league_week', { p_league_id: leagueId, p_week: week });
  if (error) throw error;
}

/** Standings (numbers from the server scoring fn) merged with member profiles. */
export async function fetchStandings(leagueId: string): Promise<LeagueStanding[]> {
  const { data, error } = await supabase.rpc('league_standings', { p_league_id: leagueId });
  if (error) throw error;
  const rows = (data ?? []) as LeagueStanding[];
  if (rows.length === 0) return rows;
  const { data: profs } = await supabase
    .from('profiles')
    .select(PERSON)
    .in('id', rows.map((r) => r.user_id));
  const byId = new Map((profs ?? []).map((p: any) => [p.id, p]));
  return rows.map((r) => ({ ...r, profile: byId.get(r.user_id) ?? null }));
}

/** Link the match a fixture was played as (called after creating a league match). */
export async function linkFixtureMatch(leagueId: string, week: number, userA: string, userB: string, matchId: string): Promise<void> {
  const { data } = await supabase
    .from('league_fixtures')
    .select('id, player_a, player_b')
    .eq('league_id', leagueId)
    .eq('week_no', week);
  const fixture = (data ?? []).find(
    (f: any) =>
      (f.player_a === userA && f.player_b === userB) || (f.player_a === userB && f.player_b === userA),
  );
  if (!fixture) return;
  await supabase.from('league_fixtures').update({ match_id: matchId }).eq('id', (fixture as any).id);
}

/** 1-based current week of a league, clamped to its length. */
export function currentLeagueWeek(league: Pick<League, 'season_starts' | 'weeks'>): number {
  const start = new Date(league.season_starts + 'T00:00:00').getTime();
  const days = Math.floor((Date.now() - start) / 86_400_000);
  return Math.max(1, Math.min(league.weeks, Math.floor(days / 7) + 1));
}

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
