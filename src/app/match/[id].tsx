import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Animated, Pressable, StyleSheet, View } from 'react-native';

import { MatchVideos } from '@/components/match-videos';
import { ThemedText } from '@/components/themed-text';
import { Avatar, BeltChip, Button, Card, Loading, Screen, TextField } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { projectSwing } from '@/lib/elo';
import { fetchJuniors } from '@/lib/juniors';
import {
  cancelMatch,
  fetchMatch,
  fetchMatchReactions,
  fetchMatchViewCount,
  recordMatchView,
  recordResult,
  respondToMatch,
  setMatchReaction,
  setSubmissionType,
} from '@/lib/matches';
import { REACTIONS, RESULT_LABELS, SUBMISSIONS, type MatchWithPeople, type ReactionSummary, type ResultType } from '@/lib/types';

export default function MatchDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const theme = useTheme();
  const router = useRouter();
  const userId = session!.user.id;

  const [match, setMatch] = useState<MatchWithPeople | null>(null);
  const [busy, setBusy] = useState(false);
  // The viewer's own id plus any managed juniors — so a guardian can act on a
  // junior's behalf (accept/decline/cancel).
  const [myIds, setMyIds] = useState<Set<string>>(new Set([userId]));
  useEffect(() => {
    fetchJuniors(userId)
      .then((js) => setMyIds(new Set([userId, ...js.map((j) => j.id)])))
      .catch(() => {});
  }, [userId]);

  // Referee result form state (submission-only: winner, or a draw)
  const [winner, setWinner] = useState<'challenger' | 'opponent' | 'draw' | null>(null);
  const [subType, setSubType] = useState<string | null>(null);
  const [method, setMethod] = useState('');
  const [notes, setNotes] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setMatch(await fetchMatch(id));
    } catch (e) {
      console.warn('Failed to load match', e);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // Public match: record a view + load views/reactions.
  const [viewCount, setViewCount] = useState(0);
  const [reactions, setReactions] = useState<ReactionSummary>({ counts: {}, mine: null });
  useEffect(() => {
    if (!match?.is_public) return;
    (async () => {
      try {
        await recordMatchView(match.id, userId);
        const [vc, rx] = await Promise.all([
          fetchMatchViewCount(match.id),
          fetchMatchReactions(match.id, userId),
        ]);
        setViewCount(vc);
        setReactions(rx);
      } catch (e) {
        console.warn('public load failed', e);
      }
    })();
  }, [match?.is_public, match?.id, userId]);

  async function react(emoji: string) {
    if (!match) return;
    const next = reactions.mine === emoji ? null : emoji;
    try {
      await setMatchReaction(match.id, userId, next);
      setReactions(await fetchMatchReactions(match.id, userId));
    } catch (e: any) {
      Alert.alert('Could not react', e.message ?? 'Try again.');
    }
  }

  // Pot pop-in when a wagered match resolves.
  const potAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (match?.status === 'completed' && (match.wager ?? 0) > 0) {
      potAnim.setValue(0);
      Animated.spring(potAnim, { toValue: 1, useNativeDriver: true, friction: 5, tension: 120 }).start();
    }
  }, [match?.status, match?.wager, potAnim]);

  if (!match) return <Loading />;

  // "am" = me or a junior I manage (the referee is always a real logged-in user).
  const amOpponent = myIds.has(match.opponent_id);
  const amReferee = match.referee_id === userId;
  const amCompetitor = myIds.has(match.challenger_id) || amOpponent;

  async function act(fn: () => Promise<void>, successMsg?: string) {
    setBusy(true);
    try {
      await fn();
      await load();
      if (successMsg) Alert.alert('Done', successMsg);
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Try again.');
    } finally {
      setBusy(false);
    }
  }

  function confirmAccept() {
    if ((match?.wager ?? 0) > 0) {
      Alert.alert(
        'Accept the wager?',
        `You're staking ${match!.wager} Elo. Win and you take it; lose and it's gone.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Accept', onPress: () => act(() => respondToMatch(match!.id, true)) },
        ],
      );
    } else {
      act(() => respondToMatch(match!.id, true));
    }
  }

  function submitResult() {
    if (!winner) {
      Alert.alert('Incomplete', 'Pick the winner, or mark it a draw.');
      return;
    }
    const winnerId =
      winner === 'draw' ? null : winner === 'challenger' ? match!.challenger_id : match!.opponent_id;
    // Submission-only for now: a win is always by submission.
    const finalResult: ResultType = winner === 'draw' ? 'draw' : 'submission';
    act(async () => {
      await recordResult({
        matchId: match!.id,
        winnerId,
        result: finalResult,
        method: method.trim() || null,
        notes: notes.trim() || null,
      });
      if (winner !== 'draw' && subType) {
        try {
          await setSubmissionType(match!.id, subType);
        } catch {
          /* non-fatal */
        }
      }
    }, 'Result recorded and ratings updated.');
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Match' }} />

      <StatusBanner match={match} />

      {match.wager > 0 && match.status !== 'completed' && (
        <View style={[styles.banner, { backgroundColor: theme.accent + '22', flexDirection: 'row', gap: Spacing.two }]}>
          <Ionicons name="cash" size={18} color={theme.accent} />
          <ThemedText style={{ color: theme.accent, fontWeight: '800' }}>
            {match.wager} Elo wagered — winner takes it
          </ThemedText>
        </View>
      )}

      {match.status === 'completed' && match.wager > 0 && (
        <Animated.View
          style={[
            styles.banner,
            styles.potBanner,
            { backgroundColor: theme.success + '22', transform: [{ scale: potAnim }], opacity: potAnim },
          ]}>
          <Ionicons name="cash" size={22} color={theme.success} />
          <ThemedText style={{ color: theme.success, fontWeight: '800' }}>
            {(match.winner_id === match.challenger_id ? match.challenger.display_name : match.opponent.display_name)} won the {match.wager} Elo pot!
          </ThemedText>
        </Animated.View>
      )}

      {(match.status === 'pending_opponent' || match.status === 'pending_referee') && (
        <Card style={{ gap: Spacing.two }}>
          <ThemedText type="smallBold" themeColor="textSecondary">
            STAKES{match.wager > 0 ? ` · ${match.wager} wagered` : ''}
          </ThemedText>
          <StakeRow name={match.challenger.display_name} swing={projectSwing(match.challenger.rating, match.opponent.rating, match.wager)} />
          <StakeRow name={match.opponent.display_name} swing={projectSwing(match.opponent.rating, match.challenger.rating, match.wager)} />
        </Card>
      )}

      {/* Competitors */}
      <Card style={{ gap: Spacing.three }}>
        <PersonRow
          person={match.challenger}
          tag="Challenger"
          ratingBefore={match.challenger_rating_before}
          ratingAfter={match.challenger_rating_after}
          won={match.winner_id === match.challenger_id}
          isMe={match.challenger_id === userId}
        />
        <View style={styles.vsRow}>
          <View style={[styles.line, { backgroundColor: theme.border }]} />
          <ThemedText themeColor="textSecondary" style={{ fontWeight: '800' }}>
            VS
          </ThemedText>
          <View style={[styles.line, { backgroundColor: theme.border }]} />
        </View>
        <PersonRow
          person={match.opponent}
          tag="Opponent"
          ratingBefore={match.opponent_rating_before}
          ratingAfter={match.opponent_rating_after}
          won={match.winner_id === match.opponent_id}
          isMe={match.opponent_id === userId}
        />
      </Card>

      {/* Referee */}
      <Card style={styles.refCard}>
        <Avatar name={match.referee.display_name} size={36} />
        <View style={{ flex: 1 }}>
          <ThemedText type="small" themeColor="textSecondary">
            REFEREE
          </ThemedText>
          <ThemedText style={{ fontWeight: '700' }}>
            {match.referee.display_name}
            {amReferee ? ' (you)' : ''}
          </ThemedText>
        </View>
        <Ionicons name="eye-outline" size={20} color={theme.textSecondary} />
      </Card>

      {/* When & where (set in chat) */}
      {(match.meet_when || match.meet_where) && (
        <Card style={{ gap: 2 }}>
          <ThemedText type="smallBold" themeColor="textSecondary">
            WHEN &amp; WHERE
          </ThemedText>
          {match.meet_when ? <ThemedText>🕒 {match.meet_when}</ThemedText> : null}
          {match.meet_where ? <ThemedText>📍 {match.meet_where}</ThemedText> : null}
        </Card>
      )}

      {/* Chat */}
      <Button
        label="Message participants"
        variant="secondary"
        icon="chatbubbles"
        onPress={() => router.push(`/chat/${match.id}`)}
      />

      {/* Match video */}
      <MatchVideos matchId={match.id} uploaderId={userId} isParticipant={amCompetitor || amReferee} />

      {/* Public: views + reactions */}
      {match.is_public && (
        <Card style={{ gap: Spacing.two }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
            <View style={[styles.publicBadge, { backgroundColor: theme.accent }]}>
              <Ionicons name="globe" size={12} color={theme.accentText} />
              <ThemedText style={{ color: theme.accentText, fontWeight: '800', fontSize: 11 }}>PUBLIC</ThemedText>
            </View>
            <View style={{ flex: 1 }} />
            <Ionicons name="eye" size={15} color={theme.textSecondary} />
            <ThemedText type="small" themeColor="textSecondary">
              {viewCount} view{viewCount === 1 ? '' : 's'}
            </ThemedText>
          </View>
          {match.status === 'completed' ? (
            <View style={styles.reactRow}>
              {REACTIONS.map((e) => {
                const count = reactions.counts[e] ?? 0;
                const active = reactions.mine === e;
                return (
                  <Pressable
                    key={e}
                    onPress={() => react(e)}
                    style={[
                      styles.reactBtn,
                      { borderColor: active ? theme.accent : theme.border, backgroundColor: active ? theme.accent + '22' : 'transparent' },
                    ]}>
                    <ThemedText style={{ fontSize: 18 }}>{e}</ThemedText>
                    {count > 0 && (
                      <ThemedText type="small" themeColor="textSecondary">
                        {count}
                      </ThemedText>
                    )}
                  </Pressable>
                );
              })}
            </View>
          ) : (
            <ThemedText type="small" themeColor="textSecondary">
              This match will appear in Watch once the referee records the result.
            </ThemedText>
          )}
        </Card>
      )}

      {/* Completed result summary */}
      {match.status === 'completed' && match.result && (
        <Card style={{ gap: Spacing.one }}>
          <ThemedText type="smallBold" themeColor="textSecondary">
            RESULT
          </ThemedText>
          <ThemedText style={{ fontSize: 18, fontWeight: '700' }}>
            {match.result === 'draw'
              ? 'Draw'
              : `${match.winner_id === match.challenger_id ? match.challenger.display_name : match.opponent.display_name} won`}
          </ThemedText>
          <ThemedText themeColor="textSecondary">
            By {RESULT_LABELS[match.result].toLowerCase()}
            {match.method ? ` · ${match.method}` : ''}
          </ThemedText>
          {match.notes ? <ThemedText style={{ marginTop: Spacing.one }}>{match.notes}</ThemedText> : null}
        </Card>
      )}

      {/* ACTIONS */}

      {/* Opponent accept/decline */}
      {match.status === 'pending_opponent' && amOpponent && (
        <View style={{ gap: Spacing.two }}>
          <Button label="Accept challenge" icon="checkmark-circle" onPress={confirmAccept} loading={busy} />
          <Button label="Decline" variant="danger" onPress={() => act(() => respondToMatch(match.id, false))} loading={busy} />
        </View>
      )}

      {match.status === 'pending_opponent' && !amOpponent && (
        <Card style={{ alignItems: 'center' }}>
          <ThemedText themeColor="textSecondary">Waiting for {match.opponent.display_name} to accept…</ThemedText>
        </Card>
      )}

      {/* Referee records result */}
      {match.status === 'pending_referee' && amReferee && (
        <Card style={{ gap: Spacing.three }}>
          <ThemedText type="subtitle" style={{ fontSize: 18 }}>
            Record the result
          </ThemedText>

          <View style={{ gap: Spacing.one }}>
            <ThemedText type="smallBold" themeColor="textSecondary">Who won by submission?</ThemedText>
            <View style={{ gap: Spacing.two }}>
              <Choice label={`${match.challenger.display_name} (Challenger)`} selected={winner === 'challenger'} onPress={() => setWinner('challenger')} />
              <Choice label={`${match.opponent.display_name} (Opponent)`} selected={winner === 'opponent'} onPress={() => setWinner('opponent')} />
              <Choice label="Draw — no submission" selected={winner === 'draw'} onPress={() => setWinner('draw')} />
            </View>
          </View>

          {winner === 'draw' && (
            <View style={[styles.drawNote, { borderColor: theme.danger }]}>
              <Ionicons name="warning-outline" size={16} color={theme.danger} />
              <ThemedText type="small" style={{ color: theme.danger, flex: 1 }}>
                A draw deducts rating from BOTH players — same as a loss.
              </ThemedText>
            </View>
          )}

          {winner && winner !== 'draw' && (
            <View style={{ gap: Spacing.one }}>
              <ThemedText type="smallBold" themeColor="textSecondary">
                Finish (counts toward the winner&apos;s Submission Hunt)
              </ThemedText>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two }}>
                {SUBMISSIONS.map((s) => (
                  <Choice key={s} compact label={s} selected={subType === s} onPress={() => setSubType(subType === s ? null : s)} />
                ))}
              </View>
            </View>
          )}

          <TextField label="Notes (optional)" value={notes} onChangeText={setNotes} placeholder="Anything notable about the roll" multiline />

          <Button label="Submit result" icon="trophy" onPress={submitResult} loading={busy} />
        </Card>
      )}

      {match.status === 'pending_referee' && !amReferee && (
        <Card style={{ alignItems: 'center' }}>
          <ThemedText themeColor="textSecondary">
            Both accepted. Waiting for {match.referee.display_name} to record the result.
          </ThemedText>
        </Card>
      )}

      {/* Cancel option for competitors while still pending */}
      {(match.status === 'pending_opponent' || match.status === 'pending_referee') && amCompetitor && (
        <Button label="Cancel match" variant="ghost" onPress={() => act(() => cancelMatch(match.id))} loading={busy} />
      )}
    </Screen>
  );
}

function StakeRow({ name, swing }: { name: string; swing: { win: number; loss: number } }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
      <ThemedText style={{ flex: 1, fontWeight: '700' }} numberOfLines={1}>
        {name}
      </ThemedText>
      <View style={[styles.stakePill, { backgroundColor: theme.success + '22' }]}>
        <ThemedText type="small" style={{ color: theme.success, fontWeight: '800' }}>
          Win +{swing.win}
        </ThemedText>
      </View>
      <View style={[styles.stakePill, { backgroundColor: theme.danger + '22' }]}>
        <ThemedText type="small" style={{ color: theme.danger, fontWeight: '800' }}>
          Lose {swing.loss}
        </ThemedText>
      </View>
    </View>
  );
}

function StatusBanner({ match }: { match: MatchWithPeople }) {
  const theme = useTheme();
  const map: Record<string, { text: string; color: string }> = {
    pending_opponent: { text: 'Awaiting opponent', color: '#D9822B' },
    pending_referee: { text: 'Awaiting referee', color: theme.accent },
    completed: { text: 'Completed', color: theme.success },
    declined: { text: 'Declined', color: theme.textSecondary },
    cancelled: { text: 'Cancelled', color: theme.textSecondary },
  };
  const m = map[match.status];
  return (
    <View style={[styles.banner, { backgroundColor: m.color + '22' }]}>
      <ThemedText style={{ color: m.color, fontWeight: '800' }}>{m.text}</ThemedText>
    </View>
  );
}

function PersonRow({
  person,
  tag,
  ratingBefore,
  ratingAfter,
  won,
  isMe,
}: {
  person: MatchWithPeople['challenger'];
  tag: string;
  ratingBefore: number | null;
  ratingAfter: number | null;
  won: boolean;
  isMe: boolean;
}) {
  const theme = useTheme();
  const delta = ratingBefore != null && ratingAfter != null ? ratingAfter - ratingBefore : null;
  const deltaColor = delta == null ? theme.textSecondary : delta > 0 ? theme.success : delta < 0 ? theme.danger : theme.textSecondary;
  return (
    <View
      style={[
        styles.personRow,
        won && { backgroundColor: theme.success + '22', borderRadius: 10, paddingHorizontal: Spacing.two, paddingVertical: Spacing.two },
      ]}>
      <Avatar name={person.display_name} size={52} />
      <View style={{ flex: 1, gap: 3 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.one }}>
          {won && <Ionicons name="trophy" size={16} color={theme.success} />}
          <ThemedText style={{ fontWeight: '800', fontSize: 17 }} numberOfLines={1}>
            {person.display_name}{isMe ? ' (you)' : ''}
          </ThemedText>
        </View>
        <View style={{ flexDirection: 'row', gap: Spacing.two, alignItems: 'center' }}>
          <BeltChip belt={person.belt_rank} size="sm" />
          <ThemedText type="small" themeColor="textSecondary">
            {won ? 'Winner' : tag}
          </ThemedText>
        </View>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 3 }}>
        <ThemedText style={{ fontWeight: '800', fontSize: 20 }}>
          {ratingAfter ?? person.rating}
        </ThemedText>
        {delta != null && (
          <View style={[styles.deltaPill, { backgroundColor: deltaColor + '26' }]}>
            <ThemedText type="small" style={{ color: deltaColor, fontWeight: '800' }}>
              {delta > 0 ? `+${delta}` : delta}
            </ThemedText>
          </View>
        )}
      </View>
    </View>
  );
}

function Choice({
  label,
  selected,
  onPress,
  compact,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  compact?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.choice,
        compact && { flexGrow: 1, flexBasis: '45%' },
        {
          backgroundColor: selected ? theme.accent : 'transparent',
          borderColor: selected ? theme.accent : theme.border,
        },
      ]}>
      <ThemedText style={{ color: selected ? theme.accentText : theme.text, fontWeight: '700', textAlign: 'center' }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: { borderRadius: 12, paddingVertical: Spacing.two, paddingHorizontal: Spacing.three, alignItems: 'center' },
  potBanner: { flexDirection: 'row', justifyContent: 'center', gap: Spacing.two },
  stakePill: { borderRadius: 999, paddingHorizontal: Spacing.two, paddingVertical: 2 },
  publicBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, paddingHorizontal: Spacing.two, paddingVertical: 3 },
  reactRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  reactBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, borderWidth: 1, paddingHorizontal: Spacing.three, paddingVertical: Spacing.one },
  vsRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  line: { flex: 1, height: StyleSheet.hairlineWidth },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  deltaPill: { borderRadius: 999, paddingHorizontal: Spacing.two, paddingVertical: 1 },
  refCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  choice: { borderRadius: 10, borderWidth: 1, paddingVertical: Spacing.three, paddingHorizontal: Spacing.three },
  drawNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: 8,
    padding: Spacing.two,
  },
});
