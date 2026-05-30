import { Ionicons } from '@expo/vector-icons';
import { forwardRef } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type TextInputProps,
  type ViewProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { TatamiBackground } from '@/components/tatami-background';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { BELT_COLORS, BELT_LABELS, type BeltRank } from '@/lib/types';

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------
type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

export function Button({
  label,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  icon,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  const theme = useTheme();
  const isDisabled = disabled || loading;

  const bg =
    variant === 'primary'
      ? theme.accent
      : variant === 'danger'
        ? theme.danger
        : variant === 'secondary'
          ? theme.backgroundSelected
          : 'transparent';
  const fg =
    variant === 'primary' || variant === 'danger' ? theme.accentText : theme.text;

  // The darker bottom edge that gives chess.com buttons their chunky 3D feel.
  const edge =
    variant === 'primary'
      ? theme.accentDark
      : variant === 'danger'
        ? '#9e352e'
        : variant === 'secondary'
          ? '#1f1d1b'
          : 'transparent';
  const is3d = variant !== 'ghost';

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, opacity: isDisabled ? 0.5 : 1 },
        is3d && {
          borderBottomWidth: pressed ? 1 : 4,
          borderBottomColor: edge,
          transform: [{ translateY: pressed ? 2 : 0 }],
        },
        variant === 'ghost' && { paddingVertical: Spacing.two },
      ]}>
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <View style={styles.buttonInner}>
          {icon && <Ionicons name={icon} size={18} color={fg} />}
          <ThemedText style={{ color: fg, fontWeight: '800', fontSize: 16, letterSpacing: 0.2 }}>
            {label}
          </ThemedText>
        </View>
      )}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------
export function Card({ style, ...rest }: ViewProps) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.tile, borderColor: theme.tileBorder },
        style,
      ]}
      {...rest}
    />
  );
}

// ---------------------------------------------------------------------------
// TextField
// ---------------------------------------------------------------------------
export const TextField = forwardRef<TextInput, TextInputProps & { label?: string }>(
  ({ label, style, ...rest }, ref) => {
    const theme = useTheme();
    return (
      <View style={{ gap: Spacing.one, alignSelf: 'stretch' }}>
        {label && (
          <ThemedText type="smallBold" themeColor="textSecondary">
            {label}
          </ThemedText>
        )}
        <TextInput
          ref={ref}
          placeholderTextColor={theme.textSecondary}
          style={[
            styles.input,
            { color: theme.text, backgroundColor: theme.backgroundElement, borderColor: theme.border },
            style,
          ]}
          {...rest}
        />
      </View>
    );
  },
);
TextField.displayName = 'TextField';

// ---------------------------------------------------------------------------
// Belt chip
// ---------------------------------------------------------------------------
export function BeltChip({ belt, size = 'md' }: { belt: BeltRank; size?: 'sm' | 'md' }) {
  const color = BELT_COLORS[belt];
  const small = size === 'sm';
  return (
    <View
      style={[
        styles.beltChip,
        {
          backgroundColor: color,
          borderColor: belt === 'white' ? '#9A9AA0' : color,
          paddingVertical: small ? 1 : 3,
          paddingHorizontal: small ? 6 : 8,
        },
      ]}>
      <ThemedText
        style={{
          color: belt === 'white' ? '#222' : '#fff',
          fontWeight: '700',
          fontSize: small ? 10 : 12,
        }}>
        {BELT_LABELS[belt].toUpperCase()}
      </ThemedText>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Avatar (initials)
// ---------------------------------------------------------------------------
export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  const theme = useTheme();
  const initials = name
    .split(' ')
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: theme.backgroundSelected,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <ThemedText style={{ fontWeight: '700', fontSize: size * 0.4 }}>{initials || '?'}</ThemedText>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Screen wrapper (safe-area + scroll)
// ---------------------------------------------------------------------------
export function Screen({
  children,
  scroll = true,
  refreshControl,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  refreshControl?: React.ReactElement<any>;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      <TatamiBackground />
      <SafeAreaView style={[styles.screen, { backgroundColor: 'transparent' }]} edges={['top']}>
        <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          {scroll ? (
            <ScrollView
              contentContainerStyle={styles.scrollContent}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
              refreshControl={refreshControl}>
              {children}
            </ScrollView>
          ) : (
            children
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message?: string; onRetry: () => void }) {
  const theme = useTheme();
  return (
    <View style={[styles.center, { gap: Spacing.three, paddingVertical: Spacing.six }]}>
      <Ionicons name="cloud-offline-outline" size={48} color={theme.textSecondary} />
      <ThemedText themeColor="textSecondary" style={{ textAlign: 'center', paddingHorizontal: Spacing.four }}>
        {message ?? "Couldn't load — check your connection and try again."}
      </ThemedText>
      <Button label="Retry" icon="refresh" variant="secondary" onPress={onRetry} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Misc helpers
// ---------------------------------------------------------------------------
export function Loading() {
  const theme = useTheme();
  return (
    <View style={styles.center}>
      <ActivityIndicator color={theme.accent} size="large" />
    </View>
  );
}

export function EmptyState({ icon, title, subtitle }: { icon: keyof typeof Ionicons.glyphMap; title: string; subtitle?: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.center, { gap: Spacing.two, paddingVertical: Spacing.six }]}>
      <Ionicons name={icon} size={48} color={theme.textSecondary} />
      <ThemedText type="subtitle" style={{ fontSize: 20, textAlign: 'center' }}>
        {title}
      </ThemedText>
      {subtitle && (
        <ThemedText themeColor="textSecondary" style={{ textAlign: 'center' }}>
          {subtitle}
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    borderRadius: 8,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.four,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
  },
  buttonInner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  card: {
    borderRadius: 10,
    padding: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth,
  },
  input: {
    borderRadius: 8,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  beltChip: {
    borderRadius: 6,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  screen: { flex: 1 },
  scrollContent: {
    padding: Spacing.three,
    gap: Spacing.three,
    paddingBottom: Spacing.six,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
