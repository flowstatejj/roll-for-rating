import { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Avatar, BeltChip, Button, Card, Loading, Screen, TextField } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { BELT_COLORS, BELT_LABELS, type BeltRank } from '@/lib/types';

const BELTS: BeltRank[] = ['white', 'blue', 'purple', 'brown', 'black'];

export default function ProfileScreen() {
  const { profile, signOut, refreshProfile } = useAuth();
  const theme = useTheme();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [belt, setBelt] = useState<BeltRank>('white');
  const [saving, setSaving] = useState(false);

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

  return (
    <Screen>
      <View style={styles.header}>
        <Avatar name={profile.display_name} size={84} />
        <ThemedText type="subtitle" style={{ fontSize: 24 }}>
          {profile.display_name}
        </ThemedText>
        <ThemedText themeColor="textSecondary">@{profile.username}</ThemedText>
        <BeltChip belt={profile.belt_rank} />
      </View>

      <Card>
        <View style={styles.statsRow}>
          <Stat label="Rating" value={profile.rating} />
          <Divider />
          <Stat label="Win rate" value={`${winRate}%`} />
          <Divider />
          <Stat label="Matches" value={total} />
        </View>
        <View style={[styles.statsRow, { marginTop: Spacing.three }]}>
          <Stat label="Wins" value={profile.wins} />
          <Divider />
          <Stat label="Losses" value={profile.losses} />
          <Divider />
          <Stat label="Draws" value={profile.draws} />
        </View>
      </Card>

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

      <Button label="Sign out" variant="ghost" icon="log-out-outline" onPress={signOut} />
    </Screen>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <ThemedText style={{ fontSize: 22, fontWeight: '800' }}>{value}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
    </View>
  );
}

function Divider() {
  const theme = useTheme();
  return <View style={{ width: StyleSheet.hairlineWidth, backgroundColor: theme.border, alignSelf: 'stretch' }} />;
}

const styles = StyleSheet.create({
  header: { alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.three },
  statsRow: { flexDirection: 'row', alignItems: 'center' },
  belts: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  beltOption: { paddingVertical: Spacing.two, paddingHorizontal: Spacing.three, borderRadius: 10, borderWidth: 1 },
});
