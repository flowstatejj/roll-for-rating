import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Card, TextField } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/lib/i18n';
import { SUBMISSION_CATEGORIES, SUBMISSION_LIST, type SubmissionDef } from '@/lib/types';

/**
 * Searchable dropdown of every submission. The pick is the canonical
 * submission_type stored on the match — it drives the hunt badge + RoR reward.
 */
export function SubmissionPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();
  const filtered = SUBMISSION_LIST.filter((s) => s.name.toLowerCase().includes(query));

  function pick(name: string) {
    onChange(name === value ? null : name);
    setOpen(false);
    setQ('');
  }

  return (
    <View style={{ gap: Spacing.two }}>
      <Pressable onPress={() => setOpen((o) => !o)}>
        <View style={[styles.field, { borderColor: value ? theme.accent : theme.border, backgroundColor: theme.backgroundElement }]}>
          <Ionicons name="hand-left-outline" size={16} color={value ? theme.accent : theme.textSecondary} />
          <ThemedText style={{ flex: 1, color: value ? theme.text : theme.textSecondary, fontWeight: value ? '700' : '400' }} numberOfLines={1}>
            {value ?? t('md.subPick')}
          </ThemedText>
          <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={theme.textSecondary} />
        </View>
      </Pressable>

      {open && (
        <Card style={{ gap: Spacing.one, borderColor: theme.accent, borderWidth: 1 }}>
          <TextField value={q} onChangeText={setQ} placeholder={t('md.subSearch')} autoCapitalize="none" autoCorrect={false} />
          {filtered.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center', paddingVertical: Spacing.two }}>
              {t('md.subNone')}
            </ThemedText>
          ) : query ? (
            filtered.slice(0, 40).map((s) => <Row key={s.name} s={s} selected={s.name === value} onPress={() => pick(s.name)} />)
          ) : (
            SUBMISSION_CATEGORIES.map((cat) => {
              const items = SUBMISSION_LIST.filter((s) => s.category === cat.key);
              if (items.length === 0) return null;
              return (
                <View key={cat.key} style={{ gap: 2 }}>
                  <ThemedText type="smallBold" themeColor="textSecondary" style={{ marginTop: Spacing.one }}>
                    {cat.label}
                  </ThemedText>
                  {items.map((s) => <Row key={s.name} s={s} selected={s.name === value} onPress={() => pick(s.name)} />)}
                </View>
              );
            })
          )}
        </Card>
      )}
    </View>
  );
}

function Row({ s, selected, onPress }: { s: SubmissionDef; selected: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable onPress={onPress}>
      <View style={[styles.row, selected && { backgroundColor: theme.accent + '22' }]}>
        <ThemedText style={{ flex: 1, fontWeight: selected ? '800' : '600' }} numberOfLines={1}>
          {s.name}
        </ThemedText>
        <ThemedText type="small" style={{ color: theme.accent, fontWeight: '800' }}>+{s.ror}</ThemedText>
        {selected && <Ionicons name="checkmark" size={16} color={theme.accent} />}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.two,
    borderWidth: 1, borderRadius: 10, paddingHorizontal: Spacing.three, paddingVertical: Spacing.three,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.two,
    paddingVertical: Spacing.two, paddingHorizontal: Spacing.two, borderRadius: 8,
  },
});
