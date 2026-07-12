import { Ionicons } from '@expo/vector-icons';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Switch, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, Screen, TextField } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { applyInviteOrReferralCode } from '@/lib/elite';
import { LANGUAGES, useTranslation, type LangCode } from '@/lib/i18n';
import { NOTIF_CATEGORIES, setNotifPref, type NotifCategory } from '@/lib/notif-prefs';

const CATEGORY_META: { key: NotifCategory; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'challenges', icon: 'flame' },
  { key: 'results', icon: 'trophy' },
  { key: 'messages', icon: 'chatbubble' },
  { key: 'videos', icon: 'videocam' },
  { key: 'reactions', icon: 'heart' },
  { key: 'friends', icon: 'person-add' },
  { key: 'leagues', icon: 'people-circle' },
  { key: 'gym', icon: 'people' },
];

export default function SettingsScreen() {
  const theme = useTheme();
  const { t, lang, setLang } = useTranslation();
  const { profile, refreshProfile } = useAuth();
  const [open, setOpen] = useState(false);
  const [savingCat, setSavingCat] = useState<NotifCategory | null>(null);
  const [codeInput, setCodeInput] = useState('');
  const [applying, setApplying] = useState(false);

  const current = LANGUAGES.find((l) => l.code === lang) ?? LANGUAGES[0];

  function choose(code: LangCode) {
    setLang(code);
    setOpen(false);
  }

  const enabled = (cat: NotifCategory) => profile?.notif_prefs?.[cat] !== false; // default on

  // Post-signup code entry: referral codes attach attribution, elite invite
  // codes unlock free access (the paywall gate re-checks on next launch).
  async function applyCode() {
    const entered = codeInput.trim().toUpperCase();
    if (!entered) return;
    setApplying(true);
    try {
      const res = await applyInviteOrReferralCode(entered);
      if (res.kind === 'referral') {
        setCodeInput('');
        Alert.alert(t('code.referralOk').replace('{name}', res.name ?? entered));
      } else if (res.kind === 'elite') {
        setCodeInput('');
        Alert.alert(t('code.eliteOk'));
      } else if (res.kind === 'referralAlready') {
        Alert.alert(t('code.already'));
      } else if (res.kind === 'eliteAlready') {
        Alert.alert(t('code.eliteAlready'));
      } else if (res.kind === 'error') {
        Alert.alert(t('code.network'));
      } else {
        Alert.alert(t('code.invalid'));
      }
    } catch {
      Alert.alert(t('md.error'), t('md.tryAgain'));
    } finally {
      setApplying(false);
    }
  }

  async function toggle(cat: NotifCategory, value: boolean) {
    if (!profile) return;
    setSavingCat(cat);
    try {
      await setNotifPref(profile.id, profile.notif_prefs, cat, value);
      await refreshProfile();
    } catch {
      Alert.alert(t('md.error'), t('md.tryAgain'));
    } finally {
      setSavingCat(null);
    }
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: t('settings.title') }} />

      <ThemedText type="smallBold" themeColor="textSecondary">
        {t('settings.language').toUpperCase()}
      </ThemedText>

      {/* Dropdown trigger */}
      <Pressable onPress={() => setOpen((o) => !o)}>
        <Card style={styles.row}>
          <Ionicons name="language" size={20} color={theme.accent} />
          <View style={{ flex: 1 }}>
            <ThemedText style={{ fontWeight: '800' }}>{t('settings.language')}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {current.label}
            </ThemedText>
          </View>
          <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={20} color={theme.textSecondary} />
        </Card>
      </Pressable>

      {/* Dropdown options */}
      {open && (
        <Card style={{ paddingVertical: Spacing.one, paddingHorizontal: Spacing.one }}>
          {LANGUAGES.map((l, i) => {
            const selected = l.code === lang;
            return (
              <View key={l.code}>
                {i > 0 && <View style={[styles.divider, { backgroundColor: theme.tileBorder }]} />}
                <Pressable onPress={() => choose(l.code)}>
                  <View style={[styles.option, selected && { backgroundColor: theme.accent + '22', borderRadius: 8 }]}>
                    <ThemedText style={{ flex: 1, fontWeight: selected ? '800' : '600' }}>{l.label}</ThemedText>
                    {selected && <Ionicons name="checkmark-circle" size={20} color={theme.accent} />}
                  </View>
                </Pressable>
              </View>
            );
          })}
        </Card>
      )}

      <ThemedText type="small" themeColor="textSecondary">
        {t('settings.languageHint')}
      </ThemedText>

      {/* Notifications */}
      <ThemedText type="smallBold" themeColor="textSecondary" style={{ marginTop: Spacing.three }}>
        {t('settings.notifications').toUpperCase()}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {t('settings.notifHint')}
      </ThemedText>
      <Card style={{ paddingVertical: Spacing.one }}>
        {CATEGORY_META.map((c, i) => (
          <View key={c.key}>
            {i > 0 && <View style={[styles.divider, { backgroundColor: theme.tileBorder }]} />}
            <View style={styles.notifRow}>
              <Ionicons name={c.icon} size={20} color={theme.accent} />
              <ThemedText style={{ flex: 1, fontWeight: '700' }}>{t(`notif.cat.${c.key}`)}</ThemedText>
              <Switch
                value={enabled(c.key)}
                onValueChange={(v) => toggle(c.key, v)}
                disabled={savingCat === c.key || !profile}
                trackColor={{ true: theme.accent }}
              />
            </View>
          </View>
        ))}
      </Card>

      {/* Invite / referral code - post-signup entry so attribution + elite
          access aren't lost when a code wasn't typed at sign-up. */}
      <ThemedText type="smallBold" themeColor="textSecondary" style={{ marginTop: Spacing.three }}>
        {t('code.section').toUpperCase()}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {t('code.hint')}
      </ThemedText>
      <Card style={{ gap: Spacing.three }}>
        <TextField
          value={codeInput}
          onChangeText={setCodeInput}
          placeholder={t('code.ph')}
          autoCapitalize="characters"
          autoCorrect={false}
        />
        <Button label={t('code.apply')} icon="ticket" onPress={applyCode} loading={applying} disabled={!codeInput.trim()} />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  option: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.three, paddingHorizontal: Spacing.two },
  notifRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.two, paddingHorizontal: Spacing.two },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: Spacing.two },
});
