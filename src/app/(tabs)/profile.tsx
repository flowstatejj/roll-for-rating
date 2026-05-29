import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { MatchRow } from '@/components/match-row';
import { ThemedText } from '@/components/themed-text';
import { Avatar, BeltChip, Button, Card, EmptyState, Loading, Screen, TextField } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { fetchMyMatches } from '@/lib/matches';
import { supabase } from '@/lib/supabase';
import { BELT_COLORS, BELT_LABELS, type BeltRank, type MatchWithPeople } from '@/lib/types';

const BELTS: BeltRank[] = ['white', 'blue', 'purple', 'brown', 'black'];

export default function ProfileScreen() {
  const { profile, session, signOut, refreshProfile } = useAuth();
  const theme = useTheme();
  const router = useRouter();
  const userId = session?.user.id;

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [belt, setBelt] = useState<BeltRank>('white');
  const [saving, setSaving] = useState(false);
  const [matches, setMatches] = useState<MatchWithPeople[]>([]);

  const loadMatches = useCallback(async () => {
    if (!userId) return;
    try {
      setMatches(await fetchMyMatches(userId));
    } catch (e) {
      console.warn('Failed to load matches', e);
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      loadMatches();
      refreshProfile();
    }, [loadMatches, refreshProfile]),
  );

  if (!profile) return <Loading />;

  function startEdit() {
    setName(profile!.display_name);
    setBelt(profile!.belt_rank);
    setEditing(true);
  }

  async function save() {
    if (!name.trim()) {
      Alert.alert('Name required', 'Enter a display name.');
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ display_name: name.trim(), belt_rank: belt })
        .eq('id', profile!.id);
      if (error) throw error;
      await refreshProfile();
      setEditing(false);
    } catch (e: any) {
      Alert.alert('Could not save', e.message ?? 'Try again.');
    } finally {
      setSaving(false);
    }
  }

  const total = profile.wins + profile.losses + profile.draws;
  const winRate = total > 0 ? Math.round((profile.wins / total) * 100) : 0;
  const drawRate = total > 0 ? Math.round((profile.draws / total) * 100) : 0;
  const memberSince = new Date(profile.created_at).toLocaleDateString(undefined, {
    month: 'short',
    year: 'numeric',
  });
  const recent = matches.slice(0, 5);

  return (
    <Screen>
      {/* Header */}
      <Card style={styles.header}>
        <Avatar name={profile.display_name} size={72} />
        <View style={{ flex: 1, gap: 4 }}>
          <ThemedText style={{ fontSize: 22, fontWeight: '800' }} numberOfLines={1}>
            {profile.display_name}
          </ThemedText>
          <ThemedText themeColor="textSecondary">@{profile.username}</ThemedText>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
            <BeltChip belt={profile.belt_rank} size="sm" />
            <ThemedText type="small" themeColor="textSecondary">
              Since {memberSince}
            </ThemedText>
          </View>
        </View>
      </Card>

      {/* Rating panel */}
      <Card style={{ backgroundColor: theme.accent }}>
        <ThemedText style={{ color: theme.accentText, opacity: 0.85, fontWeight: '700' }}>RATING</ThemedText>
        <ThemedText style={{ color: theme.accentText, fontSize: 52, fontWeight: '800', lineHeight: 56 }}>
          {profile.rating}
        </ThemedText>
        <View style={styles.recordRow}>
          <MiniStat label="Wins" value={profile.wins} tint={theme.accentText} />
          <MiniStat label="Losses" value={profile.losses} tint={theme.accentText} />
          <MiniStat label="Draws" value={profile.draws} tint={theme.accentText} />
          <MiniStat label="Win %" value={`${winRate}%`} tint={theme.accentText} />
        </View>
      </Card>

      {/* Stat grid */}
      <ThemedText style={styles.sectionLabel}>Stats</ThemedText>
      <View style={styles.grid}>
        <GridTile icon="trophy" value={profile.wins} label="Wins" />
        <GridTile icon="close-circle" value={profile.losses} label="Losses" />
        <GridTile icon="remove-circle" value={profile.draws} label="Draws" />
        <GridTile icon="pie-chart" value={`${winRate}%`} label="Win rate" />
        <GridTile icon="pie-chart-outline" value={`${drawRate}%`} label="Draw rate" />
        <GridTile icon="albums" value={total} label="Matches" />
      </View>

      {/* Match history */}
      <ThemedText style={styles.sectionLabel}>Match history</ThemedText>
      {recent.length === 0 ? (
        <EmptyState icon="time-outline" title="No matches yet" subtitle="Your completed rolls will show up here." />
      ) : (
        <Card style={{ paddingVertical: Spacing.one }}>
          {recent.map((m, i) => (
            <View key={m.id}>
              {i > 0 && <View style={[styles.divider, { backgroundColor: theme.tileBorder }]} />}
              <MatchRow match={m} currentUserId={userId!} />
            </View>
          ))}
        </Card>
      )}

      {/* Edit / actions */}
      {editing ? (
        <Card style={{ gap: Spacing.three }}>
          <TextField label="Display name" value={name} onChangeText={setName} />
          <View style={{ gap: Spacing.one }}>
            <ThemedText type="smallBold" themeColor="textSecondary">
              Belt rank
            </ThemedText>
            <View style={styles.belts}>
              {BELTS.map((b) => {
                const selected = belt === b;
                return (
                  <Pressable
                    key={b}
                    onPress={() => setBelt(b)}
                    style={[
                      styles.beltOption,
                      {
                        backgroundColor: selected ? BELT_COLORS[b] : theme.backgroundElement,
                        borderColor: selected ? BELT_COLORS[b] : theme.border,
                      },
                    ]}>
                    <ThemedText
                      style={{
                        fontWeight: '700',
                        fontSize: 13,
                        color: selected ? (b === 'white' ? '#222' : '#fff') : theme.text,
                      }}>
                      {BELT_LABELS[b]}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>
          </View>
          <Button label="Save changes" onPress={save} loading={saving} />
          <Button label="Cancel" variant="ghost" onPress={() => setEditing(false)} />
        </Card>
      ) : (
        <Button label="Edit profile" variant="secondary" icon="create-outline" onPress={startEdit} />
      )}

      <Button
        label="Import competition record"
        variant="secondary"
        icon="ribbon-outline"
        onPress={() => router.push('/competitions')}
      />

      <Button label="Sign out" variant="ghost" icon="log-out-outline" onPress={signOut} />
    </Screen>
  );
}

function MiniStat({ label, value, tint }: { label: string; value: string | number; tint: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <ThemedText style={{ color: tint, fontSize: 18, fontWeight: '800' }}>{value}</ThemedText>
      <ThemedText style={{ color: tint, opacity: 0.85, fontSize: 12 }}>{label}</ThemedText>
    </View>
  );
}

function GridTile({
  icon,
  value,
  label,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  value: string | number;
  label: string;
}) {
  const theme = useTheme();
  return (
    <Card style={styles.gridTile}>
      <Ionicons name={icon} size={20} color={theme.accent} />
      <ThemedText style={{ fontSize: 20, fontWeight: '800' }}>{value}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
    </Card>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  recordRow: { flexDirection: 'row', marginTop: Spacing.three },
  sectionLabel: { fontSize: 18, fontWeight: '800', marginTop: Spacing.one },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  gridTile: {
    flexBasis: '31%',
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingVertical: Spacing.three,
  },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: Spacing.one },
  belts: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  beltOption: { paddingVertical: Spacing.two, paddingHorizontal: Spacing.three, borderRadius: 10, borderWidth: 1 },
});
