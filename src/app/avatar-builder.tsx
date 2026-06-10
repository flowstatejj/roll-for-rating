import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, Screen } from '@/components/ui/kit';
import { WarriorAvatar } from '@/components/warrior-avatar';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { setWarriorAvatar } from '@/lib/avatars';
import { useAuth } from '@/lib/auth';
import { useTranslation } from '@/lib/i18n';
import {
  AVATAR_COLORS, DEFAULT_AVATAR_COLOR, DEFAULT_WARRIOR, WARRIORS, isWarrior, type WarriorKey,
} from '@/lib/warriors';

export default function AvatarBuilderScreen() {
  const { profile, session, refreshProfile } = useAuth();
  const theme = useTheme();
  const router = useRouter();
  const { t } = useTranslation();
  const userId = session?.user.id;

  const [warrior, setWarrior] = useState<WarriorKey>(
    isWarrior(profile?.avatar_warrior) ? (profile!.avatar_warrior as WarriorKey) : DEFAULT_WARRIOR,
  );
  const [color, setColor] = useState<string>(profile?.avatar_color || DEFAULT_AVATAR_COLOR);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!userId) return;
    setSaving(true);
    try {
      await setWarriorAvatar(userId, warrior, color);
      await refreshProfile();
      router.back();
    } catch (e: any) {
      Alert.alert(t('av.saveFail'), e.message ?? t('md.tryAgain'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: t('av.title') }} />

      <View style={{ alignItems: 'center', gap: Spacing.two }}>
        <WarriorAvatar warrior={warrior} color={color} size={140} />
        <ThemedText style={{ fontWeight: '800', fontSize: 20 }}>
          {WARRIORS.find((w) => w.key === warrior)?.name}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center' }}>
          {t('av.intro')}
        </ThemedText>
      </View>

      <ThemedText style={styles.section}>{t('av.color')}</ThemedText>
      <View style={styles.colors}>
        {AVATAR_COLORS.map((c) => (
          <Pressable
            key={c}
            onPress={() => setColor(c)}
            style={[styles.swatch, { backgroundColor: c, borderColor: color === c ? theme.text : 'transparent' }]}
          />
        ))}
      </View>

      <ThemedText style={styles.section}>{t('av.pickWarrior')}</ThemedText>
      <View style={styles.grid}>
        {WARRIORS.map((w) => {
          const selected = warrior === w.key;
          return (
            <Pressable
              key={w.key}
              onPress={() => setWarrior(w.key)}
              style={[styles.tile, { borderColor: selected ? theme.accent : theme.tileBorder, backgroundColor: theme.tile }]}>
              <WarriorAvatar warrior={w.key} color={color} size={56} />
              <ThemedText type="small" style={{ fontWeight: '700' }} numberOfLines={1}>
                {w.name}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>

      <Button label={t('av.save')} icon="checkmark-circle" onPress={save} loading={saving} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: { fontSize: 18, fontWeight: '800', marginTop: Spacing.three },
  colors: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  swatch: { width: 34, height: 34, borderRadius: 17, borderWidth: 3 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  tile: { flexBasis: '31%', flexGrow: 1, alignItems: 'center', gap: 6, paddingVertical: Spacing.three, borderRadius: 12, borderWidth: 1.5 },
});
