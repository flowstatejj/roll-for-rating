import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Animated, Pressable, StyleSheet, View } from 'react-native';

import { MatchVideos } from '@/components/match-videos';
import { ThemedText } from '@/components/themed-text';
import { Avatar, BeltChip, Button, Card, Loading, Screen, TextField } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { projectSwing } from '@/lib/elo';
import { cancelMatch, fetchMatch, recordResult, respondToMatch } from '@/lib/matches';
import { RESULT_LABELS, type MatchWithPeople, type ResultType } from '@/lib/types';

export default function MatchDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const theme = useTheme();
  const userId = session!.user.id;

  const [match, setMatch] = useState<MatchWithPeople | null>(null);
  const [busy, setBusy] = useState(false);

  // Referee result form state (submission-only: winner, or a draw)
  const [winner, setWinner] = useState<'challenger' | 'opponent' | 'draw' | null>(null);
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

  // Pot pop-in when a wagered match resolves.
  const potAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (match?.status === 'completed' && (match.wager ?? 0) > 0) {
      potAnim.setValue(0);
      Animated.spring(potAnim, { toValue: 1, useNativeDriver: true, friction: 5, tension: 120 }).start();
    }
  }, [match?.status, match?.wager, potAnim]);

  if (!match) return <Loading />;

  const amOpponent = match.opponent_id === userId;
  const amReferee = match.referee_id === userId;
  const amCompetitor = match.challenger_id === userId || amOpponent;

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
    act(
      () =>
        recordResult({
          matchId: match!.id,
          winnerId,
          result: finalResult,
          method: method.trim() || null,
          notes: notes.trim() || null,
        }),
      'Result recorded and ratings updated.',
    );
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
          isMe={amOpponent}
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

      {/* Match video */}
      <MatchVideos matchId={match.id} uploaderId={userId} isParticipant={amCompetitor || amReferee} />

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
            <TextField label="Submission (optional)" value={method} onChangeText={setMethod} placeholder="e.g. Rear naked choke" />
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
