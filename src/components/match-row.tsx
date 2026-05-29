import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Avatar } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { MatchStatus, MatchWithPeople } from '@/lib/types';

function pendingLabel(status: MatchStatus): string {
  switch (status) {
    case 'pending_opponent':
      return 'Pending';
    case 'pending_referee':
      return 'Awaiting ref';
    case 'declined':
      return 'Declined';
    case 'cancelled':
      return 'Cancelled';
    default:
      return '';
  }
}

/**
 * chess.com "Game History"-style compact row, shown from the current user's
 * perspective. Competitors see their opponent + win/loss + rating change;
 * referees see the two competitors.
 */
export function MatchRow({ match, currentUserId }: { match: MatchWithPeople; currentUserId: string }) {
  const theme = useTheme();
  const router = useRouter();

  const meChallenger = match.challenger_id === currentUserId;
  const meOpponent = match.opponent_id === currentUserId;
  const meCompetitor = meChallenger || meOpponent;
  const other = meChallenger ? match.opponent : match.challenger; // the other competitor

  // Result + rating delta from my perspective.
  let outcome: 'win' | 'loss' | 'draw' | null = null;
  let delta: number | null = null;
  if (match.status === 'completed') {
    if (match.result === 'draw') outcome = 'draw';
    else if (meCompetitor) outcome = match.winner_id === currentUserId ? 'win' : 'loss';

    if (meChallenger && match.challenger_rating_after != null && match.challenger_rating_before != null) {
      delta = match.challenger_rating_after - match.challenger_rating_before;
    } else if (meOpponent && match.opponent_rating_after != null && match.opponent_rating_before != null) {
      delta = match.opponent_rating_after - match.opponent_rating_before;
    }
  }

  const badgeColor =
    outcome === 'win' ? theme.success : outcome === 'loss' ? theme.danger : theme.textSecondary;
  const badgeSymbol = outcome === 'win' ? '+' : outcome === 'loss' ? '−' : '=';

  // Left label: opponent (competitor view) or "A vs B" (referee view).
  const title = meCompetitor ? other.display_name : `${match.challenger.display_name} vs ${match.opponent.display_name}`;
  const subtitle = meCompetitor
    ? `${other.rating}`
    : `Refereed`;
  const avatarName = meCompetitor ? other.display_name : match.challenger.display_name;

  return (
    <Pressable onPress={() => router.push(`/match/${match.id}`)} style={styles.row}>
      <Avatar name={avatarName} size={36} />
      <View style={{ flex: 1, gap: 1 }}>
        <ThemedText style={{ fontWeight: '700' }} numberOfLines={1}>
          {title}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {meCompetitor ? `Rating ${subtitle}` : subtitle}
        </ThemedText>
      </View>

      {match.status === 'completed' ? (
        <View style={styles.resultSide}>
          {outcome && (
            <View style={[styles.badge, { backgroundColor: badgeColor }]}>
              <ThemedText style={{ color: '#fff', fontWeight: '900', fontSize: 16, lineHeight: 18 }}>
                {badgeSymbol}
              </ThemedText>
            </View>
          )}
          {delta != null && (
            <ThemedText type="small" style={{ color: badgeColor, fontWeight: '700', minWidth: 34, textAlign: 'right' }}>
              {delta > 0 ? `+${delta}` : delta}
            </ThemedText>
          )}
        </View>
      ) : (
        <View style={[styles.pendingPill, { borderColor: theme.border }]}>
          <ThemedText type="small" themeColor="textSecondary" style={{ fontWeight: '700' }}>
            {pendingLabel(match.status)}
          </ThemedText>
        </View>
      )}
      <Ionicons name="chevron-forward" size={16} color={theme.textSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.two },
  resultSide: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  badge: { width: 24, height: 24, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  pendingPill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: Spacing.two, paddingVertical: 2 },
});
