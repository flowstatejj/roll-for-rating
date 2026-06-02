import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { BeltChip, Card } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/lib/i18n';
import { type MatchStatus, type MatchWithPeople } from '@/lib/types';

function statusMeta(status: MatchStatus, theme: ReturnType<typeof useTheme>, t: (k: string) => string) {
  switch (status) {
    case 'pending_opponent':
      return { label: t('md.statusPendingOpponent'), color: '#D9822B' };
    case 'pending_referee':
      return { label: t('md.statusPendingReferee'), color: theme.accent };
    case 'completed':
      return { label: t('md.statusCompleted'), color: theme.success };
    case 'declined':
      return { label: t('md.statusDeclined'), color: theme.textSecondary };
    case 'cancelled':
      return { label: t('md.statusCancelled'), color: theme.textSecondary };
  }
}

export function MatchCard({ match, currentUserId }: { match: MatchWithPeople; currentUserId: string }) {
  const theme = useTheme();
  const router = useRouter();
  const { t } = useTranslation();
  const meta = statusMeta(match.status, theme, t);

  // What's my role, and does this match need ME to do something?
  const isOpponentPending = match.status === 'pending_opponent' && match.opponent_id === currentUserId;
  const isRefPending = match.status === 'pending_referee' && match.referee_id === currentUserId;
  const needsMe = isOpponentPending || isRefPending;

  const challengerWon = match.winner_id === match.challenger_id;
  const opponentWon = match.winner_id === match.opponent_id;

  return (
    <Pressable onPress={() => router.push(`/match/${match.id}`)}>
      <Card style={needsMe ? { borderColor: theme.accent, borderWidth: 1.5 } : undefined}>
        <View style={styles.topRow}>
          <View style={[styles.badge, { backgroundColor: meta.color + '22' }]}>
            <ThemedText style={{ color: meta.color, fontWeight: '700', fontSize: 12 }}>
              {meta.label}
            </ThemedText>
          </View>
          {needsMe && (
            <View style={[styles.badge, { backgroundColor: theme.accent }]}>
              <ThemedText style={{ color: theme.accentText, fontWeight: '700', fontSize: 12 }}>
                {isOpponentPending ? t('mc.respond') : t('mc.recordResult')}
              </ThemedText>
            </View>
          )}
        </View>

        <View style={styles.competitors}>
          <Competitor
            name={match.challenger.display_name}
            belt={match.challenger.belt_rank}
            won={match.status === 'completed' && challengerWon}
            align="flex-start"
          />
          <ThemedText themeColor="textSecondary" style={{ fontWeight: '700' }}>
            vs
          </ThemedText>
          <Competitor
            name={match.opponent.display_name}
            belt={match.opponent.belt_rank}
            won={match.status === 'completed' && opponentWon}
            align="flex-end"
          />
        </View>

        <View style={styles.footer}>
          <View style={styles.refRow}>
            <Ionicons name="eye-outline" size={14} color={theme.textSecondary} />
            <ThemedText type="small" themeColor="textSecondary">
              {t('mc.ref')}: {match.referee.display_name}
            </ThemedText>
          </View>
          {match.status === 'completed' && match.result && (
            <ThemedText type="small" themeColor="textSecondary">
              {match.result === 'draw' ? t('md.draw') : t(`result.${match.result}`)}
              {match.method ? ` · ${match.method}` : ''}
            </ThemedText>
          )}
        </View>
      </Card>
    </Pressable>
  );
}

function Competitor({
  name,
  belt,
  won,
  align,
}: {
  name: string;
  belt: MatchWithPeople['challenger']['belt_rank'];
  won: boolean;
  align: 'flex-start' | 'flex-end';
}) {
  const theme = useTheme();
  return (
    <View style={{ flex: 1, alignItems: align, gap: 2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.one }}>
        {won && <Ionicons name="trophy" size={14} color={theme.success} />}
        <ThemedText style={{ fontWeight: won ? '800' : '600' }} numberOfLines={1}>
          {name}
        </ThemedText>
      </View>
      <BeltChip belt={belt} size="sm" />
    </View>
  );
}

const styles = StyleSheet.create({
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.three },
  badge: { borderRadius: 999, paddingHorizontal: Spacing.two, paddingVertical: 3 },
  competitors: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: Spacing.three,
    flexWrap: 'wrap',
    gap: Spacing.one,
  },
  refRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
});
