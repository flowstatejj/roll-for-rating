import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Keyboard, Pressable, StyleSheet, Switch, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Avatar, BeltChip, Button, Card, Screen, TextField } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { projectSwing } from '@/lib/elo';
import { useTranslation } from '@/lib/i18n';
import { fetchJuniors } from '@/lib/juniors';
import { fetchLeague, linkFixtureMatch } from '@/lib/leagues';
import { createMatch, searchProfiles } from '@/lib/matches';
import { supabase } from '@/lib/supabase';
import { PROFILE_COLS, type Profile } from '@/lib/types';

type Slot = 'opponent' | 'referee';

export default function NewMatchScreen() {
  const { session, profile } = useAuth();
  const theme = useTheme();
  const router = useRouter();
  const { t } = useTranslation();
  const userId = session!.user.id;
  // You can stake at most 10% of your own ROR on a single match. Use floor to
  // match the DB cap (floor(0.10 * rating)) exactly — otherwise the "Max" chip
  // could offer a value the server then rejects.
  const maxBet = Math.max(0, Math.floor((profile?.rating ?? 0) * 0.1));

  const { opponent: opponentParam, league: leagueParam, week: weekParam } = useLocalSearchParams<{ opponent?: string; league?: string; week?: string }>();
  const inLeague = !!leagueParam;
  const leagueWeek = weekParam ? parseInt(weekParam, 10) : null;
  const [leagueName, setLeagueName] = useState<string | null>(null);
  // Who's competing: null = the signed-in user, otherwise one of their managed juniors.
  const [juniors, setJuniors] = useState<Profile[]>([]);
  const [competitor, setCompetitor] = useState<Profile | null>(null);
  const competingAsJunior = competitor !== null;
  const challengerId = competitor?.id ?? userId;
  const [opponent, setOpponent] = useState<Profile | null>(null);
  const [referee, setReferee] = useState<Profile | null>(null);
  const [active, setActive] = useState<Slot>('opponent');
  const searchRef = useRef<TextInput>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Profile[]>([]);
  const [wager, setWager] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [waiveRef, setWaiveRef] = useState(false);
  const [creating, setCreating] = useState(false);

  // Wager band: you can only stake ROR against someone within 10% of your ROR.
  const myRor = profile?.rating ?? 0;
  const bandLo = Math.round(myRor * 0.9);
  const bandHi = Math.round(myRor * 1.1);
  const opponentInBand = !opponent || Math.abs((opponent.rating ?? 0) - myRor) <= 0.1 * myRor;
  // Minors can't waive the referee (kid protections); the DB enforces this too.
  const canWaive = !profile?.is_minor && !competingAsJunior && !opponent?.is_minor;
  // ROR at stake for the chosen opponent (mismatch-damped, before any wager).
  const swing = opponent ? projectSwing(myRor, opponent.rating ?? 0, 0) : null;
  const bigGap = opponent ? Math.abs(myRor - (opponent.rating ?? 0)) > 150 : false;

  // Load any managed juniors so an adult can compete on their behalf.
  useEffect(() => {
    if (!profile || profile.is_minor) return;
    fetchJuniors(profile.id).then(setJuniors).catch((e) => console.warn('load juniors', e));
  }, [profile]);

  // Show which league this match is being logged for.
  useEffect(() => {
    if (!leagueParam) return;
    fetchLeague(leagueParam).then((l) => setLeagueName(l?.name ?? null)).catch(() => {});
  }, [leagueParam]);

  // Preselect an opponent when arriving from "Find opponents".
  useEffect(() => {
    if (!opponentParam) return;
    supabase
      .from('profiles')
      .select(PROFILE_COLS)
      .eq('id', opponentParam)
      .single()
      .then(({ data }) => {
        if (data) {
          setOpponent(data as unknown as Profile);
          setActive('referee');
        }
      });
  }, [opponentParam]);

  // Exclude the competitor (me or my junior) + whoever's chosen for the other
  // role. When a junior competes, also exclude me — a guardian can't referee
  // their own junior's match (and shouldn't be its opponent).
  const excludeIds = [
    challengerId,
    competingAsJunior ? userId : null,
    active === 'opponent' ? referee?.id : opponent?.id,
  ].filter(Boolean) as string[];

  const runSearch = useCallback(async () => {
    // Show no one until the user searches; then only the 5 best matches.
    if (!query.trim()) {
      setResults([]);
      return;
    }
    try {
      setResults((await searchProfiles(query, excludeIds)).slice(0, 5));
    } catch (e) {
      console.warn('search failed', e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, active, opponent?.id, referee?.id, challengerId, competingAsJunior]);

  // Debounced search.
  useEffect(() => {
    const t = setTimeout(runSearch, 250);
    return () => clearTimeout(t);
  }, [runSearch]);

  // Clear a staked wager if the chosen opponent falls outside the 10% ROR band.
  useEffect(() => {
    if (opponent && !opponentInBand && wager) setWager('');
  }, [opponent, opponentInBand, wager]);

  // Tapping a slot bubble both selects it and pulls up the keyboard so the
  // user can start typing immediately (the search field sits right below the
  // bubbles, so they stay in view above the keyboard).
  function focusSlot(slot: Slot) {
    setActive(slot);
    searchRef.current?.focus();
  }

  function choose(p: Profile) {
    let done: boolean;
    if (active === 'opponent') {
      setOpponent(p);
      done = !!referee || waiveRef;
      if (!done) setActive('referee');
    } else {
      setReferee(p);
      done = !!opponent;
      if (!done) setActive('opponent');
    }
    setQuery('');
    // Both slots filled — drop the keyboard so the rest of the form shows.
    if (done) Keyboard.dismiss();
  }

  async function create() {
    if (!opponent || (!waiveRef && !referee)) {
      Alert.alert(t('mn.pickBothTitle'), waiveRef ? t('mn.pickOppBody') : t('mn.pickBothBody'));
      return;
    }
    // League matches are never wagered.
    const wagerVal = inLeague || competingAsJunior ? 0 : parseInt(wager, 10) || 0;
    if (wagerVal > 0 && !opponentInBand) {
      Alert.alert(t('mn.wagerBandTitle'), t('mn.wagerBandBody').replace('{lo}', String(bandLo)).replace('{hi}', String(bandHi)));
      return;
    }
    if (wagerVal > maxBet) {
      Alert.alert(t('mn.wagerCapTitle'), t('mn.wagerCapBody').replace('{max}', String(maxBet)));
      return;
    }
    setCreating(true);
    try {
      const id = await createMatch({
        challengerId,
        opponentId: opponent.id,
        refereeId: waiveRef ? null : referee!.id,
        refereeWaived: waiveRef,
        // Juniors never wager / never publish (the DB enforces this too).
        wager: wagerVal,
        isPublic: competingAsJunior ? false : isPublic,
        leagueId: leagueParam ?? null,
        leagueWeek,
      });
      // Link this match back to its league fixture for the week.
      if (inLeague && leagueWeek != null) {
        await linkFixtureMatch(leagueParam!, leagueWeek, challengerId, opponent.id, id).catch(() => {});
      }
      router.replace(`/match/${id}`);
    } catch (e: any) {
      Alert.alert(t('mn.createFail'), e.message ?? 'Try again.');
      setCreating(false);
    }
  }

  // Gym accounts organize; they never compete (the DB blocks it too).
  if (profile?.is_gym_account) {
    return (
      <Screen>
        <Card style={{ alignItems: 'center', gap: Spacing.two }}>
          <Ionicons name="business" size={28} color={theme.accent} />
          <ThemedText style={{ fontWeight: '800', textAlign: 'center' }}>{t('gy.noChallengeTitle')}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center' }}>{t('gy.noChallengeBody')}</ThemedText>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen>
      {inLeague && (
        <Card style={styles.publicRow}>
          <Ionicons name="people-circle" size={20} color={theme.accent} />
          <ThemedText style={{ flex: 1, fontWeight: '700' }}>
            {t('mn.leagueMatch').replace('{name}', leagueName ?? '…')}
          </ThemedText>
        </Card>
      )}
      <ThemedText themeColor="textSecondary">
        {t('mn.intro')}
      </ThemedText>

      {/* Competing as — only shown when the adult manages junior(s) */}
      {juniors.length > 0 && (
        <View style={{ gap: Spacing.one }}>
          <ThemedText type="smallBold" themeColor="textSecondary">{t('mn.competingAs')}</ThemedText>
          <View style={styles.competingRow}>
            <CompetingChip label={t('mn.you')} active={!competingAsJunior} onPress={() => setCompetitor(null)} />
            {juniors.map((j) => (
              <CompetingChip
                key={j.id}
                label={j.display_name}
                active={competitor?.id === j.id}
                onPress={() => {
                  setCompetitor(j);
                  // a junior just selected can't also be the opponent/referee
                  if (opponent?.id === j.id) setOpponent(null);
                  if (referee?.id === j.id) setReferee(null);
                }}
              />
            ))}
          </View>
          {competingAsJunior && (
            <ThemedText type="small" themeColor="textSecondary">
              {t('mn.juniorNote')}
            </ThemedText>
          )}
        </View>
      )}

      <View style={styles.slots}>
        <SlotButton
          label={t('mn.opponent')}
          person={opponent}
          active={active === 'opponent'}
          onPress={() => focusSlot('opponent')}
          onClear={() => setOpponent(null)}
        />
        {!waiveRef && (
          <SlotButton
            label={t('mn.referee')}
            person={referee}
            active={active === 'referee'}
            onPress={() => focusSlot('referee')}
            onClear={() => setReferee(null)}
          />
        )}
      </View>

      {/* Search lives directly under the bubbles so both stay visible above
          the keyboard when a slot is tapped. */}
      <TextField
        ref={searchRef}
        label={active === 'opponent' ? t('mn.searchOpponent') : t('mn.searchReferee')}
        value={query}
        onChangeText={setQuery}
        autoCapitalize="none"
        placeholder={t('mn.searchPlaceholder')}
      />

      <View style={{ gap: Spacing.two }}>
        {results.map((p) => (
          <Pressable key={p.id} onPress={() => choose(p)}>
            <Card style={styles.resultRow}>
              <Avatar name={p.display_name} size={40} />
              <View style={{ flex: 1, gap: 2 }}>
                <ThemedText style={{ fontWeight: '700' }}>{p.display_name}</ThemedText>
                <View style={{ flexDirection: 'row', gap: Spacing.two, alignItems: 'center' }}>
                  <BeltChip belt={p.belt_rank} size="sm" />
                  <ThemedText type="small" themeColor="textSecondary">
                    @{p.username} · {p.rating}
                  </ThemedText>
                </View>
              </View>
              <Ionicons name="add-circle-outline" size={24} color={theme.accent} />
            </Card>
          </Pressable>
        ))}
        {results.length === 0 && (
          <ThemedText themeColor="textSecondary" style={{ textAlign: 'center', paddingVertical: Spacing.three }}>
            {query.trim() ? t('mn.noMatches') : t('mn.typeToSearch')}
          </ThemedText>
        )}
      </View>

      {/* Waive referee — adults only; minor matches always need a neutral ref */}
      {canWaive && (
        <Card style={styles.publicRow}>
          <Ionicons name="videocam-outline" size={20} color={waiveRef ? theme.accent : theme.textSecondary} />
          <View style={{ flex: 1 }}>
            <ThemedText style={{ fontWeight: '800' }}>{t('mn.waiveTitle')}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {t('mn.waiveSub')}
            </ThemedText>
          </View>
          <Switch
            value={waiveRef}
            onValueChange={(v) => {
              setWaiveRef(v);
              if (v) {
                setReferee(null);
                setActive('opponent');
              }
            }}
            trackColor={{ true: theme.accent }}
          />
        </Card>
      )}

      {opponent && swing && (
        <Card style={{ gap: 4 }}>
          <ThemedText type="smallBold" themeColor="textSecondary">{t('mn.atStake')}</ThemedText>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two, flexWrap: 'wrap' }}>
            <ThemedText style={{ fontWeight: '800', color: theme.success }}>+{swing.win} ROR</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">{t('mn.onWin')}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">·</ThemedText>
            <ThemedText style={{ fontWeight: '800', color: theme.danger }}>{swing.loss} ROR</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">{t('mn.onLoss')}</ThemedText>
          </View>
          {bigGap && (
            <ThemedText type="small" themeColor="textSecondary">{t('mn.mismatchNote')}</ThemedText>
          )}
        </Card>
      )}

      {/* Wagering is adults-only (hidden for every minor, when a junior competes, and in leagues) */}
      {!profile?.is_minor && !competingAsJunior && !inLeague && (
        opponent && !opponentInBand ? (
          <Card style={styles.publicRow}>
            <Ionicons name="information-circle-outline" size={20} color={theme.textSecondary} />
            <ThemedText type="small" themeColor="textSecondary" style={{ flex: 1 }}>
              {t('mn.wagerOutOfBand').replace('{lo}', String(bandLo)).replace('{hi}', String(bandHi))}
            </ThemedText>
          </Card>
        ) : (
          <>
            <TextField
              label={t('mn.wagerLabel')}
              value={wager}
              onChangeText={setWager}
              keyboardType="number-pad"
              placeholder={t('mn.wagerPlaceholder')}
            />
            <View style={styles.wagerChips}>
              {['25', '50', '100'].filter((v) => Number(v) <= maxBet).map((v) => (
                <WagerChip key={v} label={v} active={wager === v} onPress={() => setWager(v)} />
              ))}
              <WagerChip label={`${t('mn.maxBet')} (${maxBet})`} active={wager === String(maxBet)} onPress={() => setWager(String(maxBet))} />
              <WagerChip label={t('mn.none')} active={wager === '' || wager === '0'} onPress={() => setWager('')} />
            </View>
            <ThemedText type="small" themeColor="textSecondary">
              {t('mn.wagerExplain')} {t('mn.wagerCapHint').replace('{max}', String(maxBet))} {t('mn.wagerBandHint').replace('{lo}', String(bandLo)).replace('{hi}', String(bandHi))}
            </ThemedText>
          </>
        )
      )}

      {/* Public publishing — hidden for under-14 (kids) and for junior matches */}
      {profile?.age_tier !== 'kid' && !competingAsJunior && (
        <Card style={styles.publicRow}>
          <Ionicons name="globe-outline" size={20} color={isPublic ? theme.accent : theme.textSecondary} />
          <View style={{ flex: 1 }}>
            <ThemedText style={{ fontWeight: '800' }}>{t('mn.publishTitle')}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {t('mn.publishSub')}
            </ThemedText>
          </View>
          <Switch value={isPublic} onValueChange={setIsPublic} trackColor={{ true: theme.accent }} />
        </Card>
      )}

      {profile?.is_minor && profile.consent_status !== 'verified' && (
        <Card style={styles.publicRow}>
          <Ionicons name="lock-closed" size={20} color={theme.textSecondary} />
          <ThemedText type="small" themeColor="textSecondary" style={{ flex: 1 }}>
            {t('mn.pendingConsent')}
          </ThemedText>
        </Card>
      )}

      <Button
        label={t('mn.send')}
        icon="send"
        onPress={create}
        loading={creating}
        disabled={!opponent || (!waiveRef && !referee) || (!!profile?.is_minor && profile.consent_status !== 'verified')}
      />
    </Screen>
  );
}

function CompetingChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.competingChip,
        { backgroundColor: active ? theme.accent : theme.tile, borderColor: active ? theme.accent : theme.tileBorder },
      ]}>
      <ThemedText style={{ color: active ? theme.accentText : theme.text, fontWeight: '700', fontSize: 13 }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

function WagerChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.wagerChip,
        { backgroundColor: active ? theme.accent : theme.tile, borderColor: active ? theme.accent : theme.tileBorder },
      ]}>
      <ThemedText style={{ color: active ? theme.accentText : theme.text, fontWeight: '700', fontSize: 13 }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

function SlotButton({
  label,
  person,
  active,
  onPress,
  onClear,
}: {
  label: string;
  person: Profile | null;
  active: boolean;
  onPress: () => void;
  onClear: () => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  return (
    <Pressable onPress={onPress} style={{ flex: 1 }}>
      <Card
        style={{
          borderColor: active ? theme.accent : theme.border,
          borderWidth: active ? 1.5 : StyleSheet.hairlineWidth,
          minHeight: 96,
          justifyContent: 'center',
        }}>
        <ThemedText type="small" themeColor="textSecondary">
          {label}
        </ThemedText>
        {person ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginTop: Spacing.one }}>
            <Avatar name={person.display_name} size={28} />
            <View style={{ flex: 1 }}>
              <ThemedText style={{ fontWeight: '700' }} numberOfLines={1}>
                {person.display_name}
              </ThemedText>
            </View>
            <Ionicons name="close-circle" size={20} color={theme.textSecondary} onPress={onClear} />
          </View>
        ) : (
          <ThemedText style={{ marginTop: Spacing.one, color: theme.textSecondary }}>{t('mn.tapToChoose')}</ThemedText>
        )}
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  slots: { flexDirection: 'row', gap: Spacing.two },
  competingRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  competingChip: { paddingVertical: Spacing.two, paddingHorizontal: Spacing.three, borderRadius: 999, borderWidth: 1 },
  wagerChips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  wagerChip: { paddingVertical: Spacing.two, paddingHorizontal: Spacing.three, borderRadius: 999, borderWidth: 1 },
  publicRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
});
