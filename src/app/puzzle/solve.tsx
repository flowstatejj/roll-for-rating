import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, EmptyState, Loading, Screen, TextField } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useTranslation } from '@/lib/i18n';
import { fetchNextPuzzle, submitMc, submitWritten } from '@/lib/puzzles';
import type { Puzzle, PuzzleKind, PuzzleResult } from '@/lib/types';

export default function SolvePuzzleScreen() {
  const { kind = 'multiple_choice' } = useLocalSearchParams<{ kind: PuzzleKind }>();
  const { session, refreshProfile } = useAuth();
  const theme = useTheme();
  const { t } = useTranslation();
  const userId = session!.user.id;

  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<number | null>(null);
  const [answer, setAnswer] = useState('');
  const [result, setResult] = useState<PuzzleResult | null>(null);
  const [busy, setBusy] = useState(false);

  const loadNext = useCallback(async () => {
    setLoading(true);
    setSelected(null);
    setAnswer('');
    setResult(null);
    try {
      setPuzzle(await fetchNextPuzzle(userId, kind));
    } catch (e) {
      console.warn('Failed to load puzzle', e);
    } finally {
      setLoading(false);
    }
  }, [userId, kind]);

  useEffect(() => { loadNext(); }, [loadNext]);

  async function pick(index: number) {
    if (result || busy || !puzzle) return;
    setSelected(index);
    setBusy(true);
    try {
      const r = await submitMc(puzzle.id, index);
      setResult(r);
      if (r.rated) refreshProfile();
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Could not submit your answer.');
      setSelected(null);
    } finally {
      setBusy(false);
    }
  }

  async function submitWrittenAnswer() {
    if (result || busy || !puzzle) return;
    if (!answer.trim()) {
      Alert.alert('Write an answer', 'Type your answer before submitting.');
      return;
    }
    setBusy(true);
    try {
      const r = await submitWritten(puzzle.id, answer.trim());
      setResult(r);
      if (r.rated) refreshProfile();
    } catch (e: any) {
      Alert.alert('Grading unavailable', e.message ?? 'Could not grade your answer.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Loading />;

  if (!puzzle) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('tab.puzzles') }} />
        <EmptyState icon="extension-puzzle-outline" title={t('pz.noTitle')} subtitle={t('pz.noSub')} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: puzzle.title ?? t('nav.puzzle') }} />

      {puzzle.image_url && (
        <Image source={{ uri: puzzle.image_url }} style={styles.image} contentFit="cover" transition={150} />
      )}

      <ThemedText style={{ fontSize: 18, fontWeight: '700' }}>{puzzle.question}</ThemedText>

      {puzzle.kind === 'written' && !result && (
        <View style={{ gap: Spacing.two }}>
          <TextField
            label={t('pz.yourAnswer')}
            value={answer}
            onChangeText={setAnswer}
            multiline
            placeholder={t('pz.answerPlaceholder')}
            style={{ minHeight: 120, textAlignVertical: 'top' }}
          />
          <Button label={t('pz.submit')} icon="sparkles" loading={busy} onPress={submitWrittenAnswer} />
        </View>
      )}

      {puzzle.kind === 'multiple_choice' && (
      <View style={{ gap: Spacing.two }}>
        {(puzzle.choices ?? []).map((choice, i) => {
          const isCorrect = result?.correct_index === i;
          const isWrongPick = !!result && selected === i && !isCorrect;
          const showState = !!result;

          const bg = showState
            ? isCorrect
              ? theme.success + '2A'
              : isWrongPick
                ? theme.danger + '2A'
                : 'transparent'
            : 'transparent';
          const border = showState
            ? isCorrect
              ? theme.success
              : isWrongPick
                ? theme.danger
                : theme.border
            : theme.border;

          return (
            <Pressable key={i} onPress={() => pick(i)} disabled={!!result || busy}>
              <View style={[styles.choice, { backgroundColor: bg, borderColor: border }]}>
                <ThemedText style={{ flex: 1, fontWeight: '600' }}>{choice}</ThemedText>
                {showState && isCorrect && <Ionicons name="checkmark-circle" size={20} color={theme.success} />}
                {showState && isWrongPick && <Ionicons name="close-circle" size={20} color={theme.danger} />}
              </View>
            </Pressable>
          );
        })}
      </View>
      )}

      {/* Result */}
      {result && (
        <Card style={{ gap: Spacing.two, borderColor: result.is_correct ? theme.success : theme.danger, borderWidth: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
            <Ionicons
              name={result.is_correct ? 'checkmark-circle' : 'close-circle'}
              size={24}
              color={result.is_correct ? theme.success : theme.danger}
            />
            <ThemedText style={{ fontSize: 18, fontWeight: '800', flex: 1 }}>
              {result.is_correct ? t('pz.correct') : t('pz.notQuite')}
            </ThemedText>
            {result.rated ? (
              <View style={[styles.delta, { backgroundColor: (result.delta >= 0 ? theme.success : theme.danger) + '26' }]}>
                <ThemedText style={{ color: result.delta >= 0 ? theme.success : theme.danger, fontWeight: '800' }}>
                  {result.delta > 0 ? `+${result.delta}` : result.delta}
                </ThemedText>
              </View>
            ) : (
              <ThemedText type="small" themeColor="textSecondary">
                {t('pz.practice')}
              </ThemedText>
            )}
          </View>
          {puzzle.kind === 'written' && result.score != null && (
            <ThemedText style={{ fontWeight: '700' }}>{t('pz.score')}: {result.score}/100</ThemedText>
          )}
          {result.low_effort && (
            <ThemedText type="small" style={{ color: theme.danger, fontWeight: '700' }}>
              {t('pz.lowEffort')}
            </ThemedText>
          )}
          {result.feedback && <ThemedText>{result.feedback}</ThemedText>}

          {!!result.strengths?.length && (
            <View style={{ gap: 4 }}>
              {result.strengths.map((s, i) => (
                <View key={`s${i}`} style={styles.point}>
                  <Ionicons name="checkmark-circle" size={16} color={theme.success} style={{ marginTop: 2 }} />
                  <ThemedText style={{ flex: 1 }}>{s}</ThemedText>
                </View>
              ))}
            </View>
          )}
          {!!result.missing?.length && (
            <View style={{ gap: 4 }}>
              {result.missing.map((m, i) => (
                <View key={`m${i}`} style={styles.point}>
                  <Ionicons name="add-circle" size={16} color={theme.danger} style={{ marginTop: 2 }} />
                  <ThemedText style={{ flex: 1 }} themeColor="textSecondary">{m}</ThemedText>
                </View>
              ))}
            </View>
          )}

          {(result.model_answer || result.explanation) && (
            <View style={{ gap: 2, marginTop: Spacing.one }}>
              <ThemedText type="smallBold" themeColor="textSecondary">{t('pz.modelAnswer')}</ThemedText>
              <ThemedText themeColor="textSecondary">{result.model_answer ?? result.explanation}</ThemedText>
            </View>
          )}
          {result.rated && (
            <ThemedText type="small" themeColor="textSecondary">
              {t('pz.rating')} {result.rating_before} → {result.rating_after}
            </ThemedText>
          )}
        </Card>
      )}

      {result && <Button label={t('pz.next')} icon="arrow-forward" onPress={loadNext} />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  image: { width: '100%', aspectRatio: 16 / 10, borderRadius: 12, backgroundColor: '#0003' },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
  },
  delta: { borderRadius: 999, paddingHorizontal: Spacing.two, paddingVertical: 2 },
  point: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.one },
});
