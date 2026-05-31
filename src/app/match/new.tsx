import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Switch, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Avatar, BeltChip, Button, Card, Screen, TextField } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { fetchJuniors } from '@/lib/juniors';
import { createMatch, searchProfiles } from '@/lib/matches';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/lib/types';

type Slot = 'opponent' | 'referee';

export default function NewMatchScreen() {
  const { session, profile } = useAuth();
  const theme = useTheme();
  const router = useRouter();
  const userId = session!.user.id;
  const allIn = Math.max(0, (profile?.rating ?? 0) - 100);

  const { opponent: opponentParam } = useLocalSearchParams<{ opponent?: string }>();
  // Who's competing: null = the signed-in user, otherwise one of their managed juniors.
  const [juniors, setJuniors] = useState<Profile[]>([]);
  const [competitor, setCompetitor] = useState<Profile | null>(null);
  const competingAsJunior = competitor !== null;
  const challengerId = competitor?.id ?? userId;
  const [opponent, setOpponent] = useState<Profile | null>(null);
  const [referee, setReferee] = useState<Profile | null>(null);
  const [active, setActive] = useState<Slot>('opponent');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Profile[]>([]);
  const [wager, setWager] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [creating, setCreating] = useState(false);

  // Load any managed juniors so an adult can compete on their behalf.
  useEffect(() => {
    if (!profile || profile.is_minor) return;
    fetchJuniors(profile.id).then(setJuniors).catch((e) => console.warn('load juniors', e));
  }, [profile]);

  // Preselect an opponent when arriving from "Find opponents".
  useEffect(() => {
    if (!opponentParam) return;
    supabase
      .from('profiles')
      .select('*')
      .eq('id', opponentParam)
      .single()
      .then(({ data }) => {
        if (data) {
          setOpponent(data as Profile);
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
    try {
      setResults(await searchProfiles(query, excludeIds));
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

  function choose(p: Profile) {
    if (active === 'opponent') {
      setOpponent(p);
      if (!referee) setActive('referee');
    } else {
      setReferee(p);
      if (!opponent) setActive('opponent');
    }
    setQuery('');
  }

  async function create() {
    if (!opponent || !referee) {
      Alert.alert('Pick both', 'Choose an opponent and a referee first.');
      return;
    }
    setCreating(true);
    try {
      const id = await createMatch({
        challengerId,
        opponentId: opponent.id,
        refereeId: referee.id,
        // Juniors never wager / never publish (the DB enforces this too).
        wager: competingAsJunior ? 0 : parseInt(wager, 10) || 0,
        isPublic: competingAsJunior ? false : isPublic,
      });
      router.replace(`/match/${id}`);
    } catch (e: any) {
      Alert.alert('Could not create match', e.message ?? 'Try again.');
      setCreating(false);
    }
  }

  return (
    <Screen>
      <ThemedText themeColor="textSecondary">
        Pick who you&apos;re rolling against and who&apos;s refereeing. Both must accept/record for ratings to count.
      </ThemedText>

      {/* Competing as — only shown when the adult manages junior(s) */}
      {juniors.length > 0 && (
        <View style={{ gap: Spacing.one }}>
          <ThemedText type="smallBold" themeColor="textSecondary">Competing as</ThemedText>
          <View style={styles.competingRow}>
            <CompetingChip label="You" active={!competingAsJunior} onPress={() => setCompetitor(null)} />
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
              Setting up a match for {competitor?.display_name}. No wager, not public, opponent must be
              under 18, and you can&apos;t be the referee.
            </ThemedText>
          )}
        </View>
      )}

      <View style={styles.slots}>
        <SlotButton
          label="Opponent"
          person={opponent}
          active={active === 'opponent'}
          onPress={() => setActive('opponent')}
          onClear={() => setOpponent(null)}
        />
        <SlotButton
          label="Referee"
          person={referee}
          active={active === 'referee'}
          onPress={() => setActive('referee')}
          onClear={() => setReferee(null)}
        />
      </View>

      <TextField
        label={`Search for ${active === 'opponent' ? 'an opponent' : 'a referee'}`}
        value={query}
        onChangeText={setQuery}
        autoCapitalize="none"
        placeholder="Name or @username"
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
            No matching grapplers.
          </ThemedText>
        )}
      </View>

      {/* Wagering is adults-only (hidden for every minor, and when a junior competes) */}
      {!profile?.is_minor && !competingAsJunior && (
        <>
          <TextField
            label="Wager (optional)"
            value={wager}
            onChangeText={setWager}
            keyboardType="number-pad"
            placeholder="Extra Elo staked — winner takes it"
          />
          <View style={styles.wagerChips}>
            {['25', '50', '100'].map((v) => (
              <WagerChip key={v} label={v} active={wager === v} onPress={() => setWager(v)} />
            ))}
            <WagerChip label={`All-in (${allIn})`} active={wager === String(allIn)} onPress={() => setWager(String(allIn))} />
            <WagerChip label="None" active={wager === '' || wager === '0'} onPress={() => setWager('')} />
          </View>
          <ThemedText type="small" themeColor="textSecondary">
            On a decisive result the winner takes the wagered rating from the loser, on top of normal Elo. Accepting the
            challenge means agreeing to the wager.
          </ThemedText>
        </>
      )}

      {/* Public publishing — hidden for under-14 (kids) and for junior matches */}
      {profile?.age_tier !== 'kid' && !competingAsJunior && (
        <Card style={styles.publicRow}>
          <Ionicons name="globe-outline" size={20} color={isPublic ? theme.accent : theme.textSecondary} />
          <View style={{ flex: 1 }}>
            <ThemedText style={{ fontWeight: '800' }}>Publish publicly</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              If both fighters agree, the match shows in Watch for everyone to view &amp; react.
            </ThemedText>
          </View>
          <Switch value={isPublic} onValueChange={setIsPublic} trackColor={{ true: theme.accent }} />
        </Card>
      )}

      {profile?.is_minor && profile.consent_status !== 'verified' && (
        <Card style={styles.publicRow}>
          <Ionicons name="lock-closed" size={20} color={theme.textSecondary} />
          <ThemedText type="small" themeColor="textSecondary" style={{ flex: 1 }}>
            Your account is waiting for a parent/guardian to approve it. You can set up a match once it&apos;s approved.
          </ThemedText>
        </Card>
      )}

      <Button
        label="Send challenge"
        icon="send"
        onPress={create}
        loading={creating}
        disabled={!opponent || !referee || (!!profile?.is_minor && profile.consent_status !== 'verified')}
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
          <ThemedText style={{ marginTop: Spacing.one, color: theme.textSecondary }}>Tap to choose</ThemedText>
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
