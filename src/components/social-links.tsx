import { Ionicons } from '@expo/vector-icons';
import { Alert, Linking, Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import { SOCIAL_KEYS, SOCIALS, socialUrl, type SocialKey } from '@/lib/socials';

type Links = Partial<Record<SocialKey, string | null>>;

/**
 * A row of tappable brand icons for whichever social links a profile has set.
 * Renders nothing if there are none, so it's safe to drop anywhere a profile is
 * shown (your own profile, an opponent, a leaderboard row, …).
 */
export function SocialLinks({ links, size = 24, style }: { links: Links; size?: number; style?: ViewStyle }) {
  const theme = useTheme();
  const items = SOCIAL_KEYS
    .map((key) => ({ key, url: socialUrl(key, links[key]) }))
    .filter((x): x is { key: SocialKey; url: string } => !!x.url);

  if (items.length === 0) return null;

  async function open(url: string) {
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert("Couldn't open link", url);
    }
  }

  return (
    <View style={[styles.row, style]}>
      {items.map(({ key, url }) => (
        <Pressable key={key} onPress={() => open(url)} hitSlop={8} style={styles.btn}>
          <Ionicons
            name={SOCIALS[key].icon}
            size={size}
            color={SOCIALS[key].color === '#000000' ? theme.text : SOCIALS[key].color}
          />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  btn: { padding: 2 },
});
