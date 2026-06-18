import { supabase } from './supabase';
import type {
  GymPower,
  Tournament,
  TournamentBout,
  TournamentFormat,
  TournamentMat,
  TournamentStanding,
  TournamentStandingPro,
  TournamentTeam,
  TournamentTeamBuild,
  TournamentTeamRule,
  ResultType,
  SentInvite,
} from './types';

// ---------------------------------------------------------------------------
// Teams: gym power ranking
// ---------------------------------------------------------------------------
export async function fetchGymPowerRanking(): Promise<GymPower[]> {
  const { data, error } = await supabase.rpc('gym_power_ranking');
  if (error) throw error;
  return (data ?? []).map((g: any) => ({
    ...g,
    member_count: Number(g.member_count),
    total_wins: Number(g.total_wins),
  })) as GymPower[];
}

// ---------------------------------------------------------------------------
// Tournaments
// ---------------------------------------------------------------------------
export async function fetchTournaments(opts: { city?: string } = {}): Promise<Tournament[]> {
  let q = supabase.from('tournaments').select('*').order('starts_at', { ascending: false });
  if (opts.city?.trim()) q = q.ilike('city', `%${opts.city.trim()}%`);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Tournament[];
}

export async function fetchTournament(id: string): Promise<Tournament> {
  const { data, error } = await supabase.from('tournaments').select('*').eq('id', id).single();
  if (error) throw error;
  return data as Tournament;
}

export async function createTournament(args: {
  name: string;
  hostId: string;
  description?: string;
  format: TournamentFormat;
  teamSize: number;
  teamRule: TournamentTeamRule;
  teamBuild: TournamentTeamBuild;
  ranked: boolean;
  winPoints: number;
  drawPoints: number;
  lossPoints: number;
  subKillBonus: number;
  subBreakBonus: number;
  mats: number;
  visibility: 'open' | 'private';
  city?: string;
}): Promise<string> {
  const now = new Date();
  const ends = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 30); // 30-day default window
  const { data, error } = await supabase
    .from('tournaments')
    .insert({
      name: args.name.trim(),
      host_id: args.hostId,
      starts_at: now.toISOString(),
      ends_at: ends.toISOString(),
      description: args.description?.trim() || null,
      format: args.format,
      team_size: args.teamSize,
      team_rule: args.teamRule,
      team_build: args.teamBuild,
      ranked: args.ranked,
      win_points: args.winPoints,
      draw_points: args.drawPoints,
      loss_points: args.lossPoints,
      sub_kill_bonus: args.subKillBonus,
      sub_break_bonus: args.subBreakBonus,
      mats: args.mats,
      visibility: args.visibility,
      city: args.city?.trim() || null,
    })
    .select('id')
    .single();
  if (error) throw error;
  // host registers as an entrant too (handy for solo events)
  await supabase.from('tournament_entrants').insert({ tournament_id: data.id, user_id: args.hostId }).then(() => {}, () => {});
  return data.id;
}

export async function fetchEntrants(tid: string): Promise<string[]> {
  const { data, error } = await supabase.from('tournament_entrants').select('user_id').eq('tournament_id', tid);
  if (error) throw error;
  return (data ?? []).map((e: { user_id: string }) => e.user_id);
}

export async function joinTournament(tid: string, userId: string) {
  const { error } = await supabase.from('tournament_entrants').insert({ tournament_id: tid, user_id: userId });
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Invites — the host invites specific people (who accept to become entrants)
// ---------------------------------------------------------------------------
export interface TournamentInvite {
  tournament_id: string;
  name: string;
  format: string;
  invited_by_name: string;
  created_at: string;
}

/** Host invites a user to their tournament. */
export async function inviteToTournament(tid: string, userId: string): Promise<void> {
  const { error } = await supabase.rpc('invite_to_tournament', { p_tid: tid, p_user: userId });
  if (error) throw error;
}

/** Host invites several people at once; returns how many invites went out. */
export async function inviteManyToTournament(tid: string, userIds: string[]): Promise<number> {
  const { data, error } = await supabase.rpc('invite_many_to_tournament', { p_tid: tid, p_users: userIds });
  if (error) throw error;
  return (data as number) ?? 0;
}

/** Everyone the host has invited to this tournament, with status. Host only. */
export async function fetchTournamentInvitesSent(tid: string): Promise<SentInvite[]> {
  const { data, error } = await supabase.rpc('tournament_invites_sent', { p_tid: tid });
  if (error) throw error;
  return (data ?? []) as SentInvite[];
}

/** Invited user accepts (registers) or declines. */
export async function respondTournamentInvite(tid: string, accept: boolean): Promise<void> {
  const { error } = await supabase.rpc('respond_tournament_invite', { p_tid: tid, p_accept: accept });
  if (error) throw error;
}

/** Pending tournament invites for the signed-in user. */
export async function fetchMyTournamentInvites(): Promise<TournamentInvite[]> {
  const { data, error } = await supabase.rpc('my_tournament_invites');
  if (error) throw error;
  return (data ?? []) as TournamentInvite[];
}

/** Whether the signed-in user has a pending invite to this tournament. */
export async function hasTournamentInvite(tid: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('has_tournament_invite', { p_tid: tid });
  if (error) return false;
  return !!data;
}

export async function leaveTournament(tid: string, userId: string) {
  const { error } = await supabase.from('tournament_entrants').delete().eq('tournament_id', tid).eq('user_id', userId);
  if (error) throw error;
}

export async function fetchTournamentStandings(tid: string): Promise<TournamentStanding[]> {
  const { data, error } = await supabase.rpc('tournament_standings', { p_tid: tid });
  if (error) throw error;
  return (data ?? []).map((s: any) => ({ ...s, wins: Number(s.wins) })) as TournamentStanding[];
}

// ---------------------------------------------------------------------------
// Tournaments PRO — builder + live runner
// ---------------------------------------------------------------------------
export async function registerForTournament(tid: string): Promise<void> {
  const { error } = await supabase.rpc('register_for_tournament', { p_tid: tid });
  if (error) throw error;
}

export async function fetchTeams(tid: string): Promise<TournamentTeam[]> {
  const { data, error } = await supabase
    .from('tournament_teams')
    .select('*, members:tournament_team_members(user_id, slot, profile:profiles(display_name, belt_rank))')
    .eq('tournament_id', tid)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((t: any) => ({
    ...t,
    members: (t.members ?? []).map((m: any) => ({
      user_id: m.user_id,
      slot: m.slot,
      display_name: m.profile?.display_name ?? '?',
      belt_rank: m.profile?.belt_rank ?? 'white',
    })),
  })) as TournamentTeam[];
}

export async function createTeam(tid: string, name: string, captainId?: string): Promise<string> {
  const { data, error } = await supabase.rpc('create_tournament_team', { p_tid: tid, p_name: name.trim(), p_captain: captainId ?? null });
  if (error) throw error;
  return data as string;
}

export async function addTeamMember(teamId: string, userId: string): Promise<void> {
  const { error } = await supabase.rpc('add_team_member', { p_team: teamId, p_user: userId });
  if (error) throw error;
}

export async function autoBalanceTeams(tid: string): Promise<void> {
  const { error } = await supabase.rpc('auto_balance_teams', { p_tid: tid });
  if (error) throw error;
}

export async function fetchMats(tid: string): Promise<TournamentMat[]> {
  const { data, error } = await supabase
    .from('tournament_mats')
    .select('*, referee:profiles(display_name)')
    .eq('tournament_id', tid)
    .order('mat_no', { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as TournamentMat[];
}

export async function setMatReferee(matId: string, refId: string): Promise<void> {
  const { error } = await supabase.rpc('set_mat_referee', { p_mat: matId, p_ref: refId });
  if (error) throw error;
}

export async function assignBoutMat(boutId: string, matId: string): Promise<void> {
  const { error } = await supabase.rpc('assign_bout_mat', { p_bout: boutId, p_mat: matId });
  if (error) throw error;
}

export async function generateTournament(tid: string): Promise<void> {
  const { error } = await supabase.rpc('generate_tournament', { p_tid: tid });
  if (error) throw error;
}

export async function generatePlayoff(tid: string, top = 4): Promise<void> {
  const { error } = await supabase.rpc('generate_tournament_playoff', { p_tid: tid, p_top: top });
  if (error) throw error;
}

/** Fetch all bouts with competitor/team names resolved for display. */
export async function fetchBouts(tid: string): Promise<TournamentBout[]> {
  const { data, error } = await supabase
    .from('tournament_bouts')
    .select('*')
    .eq('tournament_id', tid)
    .order('bracket', { ascending: true })
    .order('round_no', { ascending: true })
    .order('position', { ascending: true });
  if (error) throw error;
  const bouts = (data ?? []) as TournamentBout[];
  // resolve names
  const profIds = new Set<string>();
  const teamIds = new Set<string>();
  bouts.forEach((b) => {
    [b.a_entrant, b.b_entrant].forEach((x) => x && profIds.add(x));
    [b.a_team, b.b_team].forEach((x) => x && teamIds.add(x));
  });
  const [profs, teams] = await Promise.all([
    profIds.size ? supabase.from('profiles').select('id, display_name').in('id', [...profIds]) : Promise.resolve({ data: [] as any }),
    teamIds.size ? supabase.from('tournament_teams').select('id, name').in('id', [...teamIds]) : Promise.resolve({ data: [] as any }),
  ]);
  const pName = new Map<string, string>((profs.data ?? []).map((p: any) => [p.id as string, p.display_name as string]));
  const tName = new Map<string, string>((teams.data ?? []).map((t: any) => [t.id as string, t.name as string]));
  return bouts.map((b) => ({
    ...b,
    a_name: b.a_team ? tName.get(b.a_team) ?? 'TBD' : b.a_entrant ? pName.get(b.a_entrant) ?? '?' : null,
    b_name: b.b_team ? tName.get(b.b_team) ?? 'TBD' : b.b_entrant ? pName.get(b.b_entrant) ?? '?' : null,
  }));
}

export async function recordBout(args: {
  boutId: string;
  winner: 'a' | 'b' | 'draw';
  result: ResultType;
  subCategory?: 'kill' | 'break' | null;
  method?: string | null;
}): Promise<void> {
  const { error } = await supabase.rpc('record_bout_result', {
    p_bout: args.boutId,
    p_winner: args.winner,
    p_result: args.result,
    p_sub_category: args.subCategory ?? null,
    p_method: args.method ?? null,
  });
  if (error) throw error;
}

export async function recordSubbout(args: {
  boutId: string;
  winner: 'a' | 'b' | 'draw';
  result: ResultType;
  subCategory?: 'kill' | 'break' | null;
}): Promise<void> {
  const { error } = await supabase.rpc('record_subbout', {
    p_bout: args.boutId,
    p_winner: args.winner,
    p_result: args.result,
    p_sub_category: args.subCategory ?? null,
  });
  if (error) throw error;
}

/** Round-robin / pool standings, with player or team names resolved. */
export async function fetchStandingsPro(tid: string, teamRule: TournamentTeamRule): Promise<TournamentStandingPro[]> {
  const { data, error } = await supabase.rpc('tournament_standings_pro', { p_tid: tid });
  if (error) throw error;
  const rows = (data ?? []) as TournamentStandingPro[];
  if (rows.length === 0) return rows;
  if (teamRule === 'none') {
    const { data: profs } = await supabase.from('profiles').select('id, display_name, belt_rank').in('id', rows.map((r) => r.user_id));
    const m = new Map((profs ?? []).map((p: any) => [p.id, p]));
    return rows.map((r) => ({ ...r, name: m.get(r.user_id)?.display_name, belt_rank: m.get(r.user_id)?.belt_rank }));
  }
  const { data: teams } = await supabase.from('tournament_teams').select('id, name').in('id', rows.map((r) => r.user_id));
  const m = new Map((teams ?? []).map((t: any) => [t.id, t.name]));
  return rows.map((r) => ({ ...r, name: m.get(r.user_id) }));
}

export const TEAM_RULE_LABEL: Record<TournamentTeamRule, string> = { none: 'Individual', duel: 'Team duel', quintet: 'Quintet' };
export const FORMAT_LABEL: Record<TournamentFormat, string> = {
  round_robin: 'Round robin', single_elim: 'Single elim', double_elim: 'Double elim', rr_playoff: 'RR + playoff',
};
