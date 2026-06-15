import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Card, TextField } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/lib/i18n';
import { statesForCountry } from '@/lib/states';

/**
 * State / province field. A searchable dropdown when the selected country has a
 * known subdivision list; a plain free-text field otherwise.
 */
export function StatePicker({ country, value, onChange }: { country: string; value: string; onChange: (v: string) => void }) {
  const theme = useTheme();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');

  const list = statesForCountry(country);
  if (!list) {
    return <TextField label={t('pf.state')} value={value} onChangeText={onChange} placeholder={t('pf.statePh')} autoCapitalize="words" />;
  }

  const query = q.trim().toLowerCase();
  const filtered = query ? list.filter((s) => s.toLowerCase().includes(query)) : list;
  function pick(name: string) { onChange(name); setOpen(false); setQ(''); }

  return (
    <View style={{ gap: Spacing.one }}>
      <ThemedText type="smallBold" themeColor="textSecondary">{t('pf.state')}</ThemedText>
      <Pressable onPress={() => setOpen((o) => !o)}>
        <View style={[styles.field, { borderColor: value ? theme.accent : theme.border, backgroundColor: theme.backgroundElement }]}>
          <Ionicons name="map-outline" size={16} color={value ? theme.accent : theme.textSecondary} />
          <ThemedText style={{ flex: 1, color: value ? theme.text : theme.textSecondary, fontWeight: value ? '700' : '400' }} numberOfLines={1}>
            {value || t('pf.statePick')}
          </ThemedText>
          <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={theme.textSecondary} />
        </View>
      </Pressable>

      {open && (
        <Card style={{ gap: Spacing.one, borderColor: theme.accent, borderWidth: 1 }}>
          <TextField value={q} onChangeText={setQ} placeholder={t('pf.stateSearch')} autoCapitalize="none" autoCorrect={false} />
          {value ? (
            <Pressable onPress={() => pick('')}>
              <View style={styles.row}>
                <Ionicons name="close-circle-outline" size={16} color={theme.textSecondary} />
                <ThemedText style={{ flex: 1, color: theme.textSecondary }}>{t('pf.stateClear')}</ThemedText>
              </View>
            </Pressable>
          ) : null}
          {filtered.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center', paddingVertical: Spacing.two }}>
              {t('pf.countryNone')}
            </ThemedText>
          ) : (
            filtered.slice(0, 60).map((s) => (
              <Pressable key={s} onPress={() => pick(s)}>
                <View style={[styles.row, s === value && { backgroundColor: theme.accent + '22' }]}>
                  <ThemedText style={{ flex: 1, fontWeight: s === value ? '800' : '600' }} numberOfLines={1}>{s}</ThemedText>
                  {s === value && <Ionicons name="checkmark" size={16} color={theme.accent} />}
                </View>
              </Pressable>
            ))
          )}
        </Card>
      )}
    </View>
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
