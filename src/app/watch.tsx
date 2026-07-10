import { Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';

import { DropField, OptionRow, dropdownStyles } from '@/components/dropdowns';
import { MatchCard } from '@/components/match-card';
import { ThemedText } from '@/components/themed-text';
import { Card, EmptyState, Loading, Screen, TextField } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { SCOPE_KEYS, type Scope } from '@/lib/geo';
import { useTranslation } from '@/lib/i18n';
import { searchPublicMatches } from '@/lib/matches';
import { ADULT_BELTS, SUBMISSIONS, type BeltRank, type MatchWithPeople } from '@/lib/types';

type Menu = null | 'level' | 'belt' | 'rating' | 'sub' | 'sort';

const RATING_BANDS: { label: string; min: number | null; max: number | null }[] = [
  { label: 'Any rating', min: null, max: null },
  { label: 'Under 800', min: null, max: 799 },
  { label: '800 - 1199', min: 800, max: 1199 },
  { label: '1200 - 1599', min: 1200, max: 1599 },
  { label: '1600 - 1999', min: 1600, max: 1999 },
  { label: '2000+', min: 2000, max: null },
];

const SORTS: { key: string; label: string }[] = [
  { key: 'recent', label: 'Most recent' },
  { key: 'views', label: 'Most viewed' },
  { key: 'reactions', label: 'Most reactions' },
  { key: 'wager', label: 'Biggest pot' },
];

export default function WatchScreen() {
  const { session } = useAuth();
  const theme = useTheme();
  const { t } = useTranslation();
  const userId = session!.user.id;

  const [search, setSearch] = useState('');
  const [level, setLevel] = useState<Scope>('world');
  const [belt, setBelt] = useState<BeltRank | null>(null);
  const [band, setBand] = useState(0);
  const [submission, setSubmission] = useState<string | null>(null);
  const [sort, setSort] = useState('recent');
  const [menu, setMenu] = useState<Menu>(null);

  const [matches, setMatches] = useState<MatchWithPeople[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showOlder, setShowOlder] = useState(false);

  // Collapse back to the newest matches whenever the query changes.
  useEffect(() => {
    setShowOlder(false);
  }, [search, level, belt, band, submission, sort]);

  const load = useCallback(async () => {
    try {
      const b = RATING_BANDS[band];
      setMatches(
        await searchPublicMatches({ search, level, belt, minRating: b.min, maxRating: b.max, submission, sort }),
      );
    } catch (e) {
      console.warn('watch load failed', e);
    } finally {
      setLoading(false);
    }
  }, [search, level, belt, band, submission, sort]);

  // Debounced so typing in the search box doesn't fire a query per keystroke.
  useEffect(() => {
    const id = setTimeout(() => load(), 300);
    return () => clearTimeout(id);
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const toggle = (m: Exclude<Menu, null>) => setMenu((cur) => (cur === m ? null : m));

  return (
    <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.text} />}>
      <Stack.Screen options={{ title: t('nav.watch') }} />
      <ThemedText type="small" themeColor="textSecondary">
        {t('watch.intro')} {t('watch.retention')}
      </ThemedText>

      <TextField
        value={search}
        onChangeText={setSearch}
        placeholder="Search a name or @username"
        autoCapitalize="none"
        autoCorrect={false}
      />

      <View style={dropdownStyles.controls}>
        <DropField
          icon="earth-outline"
          text={t(level === 'gym' ? 'geo.gym' : `geo.${level}`)}
          open={menu === 'level'}
          onPress={() => toggle('level')}
        />
        <DropField
          icon="ribbon-outline"
          text={belt ? t(`belt.${belt}`) : 'Any belt'}
          open={menu === 'belt'}
          onPress={() => toggle('belt')}
        />
      </View>
      <View style={dropdownStyles.controls}>
        <DropField
          icon="stats-chart-outline"
          text={RATING_BANDS[band].label}
          open={menu === 'rating'}
          onPress={() => toggle('rating')}
        />
        <DropField
          icon="hand-left-outline"
          text={submission ?? 'Any submission'}
          open={menu === 'sub'}
          onPress={() => toggle('sub')}
        />
      </View>
      <View style={dropdownStyles.controls}>
        <DropField
          icon="swap-vertical-outline"
          text={SORTS.find((s) => s.key === sort)?.label ?? 'Most recent'}
          open={menu === 'sort'}
          onPress={() => toggle('sort')}
        />
      </View>

      {menu ? (
        <Card style={dropdownStyles.menu}>
          {menu === 'level' &&
            SCOPE_KEYS.map((s) => (
              <OptionRow
                key={s}
                label={t(s === 'gym' ? 'geo.gym' : `geo.${s}`)}
                selected={level === s}
                onPress={() => { setLevel(s); setMenu(null); }}
              />
            ))}
          {menu === 'belt' && (
            <>
              <OptionRow label="Any belt" selected={belt === null} onPress={() => { setBelt(null); setMenu(null); }} />
              {ADULT_BELTS.map((b) => (
                <OptionRow
                  key={b}
                  label={t(`belt.${b}`)}
                  selected={belt === b}
                  onPress={() => { setBelt(b); setMenu(null); }}
                />
              ))}
            </>
          )}
          {menu === 'rating' &&
            RATING_BANDS.map((r, i) => (
              <OptionRow key={r.label} label={r.label} selected={band === i} onPress={() => { setBand(i); setMenu(null); }} />
            ))}
          {menu === 'sort' &&
            SORTS.map((s) => (
              <OptionRow key={s.key} label={s.label} selected={sort === s.key} onPress={() => { setSort(s.key); setMenu(null); }} />
            ))}
          {menu === 'sub' && (
            <ScrollView style={{ maxHeight: 300 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
              <OptionRow
                label="Any submission"
                selected={submission === null}
                onPress={() => { setSubmission(null); setMenu(null); }}
              />
              {SUBMISSIONS.map((s) => (
                <OptionRow key={s} label={s} selected={submission === s} onPress={() => { setSubmission(s); setMenu(null); }} />
              ))}
            </ScrollView>
          )}
        </Card>
      ) : null}

      {loading ? (
        <Loading />
      ) : matches.length === 0 ? (
        <EmptyState icon="play-circle-outline" title={t('watch.emptyTitle')} subtitle={t('watch.emptySub')} />
      ) : (
        <View style={{ gap: Spacing.two }}>
          {(showOlder ? matches : matches.slice(0, 15)).map((m) => (
            <MatchCard key={m.id} match={m} currentUserId={userId} />
          ))}
          {!showOlder && matches.length > 15 && (
            <Pressable
              onPress={() => setShowOlder(true)}
              style={{ alignSelf: 'center', paddingVertical: Spacing.two, paddingHorizontal: Spacing.four, borderRadius: 999, borderWidth: 1, borderColor: theme.tileBorder }}>
              <ThemedText type="smallBold" themeColor="textSecondary">{t('ui.showOlder')}</ThemedText>
            </Pressable>
          )}
        </View>
      )}
    </Screen>
  );
}
