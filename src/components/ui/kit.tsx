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
import { Image } from 'expo-image';

import { TatamiBackground } from '@/components/tatami-background';
import { ThemedText } from '@/components/themed-text';
import { WarriorAvatar } from '@/components/warrior-avatar';
import { isWarrior } from '@/lib/warriors';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/lib/i18n';
import { BELT_COLORS, type BeltRank } from '@/lib/types';

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
  const { t } = useTranslation();
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
        {t(`belt.${belt}`).toUpperCase()}
      </ThemedText>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Avatar (initials)
// ---------------------------------------------------------------------------
/** Founding-member gold (matches the rank-1 medal on the leaderboard). */
export const FOUNDER_GOLD = '#E5B53A';

export function Avatar({
  name,
  size = 40,
  uri,
  warrior,
  color,
  founding,
}: {
  name: string;
  size?: number;
  uri?: string | null;
  warrior?: string | null;
  color?: string | null;
  /** Founding member — draws a gold ring + star badge around the avatar. */
  founding?: boolean;
}) {
  const theme = useTheme();

  const inner = (s: number) => {
    if (isWarrior(warrior)) {
      return <WarriorAvatar warrior={warrior} color={color} size={s} />;
    }
    if (uri) {
      return (
        <Image
          source={{ uri }}
          style={{ width: s, height: s, borderRadius: s / 2, backgroundColor: theme.backgroundSelected }}
          contentFit="cover"
        />
      );
    }
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
          width: s,
          height: s,
          borderRadius: s / 2,
          backgroundColor: theme.backgroundSelected,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <ThemedText style={{ fontWeight: '700', fontSize: s * 0.4 }}>{initials || '?'}</ThemedText>
      </View>
    );
  };

  if (!founding) return inner(size);

  // Gold ring + corner star — the "founding member" badge shown everywhere.
  const ring = Math.max(2, Math.round(size * 0.06));
  const badge = Math.max(13, Math.round(size * 0.34));
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: ring,
          borderColor: FOUNDER_GOLD,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        {inner(size - ring * 2 - 2)}
      </View>
      <View
        style={{
          position: 'absolute',
          bottom: -1,
          right: -1,
          width: badge,
          height: badge,
          borderRadius: badge / 2,
          backgroundColor: FOUNDER_GOLD,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 1.5,
          borderColor: '#1a1a1a',
        }}>
        <Ionicons name="star" size={badge * 0.6} color="#1a1a1a" />
      </View>
    </View>
  );
}

/** Small "Founding Member" pill for profile headers. */
export function FoundingChip() {
  const { t } = useTranslation();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        backgroundColor: FOUNDER_GOLD + '22',
        borderColor: FOUNDER_GOLD,
        borderWidth: 1,
        borderRadius: 999,
        paddingHorizontal: 8,
        paddingVertical: 2,
        alignSelf: 'flex-start',
      }}>
      <Ionicons name="star" size={11} color={FOUNDER_GOLD} />
      <ThemedText style={{ color: FOUNDER_GOLD, fontWeight: '800', fontSize: 11 }}>{t('fm.badge')}</ThemedText>
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
  const { t } = useTranslation();
  return (
    <View style={[styles.center, { gap: Spacing.three, paddingVertical: Spacing.six }]}>
      <Ionicons name="cloud-offline-outline" size={48} color={theme.textSecondary} />
      <ThemedText themeColor="textSecondary" style={{ textAlign: 'center', paddingHorizontal: Spacing.four }}>
        {message ?? t('kit.errorDefault')}
      </ThemedText>
      <Button label={t('kit.retry')} icon="refresh" variant="secondary" onPress={onRetry} />
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
