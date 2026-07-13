import { supabase } from './supabase';
import { BELT_LABELS } from './types';
import { kgToLbs } from './weight';
import type {
  BeltRank,
  EligibleDivision,
  GymPower,
  Tournament,
  TournamentBout,
  TournamentDivision,
  TournamentFormat,
  TournamentMat,
  TournamentStanding,
  TournamentStandingPro,
  TournamentTeam,
  TournamentTeamBuild,
  TournamentTeamRule,
  TournamentScoring,
  TournamentRulesetPreset,
  ResultType,
  SentInvite,
} from './types';

// Federation presets seed the create form's scoring defaults ('custom' seeds
// nothing - the host sets everything). A later slice adds each federation's
// standard weight classes + age brackets as auto-generated divisions.
export interface RulesetDefaults {
  scoring: TournamentScoring;
  winPoints: number; drawPoints: number; lossPoints: number;
  subKillBonus: number; subBreakBonus: number;
}
export const RULESET_PRESETS: Record<Exclude<TournamentRulesetPreset, 'custom'>, RulesetDefaults> = {
  ibjjf:                { scoring: 'points', winPoints: 3, drawPoints: 1, lossPoints: 0, subKillBonus: 0, subBreakBonus: 0 },
  naga:                 { scoring: 'points', winPoints: 3, drawPoints: 1, lossPoints: 0, subKillBonus: 0, subBreakBonus: 0 },
  adcc:                 { scoring: 'points', winPoints: 3, drawPoints: 1, lossPoints: 0, subKillBonus: 0, subBreakBonus: 0 },
  // Grappling Industries runs round-robin and rewards finishes; nudge sub bonuses up.
  grappling_industries: { scoring: 'points', winPoints: 3, drawPoints: 1, lossPoints: 0, subKillBonus: 1, subBreakBonus: 1 },
};

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
  // Cap the browse list (newest first) so it can't download every tournament
  // ever created at scale; add paging later if needed.
  let q = supabase.from('tournaments').select('*').order('starts_at', { ascending: false }).limit(100);
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
  scoring: TournamentScoring;
  rulesetPreset: TournamentRulesetPreset;
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
      scoring: args.scoring,
      ruleset_preset: args.rulesetPreset,
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

// ---------------------------------------------------------------------------
// Divisions — belt/age/weight/gender/rating brackets inside a tournament.
// Weight bounds are canonical KG in the DB; the app converts lbs<->kg (lib/weight).
// ---------------------------------------------------------------------------
function numOrNull(v: unknown): number | null {
  return v == null ? null : Number(v);
}

// One range like "70-80", "70+" (min only), or "-80" (max only); empty when both
// bounds are null. `suffix` (e.g. a weight unit) is appended when there is a range.
function fmtRange(lo: number | null, hi: number | null, suffix = ''): string {
  if (lo != null && hi != null) return lo === hi ? `${lo}${suffix}` : `${lo}-${hi}${suffix}`;
  if (lo != null) return `${lo}+${suffix}`;
  if (hi != null) return `-${hi}${suffix}`;
  return '';
}

/**
 * Human summary of a division's filters, e.g. "Blue-Purple, 30-39, 70-80kg,
 * Male, 1200-1600". Weight is echoed in the host's chosen unit (weight_unit).
 * Callers pass already-translated words for the open/all/gender pieces so this
 * stays free of the i18n layer. Belt names use the app's English BELT_LABELS.
 */
export function divisionSummary(
  d: TournamentDivision,
  labels: { open: string; all: string; male: string; female: string; gi: string; nogi: string },
): string {
  // Ruleset (Gi/No-Gi) leads the summary since it separates brackets and weight
  // tables; 'any' is left unlabelled (the event does not split by ruleset).
  const rs = d.ruleset === 'gi' ? labels.gi : d.ruleset === 'nogi' ? labels.nogi : null;
  if (d.open) return rs ? `${rs} · ${labels.open}` : labels.open;
  const parts: string[] = [];
  const bl = d.belt_min ? BELT_LABELS[d.belt_min] : null;
  const bh = d.belt_max ? BELT_LABELS[d.belt_max] : null;
  if (bl && bh) parts.push(bl === bh ? bl : `${bl}-${bh}`);
  else if (bl) parts.push(`${bl}+`);
  else if (bh) parts.push(`-${bh}`);
  if (d.age_min != null || d.age_max != null) parts.push(fmtRange(d.age_min, d.age_max));
  if (d.weight_min_kg != null || d.weight_max_kg != null) {
    const conv = (kg: number) => Math.round(d.weight_unit === 'lbs' ? kgToLbs(kg) : kg);
    const lo = d.weight_min_kg != null ? conv(d.weight_min_kg) : null;
    const hi = d.weight_max_kg != null ? conv(d.weight_max_kg) : null;
    parts.push(fmtRange(lo, hi, d.weight_unit));
  }
  if (d.gender === 'male') parts.push(labels.male);
  else if (d.gender === 'female') parts.push(labels.female);
  if (d.rating_min != null || d.rating_max != null) parts.push(fmtRange(d.rating_min, d.rating_max));
  const body = parts.length ? parts.join(', ') : labels.all;
  return rs ? `${rs} · ${body}` : body;
}

/** All divisions for a tournament (any authenticated user). */
export async function fetchDivisions(tid: string): Promise<TournamentDivision[]> {
  const { data, error } = await supabase.rpc('tournament_divisions_list', { p_tid: tid });
  if (error) throw error;
  return ((data ?? []) as any[]).map((d) => ({
    id: d.id,
    name: d.name,
    ruleset: (d.ruleset ?? 'any') as 'gi' | 'nogi' | 'any',
    belt_min: d.belt_min ?? null,
    belt_max: d.belt_max ?? null,
    age_min: numOrNull(d.age_min),
    age_max: numOrNull(d.age_max),
    weight_min_kg: numOrNull(d.weight_min_kg),
    weight_max_kg: numOrNull(d.weight_max_kg),
    weight_unit: (d.weight_unit ?? 'lbs') as 'lbs' | 'kg',
    rating_min: numOrNull(d.rating_min),
    rating_max: numOrNull(d.rating_max),
    gender: (d.gender ?? 'any') as 'any' | 'male' | 'female',
    format: (d.format ?? null) as TournamentFormat | null,
    open: !!d.open,
    status: d.status ?? 'setup',
    entrant_count: Number(d.entrant_count ?? 0),
  }));
}

/** Host creates a division. Weight bounds are passed as canonical KG. */
export async function createDivision(args: {
  tid: string;
  name: string;
  beltMin?: BeltRank | null;
  beltMax?: BeltRank | null;
  ageMin?: number | null;
  ageMax?: number | null;
  weightMinKg?: number | null;
  weightMaxKg?: number | null;
  weightUnit?: 'lbs' | 'kg';
  ratingMin?: number | null;
  ratingMax?: number | null;
  gender?: 'any' | 'male' | 'female';
  format?: TournamentFormat | null;
  open?: boolean;
  ruleset?: 'gi' | 'nogi' | 'any';
}): Promise<string> {
  const { data, error } = await supabase.rpc('create_division', {
    p_tid: args.tid,
    p_name: args.name.trim(),
    p_belt_min: args.beltMin ?? null,
    p_belt_max: args.beltMax ?? null,
    p_age_min: args.ageMin ?? null,
    p_age_max: args.ageMax ?? null,
    p_wmin_kg: args.weightMinKg ?? null,
    p_wmax_kg: args.weightMaxKg ?? null,
    p_weight_unit: args.weightUnit ?? 'lbs',
    p_rating_min: args.ratingMin ?? null,
    p_rating_max: args.ratingMax ?? null,
    p_gender: args.gender ?? 'any',
    p_format: args.format ?? null,
    p_open: args.open ?? false,
    p_ruleset: args.ruleset ?? 'any',
  });
  if (error) throw error;
  return data as string;
}

/** Host deletes a division. */
export async function deleteDivision(divisionId: string): Promise<void> {
  const { error } = await supabase.rpc('delete_division', { p_division: divisionId });
  if (error) throw error;
}

/** Divisions the signed-in competitor could join, with computed eligibility. */
export async function fetchEligibleDivisions(tid: string): Promise<EligibleDivision[]> {
  const { data, error } = await supabase.rpc('eligible_divisions', { p_tid: tid });
  if (error) throw error;
  return ((data ?? []) as any[]).map((d) => ({
    division_id: d.division_id,
    name: d.name,
    gender: (d.gender ?? 'any') as 'any' | 'male' | 'female',
    weight_unit: (d.weight_unit ?? 'lbs') as 'lbs' | 'kg',
    open: !!d.open,
    eligible: !!d.eligible,
    already: !!d.already,
    note: d.note ?? 'ineligible',
    fit: {
      belt: !!d.fit?.belt,
      age: !!d.fit?.age,
      weight: !!d.fit?.weight,
      rating: !!d.fit?.rating,
      gender: !!d.fit?.gender,
    },
  }));
}

/**
 * Competitor self-registers into a division. `weightLbs`/`gender` fill any
 * missing profile fields (never overwriting an existing value with null).
 */
export async function registerDivision(
  divisionId: string,
  opts: { weightLbs?: number | null; gender?: 'male' | 'female' | null } = {},
): Promise<{ ok: boolean; reason: string }> {
  const { data, error } = await supabase.rpc('register_division', {
    p_division: divisionId,
    p_weight_lbs: opts.weightLbs ?? null,
    p_gender: opts.gender ?? null,
  });
  if (error) throw error;
  const r = (data ?? {}) as { ok?: boolean; reason?: string };
  return { ok: !!r.ok, reason: r.reason ?? 'ineligible' };
}

/** Host force-adds an entrant to a division (bypasses eligibility). */
export async function addDivisionEntrant(divisionId: string, userId: string): Promise<void> {
  const { error } = await supabase.rpc('add_division_entrant', { p_division: divisionId, p_user: userId });
  if (error) throw error;
}

/** Host removes an entrant from a division (leaves the tournament entrant row). */
export async function removeDivisionEntrant(divisionId: string, userId: string): Promise<void> {
  const { error } = await supabase.rpc('remove_division_entrant', { p_division: divisionId, p_user: userId });
  if (error) throw error;
}
