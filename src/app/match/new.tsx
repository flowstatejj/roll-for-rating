import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Avatar, BeltChip, Button, Card, Screen, TextField } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { createMatch, searchProfiles } from '@/lib/matches';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/lib/types';

type Slot = 'opponent' | 'referee';

export default function NewMatchScreen() {
  const { session } = useAuth();
  const theme = useTheme();
  const router = useRouter();
  const userId = session!.user.id;

  const { opponent: opponentParam } = useLocalSearchParams<{ opponent?: string }>();
  const [opponent, setOpponent] = useState<Profile | null>(null);
  const [referee, setReferee] = useState<Profile | null>(null);
  const [active, setActive] = useState<Slot>('opponent');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Profile[]>([]);
  const [creating, setCreating] = useState(false);

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

  // Exclude me + whoever is already chosen for the other role.
  const excludeIds = [
    userId,
    active === 'opponent' ? referee?.id : opponent?.id,
  ].filter(Boolean) as string[];

  const runSearch = useCallback(async () => {
    try {
      setResults(await searchProfiles(query, excludeIds));
    } catch (e) {
      console.warn('search failed', e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, active, opponent?.id, referee?.id, userId]);

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
      const id = await createMatch({ challengerId: userId, opponentId: opponent.id, refereeId: referee.id });
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

      <Button
        label="Send challenge"
        icon="send"
        onPress={create}
        loading={creating}
        disabled={!opponent || !referee}
      />
    </Screen>
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
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
});
