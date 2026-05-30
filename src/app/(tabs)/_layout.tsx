import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';

import { usePendingCount } from '@/hooks/use-pending';
import { useTheme } from '@/hooks/use-theme';

export default function TabsLayout() {
  const theme = useTheme();
  const pending = usePendingCount();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.accent,
        tabBarInactiveTintColor: theme.textSecondary,
        tabBarStyle: { backgroundColor: theme.background, borderTopColor: theme.border },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, size }) => <Ionicons name="home" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="puzzles"
        options={{
          title: 'Puzzles',
          tabBarIcon: ({ color, size }) => <Ionicons name="extension-puzzle" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="matches"
        options={{
          title: 'Matches',
          tabBarBadge: pending > 0 ? pending : undefined,
          tabBarIcon: ({ color, size }) => <Ionicons name="list" size={size} color={color} />,
        }}
      />
      {/* Ranks reachable from Home + Community; hidden from the bar to keep it to 5 */}
      <Tabs.Screen name="leaderboard" options={{ href: null, title: 'Ranks' }} />
      <Tabs.Screen
        name="community"
        options={{
          title: 'Community',
          tabBarIcon: ({ color, size }) => <Ionicons name="people" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, size }) => <Ionicons name="person" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
