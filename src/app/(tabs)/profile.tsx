import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Switch, View } from 'react-native';

import { MatchRow } from '@/components/match-row';
import { ThemedText } from '@/components/themed-text';
import { Avatar, BeltChip, Button, Card, EmptyState, Loading, Screen, TextField } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { computeAchievements } from '@/lib/achievements';
import { useAuth } from '@/lib/auth';
import { deleteAccount } from '@/lib/account';
import { requestParentConsent } from '@/lib/consent';
import { winStreak } from '@/lib/elo';
import { fetchMyMatches } from '@/lib/matches';
import { fetchPuzzleStats } from '@/lib/puzzles';
import { setOpenForChallenge } from '@/lib/social';
import { supabase } from '@/lib/supabase';
import { tierFor } from '@/lib/tiers';
import { fetchChampions, heldTitles, type Champion } from '@/lib/titles';
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
  const [city, setCity] = useState('');
  const [saving, setSaving] = useState(false);
  const [togglingOpen, setTogglingOpen] = useState(false);
  const [sendingConsent, setSendingConsent] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [matches, setMatches] = useState<MatchWithPeople[]>([]);
  const [solved, setSolved] = useState(0);
  const [champions, setChampions] = useState<Champion[]>([]);

  async function toggleOpen(value: boolean) {
    if (!userId) return;
    setTogglingOpen(true);
    try {
      await setOpenForChallenge(userId, value);
      await refreshProfile();
    } catch (e: any) {
      Alert.alert('Could not update', e.message ?? 'Try again.');
    } finally {
      setTogglingOpen(false);
    }
  }

  async function doDeleteAccount() {
    setDeleting(true);
    try {
      await deleteAccount(); // signs out on success; auth state routes to sign-in
    } catch (e: any) {
      Alert.alert('Could not delete', e.message ?? 'Try again later.');
    } finally {
      setDeleting(false);
    }
  }

  function confirmDeleteAccount() {
    Alert.alert(
      'Delete account?',
      'This permanently deletes your account, profile, matches, and stats. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () =>
            Alert.alert('Are you sure?', 'Last chance — this is permanent.', [
              { text: 'Keep my account', style: 'cancel' },
              { text: 'Delete forever', style: 'destructive', onPress: doDeleteAccount },
            ]),
        },
      ],
    );
  }

  async function resendConsent() {
    setSendingConsent(true);
    try {
      const res = await requestParentConsent();
      if (res.alreadyVerified) {
        Alert.alert('Already approved', 'This account has already been approved.');
        await refreshProfile();
      } else if (res.sent) {
        Alert.alert('Email sent', `We've emailed the approval link to ${res.parent_email ?? 'your parent/guardian'}.`);
      } else if (res.link) {
        // No email provider configured yet — let the user share the link directly.
        Alert.alert(
          'Approval link',
          `Email sending isn't set up yet. Send this link to your parent/guardian to approve the account:\n\n${res.link}`,
        );
      } else {
        Alert.alert('Hmm', 'Could not start the approval. Try again later.');
      }
    } catch (e: any) {
      Alert.alert('Could not send', e.message ?? 'Try again later.');
    } finally {
      setSendingConsent(false);
    }
  }

  const loadMatches = useCallback(async () => {
    if (!userId) return;
    try {
      const [ms, ps] = await Promise.all([fetchMyMatches(userId), fetchPuzzleStats(userId)]);
      setMatches(ms);
      setSolved(ps.solved);
    } catch (e) {
      console.warn('Failed to load profile data', e);
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      loadMatches();
      refreshProfile();
    }, [loadMatches, refreshProfile]),
  );

  // Champion titles depend on rating/gym/city/belt.
  useEffect(() => {
    if (!profile) return;
    fetchChampions(profile).then(setChampions).catch(() => {});
  }, [profile?.rating, profile?.gym_id, profile?.city, profile?.belt_rank]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!profile) return <Loading />;

  function startEdit() {
    setName(profile!.display_name);
    setBelt(profile!.belt_rank);
    setCity(profile!.city ?? '');
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
        .update({ display_name: name.trim(), belt_rank: belt, city: city.trim() || null })
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
  const streak = winStreak(matches, profile.id);
  const achievements = computeAchievements(profile, matches, solved, streak);
  const earnedCount = achievements.filter((a) => a.earned).length;
  const tier = tierFor(profile.rating);
  const titles = heldTitles(champions);

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

      {/* Held titles */}
      {titles.length > 0 && (
        <View style={styles.titleRow}>
          {titles.map((t) => (
            <View key={t} style={[styles.titleChip, { borderColor: theme.accent, backgroundColor: theme.accent + '22' }]}>
              <ThemedText style={{ fontSize: 13 }}>👑</ThemedText>
              <ThemedText style={{ color: theme.accent, fontWeight: '800', fontSize: 13 }}>{t}</ThemedText>
            </View>
          ))}
        </View>
      )}

      {/* Rating panel */}
      <Card style={{ backgroundColor: theme.accent }}>
        <ThemedText style={{ color: theme.accentText, opacity: 0.85, fontWeight: '700' }}>RATING</ThemedText>
        <ThemedText style={{ color: theme.accentText, fontSize: 52, fontWeight: '800', lineHeight: 56 }}>
          {profile.rating}
        </ThemedText>
        <View style={{ gap: 4, marginTop: Spacing.one }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <ThemedText style={{ color: theme.accentText, fontWeight: '800' }}>{tier.tier.name}</ThemedText>
            {tier.next && (
              <ThemedText type="small" style={{ color: theme.accentText, opacity: 0.85 }}>
                {tier.toNext} to {tier.next.name}
              </ThemedText>
            )}
          </View>
          <View style={styles.tierTrack}>
            <View style={[styles.tierFill, { width: `${Math.round(tier.progress * 100)}%` }]} />
          </View>
        </View>
        <View style={styles.recordRow}>
          <MiniStat label="Wins" value={profile.wins} tint={theme.accentText} />
          <MiniStat label="Losses" value={profile.losses} tint={theme.accentText} />
          <MiniStat label="Draws" value={profile.draws} tint={theme.accentText} />
          <MiniStat label="Win %" value={`${winRate}%`} tint={theme.accentText} />
        </View>
      </Card>

      {/* Open for a challenge / protected-account status (age-tier aware) */}
      {profile.is_minor && profile.consent_status === 'pending' ? (
        // Minor waiting on a parent to approve the account.
        <Card style={[styles.openRow, { flexWrap: 'wrap' }]}>
          <Ionicons name="time" size={22} color={theme.accent} />
          <View style={{ flex: 1, minWidth: 160 }}>
            <ThemedText style={{ fontWeight: '800' }}>Waiting for parent approval</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              A parent/guardian must approve this account before you can compete.
            </ThemedText>
          </View>
          <Button
            label={sendingConsent ? 'Sending…' : 'Resend email'}
            variant="secondary"
            onPress={resendConsent}
            loading={sendingConsent}
          />
        </Card>
      ) : profile.age_tier === 'kid' ? (
        // Under-14: locked down regardless of approval.
        <Card style={styles.openRow}>
          <Ionicons name="shield-checkmark" size={22} color={theme.accent} />
          <View style={{ flex: 1 }}>
            <ThemedText style={{ fontWeight: '800' }}>Protected account</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Your profile isn&apos;t publicly searchable and you can only be matched against other under-18 members.
            </ThemedText>
          </View>
        </Card>
      ) : (
        // Adults and approved teens: normal open-for-challenge toggle.
        <Card style={styles.openRow}>
          <Ionicons name="flame" size={22} color={profile.open_for_challenge ? theme.accent : theme.textSecondary} />
          <View style={{ flex: 1 }}>
            <ThemedText style={{ fontWeight: '800' }}>Open for a challenge</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {profile.open_for_challenge ? 'You appear in the Roll Finder' : 'Turn on to be found by nearby rollers'}
            </ThemedText>
          </View>
          <Switch
            value={profile.open_for_challenge}
            onValueChange={toggleOpen}
            disabled={togglingOpen}
            trackColor={{ true: theme.accent }}
          />
        </Card>
      )}

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

      {/* Trophy case */}
      <ThemedText style={styles.sectionLabel}>
        Trophy case · {earnedCount}/{achievements.length}
      </ThemedText>
      <View style={styles.grid}>
        {achievements.map((a) => (
          <Pressable
            key={a.id}
            onPress={() => Alert.alert(a.name, `${a.description}\n\n${a.earned ? '✓ Earned' : 'Locked'}`)}
            style={[
              styles.achv,
              { backgroundColor: theme.tile, borderColor: a.earned ? theme.accent : theme.tileBorder, opacity: a.earned ? 1 : 0.45 },
            ]}>
            <Ionicons name={a.icon} size={22} color={a.earned ? theme.accent : theme.textSecondary} />
            <ThemedText style={{ fontWeight: '700', fontSize: 12, textAlign: 'center' }} numberOfLines={1}>
              {a.name}
            </ThemedText>
          </Pressable>
        ))}
      </View>

      <Button label="Rivalries" variant="secondary" icon="git-compare" onPress={() => router.push('/rivalries')} />
      <Button label="Champions" variant="secondary" icon="trophy" onPress={() => router.push('/champions')} />

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
          <TextField label="City / area" value={city} onChangeText={setCity} placeholder="Your city (for the Roll Finder)" />
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

      {!profile.is_minor && (
        <Button
          label="My juniors"
          variant="secondary"
          icon="people-outline"
          onPress={() => router.push('/juniors')}
        />
      )}

      <Button label="Sign out" variant="ghost" icon="log-out-outline" onPress={signOut} />
      <Button
        label={deleting ? 'Deleting…' : 'Delete account'}
        variant="ghost"
        icon="trash-outline"
        loading={deleting}
        onPress={confirmDeleteAccount}
      />
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
  titleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  titleChip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: 999, paddingHorizontal: Spacing.three, paddingVertical: 4 },
  tierTrack: { height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.25)', overflow: 'hidden' },
  tierFill: { height: 6, borderRadius: 3, backgroundColor: '#fff' },
  achv: { flexBasis: '31%', flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: Spacing.three, borderRadius: 10, borderWidth: 1 },
  openRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
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
