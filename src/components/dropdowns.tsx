import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** A compact closed dropdown "field": an icon, the current value, and a chevron. */
export function DropField({
  icon,
  text,
  open,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
  open: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable onPress={onPress} style={{ flex: 1 }}>
      <View style={[styles.field, { borderColor: open ? theme.accent : theme.tileBorder, backgroundColor: theme.tile }]}>
        <Ionicons name={icon} size={16} color={open ? theme.accent : theme.textSecondary} />
        <ThemedText style={{ flex: 1, fontWeight: '700' }} numberOfLines={1}>{text}</ThemedText>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={theme.textSecondary} />
      </View>
    </Pressable>
  );
}

/** One selectable row inside an open dropdown menu (checkmark when selected). */
export function OptionRow({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable onPress={onPress} style={[styles.option, selected && { backgroundColor: theme.accent + '22' }]}>
      <ThemedText style={{ flex: 1, fontWeight: selected ? '800' : '600' }}>{label}</ThemedText>
      {selected && <Ionicons name="checkmark" size={16} color={theme.accent} />}
    </Pressable>
  );
}

export const dropdownStyles = StyleSheet.create({
  controls: { flexDirection: 'row', gap: Spacing.two },
  menu: { paddingVertical: Spacing.one, paddingHorizontal: Spacing.one, gap: 2 },
});

const styles = StyleSheet.create({
  field: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderWidth: 1, borderRadius: 10, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  option: { flexDirection: 'row', alignItems: 'center', paddingVertical: Spacing.two, paddingHorizontal: Spacing.two, borderRadius: 8 },
});
