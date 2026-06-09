import { supabase } from './supabase';

// ---- Types (mirror the app's Supabase schema) ------------------------------
export type BeltRank = 'white' | 'blue' | 'purple' | 'brown' | 'black';
export type Format = 'round_robin' | 'single_elim' | 'double_elim' | 'rr_playoff';

export interface Tournament {
  id: string; name: string; host_id: string; description: string | null;
  format: Format; team_size: number; team_rule: 'none' | 'duel' | 'quintet';
  team_build: 'host' | 'captain' | 'auto'; ranked: boolean; status: 'setup' | 'running' | 'complete';
  win_points: number; draw_points: number; loss_points: number; sub_kill_bonus: number; sub_break_bonus: number;
  mats: number; join_code: string | null; created_at: string;
}
export interface League {
  id: string; name: string; created_by: string; ranked: boolean; weeks: number; season_starts: string;
  meet_day: number; meet_time: string | null; join_code: string;
  win_points: number; draw_points: number; loss_points: number; sub_kill_bonus: number; sub_break_bonus: number;
}
export interface Division {
  id: string; tournament_id: string; name: string; belt_min: BeltRank | null; belt_max: BeltRank | null;
  age_min: number | null; age_max: number | null; weight_min_kg: number | null; weight_max_kg: number | null;
  gender: 'any' | 'male' | 'female'; format: Format | null; status: 'setup' | 'running' | 'complete';
}
export interface Profile { id: string; username: string; display_name: string; belt_rank: BeltRank; rating: number; }
export interface Team { id: string; tournament_id: string; name: string; }
export interface Mat { id: string; tournament_id: string; mat_no: number; referee_id: string | null; }
export interface Bout {
  id: string; tournament_id: string; division_id: string | null; bracket: string; round_no: number; position: number;
  a_entrant: string | null; b_entrant: string | null; a_team: string | null; b_team: string | null;
  mat_id: string | null; referee_id: string | null; status: 'pending' | 'live' | 'done' | 'bye';
  winner: 'a' | 'b' | 'draw' | null; result: string | null; sub_category: 'kill' | 'break' | null;
  a_score: number; b_score: number; next_bout_id: string | null; next_slot: 'a' | 'b' | null;
}
export interface Standing { participant?: string; user_id?: string; played: number; wins: number; losses: number; draws: number; points: number; }

export const BELTS: BeltRank[] = ['white', 'blue', 'purple', 'brown', 'black'];
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ---- Auth ------------------------------------------------------------------
export async function signIn(email: string, password: string) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}
export async function signOut() { await supabase.auth.signOut(); }

// ---- Dashboard -------------------------------------------------------------
export async function myTournaments(uid: string): Promise<Tournament[]> {
  const { data, error } = await supabase.from('tournaments').select('*').eq('host_id', uid).order('created_at', { ascending: false });
  if (error) throw error; return (data ?? []) as Tournament[];
}
export async function myLeagues(uid: string): Promise<League[]> {
  const { data, error } = await supabase.from('leagues').select('*').eq('created_by', uid).order('created_at', { ascending: false });
  if (error) throw error; return (data ?? []) as League[];
}

// ---- Tournament + divisions ------------------------------------------------
export async function getTournament(id: string): Promise<Tournament> {
  const { data, error } = await supabase.from('tournaments').select('*').eq('id', id).single();
  if (error) throw error; return data as Tournament;
}
export async function getDivisions(tid: string): Promise<Division[]> {
  const { data, error } = await supabase.from('tournament_divisions').select('*').eq('tournament_id', tid).order('created_at');
  if (error) throw error; return (data ?? []) as Division[];
}
export async function createDivision(args: {
  tid: string; name: string; beltMin?: BeltRank | null; beltMax?: BeltRank | null;
  ageMin?: number | null; ageMax?: number | null; wMin?: number | null; wMax?: number | null;
  gender?: string; format?: Format | null;
}): Promise<string> {
  const { data, error } = await supabase.rpc('create_division', {
    p_tid: args.tid, p_name: args.name, p_belt_min: args.beltMin ?? null, p_belt_max: args.beltMax ?? null,
    p_age_min: args.ageMin ?? null, p_age_max: args.ageMax ?? null, p_wmin: args.wMin ?? null, p_wmax: args.wMax ?? null,
    p_gender: args.gender ?? 'any', p_format: args.format ?? null,
  });
  if (error) throw error; return data as string;
}
export async function getDivisionEntrants(divId: string): Promise<string[]> {
  const { data, error } = await supabase.from('division_entrants').select('user_id').eq('division_id', divId);
  if (error) throw error; return (data ?? []).map((r: any) => r.user_id);
}
export async function addDivisionEntrant(divId: string, userId: string) {
  const { error } = await supabase.rpc('add_division_entrant', { p_division: divId, p_user: userId });
  if (error) throw error;
}
export async function generateDivision(divId: string) {
  const { error } = await supabase.rpc('generate_division', { p_division: divId });
  if (error) throw error;
}
export async function divisionStandings(divId: string): Promise<Standing[]> {
  const { data, error } = await supabase.rpc('division_standings', { p_division: divId });
  if (error) throw error; return (data ?? []) as Standing[];
}

// ---- Profiles --------------------------------------------------------------
export async function searchProfiles(q: string): Promise<Profile[]> {
  let req = supabase.from('profiles').select('id,username,display_name,belt_rank,rating').neq('age_tier', 'kid').order('rating', { ascending: false }).limit(25);
  if (q.trim()) req = req.or(`username.ilike.%${q.trim()}%,display_name.ilike.%${q.trim()}%`);
  const { data, error } = await req; if (error) throw error; return (data ?? []) as Profile[];
}
export async function profilesByIds(ids: string[]): Promise<Record<string, Profile>> {
  if (ids.length === 0) return {};
  const { data } = await supabase.from('profiles').select('id,username,display_name,belt_rank,rating').in('id', ids);
  const map: Record<string, Profile> = {}; (data ?? []).forEach((p: any) => (map[p.id] = p)); return map;
}

// ---- Bouts / mats (the live runner) ---------------------------------------
export async function getBouts(tid: string, divId?: string): Promise<Bout[]> {
  let req = supabase.from('tournament_bouts').select('*').eq('tournament_id', tid);
  if (divId) req = req.eq('division_id', divId);
  const { data, error } = await req.order('round_no').order('position'); if (error) throw error; return (data ?? []) as Bout[];
}
export async function getMats(tid: string): Promise<Mat[]> {
  const { data, error } = await supabase.from('tournament_mats').select('*').eq('tournament_id', tid).order('mat_no');
  if (error) throw error; return (data ?? []) as Mat[];
}
export async function setMatReferee(matId: string, refId: string | null) {
  const { error } = await supabase.rpc('set_mat_referee', { p_mat: matId, p_ref: refId }); if (error) throw error;
}
export async function assignBoutMat(boutId: string, matId: string) {
  const { error } = await supabase.rpc('assign_bout_mat', { p_bout: boutId, p_mat: matId }); if (error) throw error;
}
export async function recordBout(boutId: string, winner: 'a' | 'b' | 'draw', result: string, subCategory?: 'kill' | 'break' | null) {
  const { error } = await supabase.rpc('record_bout_result', { p_bout: boutId, p_winner: winner, p_result: result, p_sub_category: subCategory ?? null, p_method: null });
  if (error) throw error;
}
export async function recordSubbout(boutId: string, winner: 'a' | 'b' | 'draw', result: string, subCategory?: 'kill' | 'break' | null) {
  const { error } = await supabase.rpc('record_subbout', { p_bout: boutId, p_winner: winner, p_result: result, p_sub_category: subCategory ?? null });
  if (error) throw error;
}
export async function getTeams(tid: string): Promise<Team[]> {
  const { data, error } = await supabase.from('tournament_teams').select('id,tournament_id,name').eq('tournament_id', tid);
  if (error) throw error; return (data ?? []) as Team[];
}

// ---- Leagues (desktop manager) --------------------------------------------
export async function getLeague(id: string): Promise<League> {
  const { data, error } = await supabase.from('leagues').select('*').eq('id', id).single(); if (error) throw error; return data as League;
}
export async function leagueFixtures(id: string, week: number) {
  const { data, error } = await supabase.from('league_fixtures')
    .select('*, a:profiles!league_fixtures_player_a_fkey(display_name), b:profiles!league_fixtures_player_b_fkey(display_name)')
    .eq('league_id', id).eq('week_no', week).order('created_at');
  if (error) throw error; return data ?? [];
}
export async function generateLeagueWeek(id: string, week: number) {
  const { error } = await supabase.rpc('generate_league_week', { p_league_id: id, p_week: week }); if (error) throw error;
}
export async function leagueStandings(id: string): Promise<Standing[]> {
  const { data, error } = await supabase.rpc('league_standings', { p_league_id: id }); if (error) throw error; return (data ?? []) as Standing[];
}
export async function leagueMembers(id: string) {
  const { data, error } = await supabase.from('league_members')
    .select('user_id, role, profile:profiles!league_members_user_id_fkey(display_name,belt_rank,rating)')
    .eq('league_id', id).eq('active', true);
  if (error) throw error; return data ?? [];
}
export function currentLeagueWeek(l: { season_starts: string; weeks: number }) {
  const start = new Date(l.season_starts + 'T00:00:00').getTime();
  return Math.max(1, Math.min(l.weeks, Math.floor((Date.now() - start) / 86400000) + 1));
}

// ---- Realtime --------------------------------------------------------------
export function subscribeTournament(tid: string, onChange: () => void) {
  const ch = supabase
    .channel(`tournament-${tid}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tournament_bouts', filter: `tournament_id=eq.${tid}` }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tournament_mats', filter: `tournament_id=eq.${tid}` }, onChange)
    .subscribe();
  return () => { supabase.removeChannel(ch); };
}
