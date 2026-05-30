import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { TatamiBackground } from '@/components/tatami-background';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, Loading, TextField } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { fetchMatch, fetchMatchMessages, sendMatchMessage, setMatchPlan } from '@/lib/matches';
import { supabase } from '@/lib/supabase';
import type { MatchMessage, MatchWithPeople } from '@/lib/types';

export default function MatchChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const theme = useTheme();
  const userId = session!.user.id;

  const [match, setMatch] = useState<MatchWithPeople | null>(null);
  const [messages, setMessages] = useState<MatchMessage[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);

  // Plan editor
  const [editingPlan, setEditingPlan] = useState(false);
  const [when, setWhen] = useState('');
  const [where, setWhere] = useState('');
  const [savingPlan, setSavingPlan] = useState(false);

  const scrollRef = useRef<ScrollView>(null);

  const loadMessages = useCallback(async () => {
    if (!id) return;
    try {
      setMessages(await fetchMatchMessages(id));
    } catch (e) {
      console.warn('load messages failed', e);
    }
  }, [id]);

  const loadMatch = useCallback(async () => {
    if (!id) return;
    try {
      setMatch(await fetchMatch(id));
    } catch (e) {
      console.warn('load match failed', e);
    }
  }, [id]);

  useEffect(() => {
    (async () => {
      await Promise.all([loadMatch(), loadMessages()]);
      setLoading(false);
    })();
  }, [loadMatch, loadMessages]);

  // Live chat.
  useEffect(() => {
    if (!id) return;
    const channel = supabase
      .channel(`chat-${id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'match_messages', filter: `match_id=eq.${id}` }, () => loadMessages())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [id, loadMessages]);

  async function send() {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setText('');
    try {
      await sendMatchMessage(id!, userId, body);
      await loadMessages();
    } catch (e: any) {
      Alert.alert('Could not send', e.message ?? 'Try again.');
      setText(body);
    } finally {
      setSending(false);
    }
  }

  function startEditPlan() {
    setWhen(match?.meet_when ?? '');
    setWhere(match?.meet_where ?? '');
    setEditingPlan(true);
  }

  async function savePlan() {
    setSavingPlan(true);
    try {
      await setMatchPlan(id!, when, where);
      await loadMatch();
      setEditingPlan(false);
    } catch (e: any) {
      Alert.alert('Could not save', e.message ?? 'Try again.');
    } finally {
      setSavingPlan(false);
    }
  }

  if (loading || !match) return <Loading />;

  const hasPlan = !!(match.meet_when || match.meet_where);

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <Stack.Screen options={{ title: 'Match chat' }} />
      <TatamiBackground />
      <SafeAreaView style={{ flex: 1 }} edges={['bottom']}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          {/* When & where */}
          <View style={{ padding: Spacing.three, paddingBottom: 0 }}>
            <Card style={{ gap: Spacing.two }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
                <Ionicons name="calendar" size={18} color={theme.accent} />
                <ThemedText style={{ fontWeight: '800', flex: 1 }}>When &amp; where</ThemedText>
                {!editingPlan && (
                  <Pressable onPress={startEditPlan} hitSlop={8}>
                    <ThemedText style={{ color: theme.accent, fontWeight: '700' }}>{hasPlan ? 'Edit' : 'Set'}</ThemedText>
                  </Pressable>
                )}
              </View>
              {editingPlan ? (
                <View style={{ gap: Spacing.two }}>
                  <TextField label="When" value={when} onChangeText={setWhen} placeholder="Sat 11:00 AM" />
                  <TextField label="Where" value={where} onChangeText={setWhere} placeholder="Springfield Open Mat / after class" />
                  <Button label="Save plan" loading={savingPlan} onPress={savePlan} />
                  <Button label="Cancel" variant="ghost" onPress={() => setEditingPlan(false)} />
                </View>
              ) : hasPlan ? (
                <View style={{ gap: 2 }}>
                  {match.meet_when ? <ThemedText>🕒 {match.meet_when}</ThemedText> : null}
                  {match.meet_where ? <ThemedText>📍 {match.meet_where}</ThemedText> : null}
                </View>
              ) : (
                <ThemedText type="small" themeColor="textSecondary">
                  Not set yet — agree on a time and place below.
                </ThemedText>
              )}
            </Card>
          </View>

          {/* Messages */}
          <ScrollView
            ref={scrollRef}
            style={{ flex: 1 }}
            contentContainerStyle={{ padding: Spacing.three, gap: Spacing.two }}
            onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}>
            {messages.length === 0 && (
              <ThemedText themeColor="textSecondary" style={{ textAlign: 'center', paddingVertical: Spacing.four }}>
                No messages yet. Say hi and lock in the details.
              </ThemedText>
            )}
            {messages.map((m) => {
              const mine = m.sender_id === userId;
              return (
                <View key={m.id} style={{ alignItems: mine ? 'flex-end' : 'flex-start' }}>
                  {!mine && (
                    <ThemedText type="small" themeColor="textSecondary" style={{ marginLeft: Spacing.two, marginBottom: 2 }}>
                      {m.sender?.display_name ?? 'Member'}
                    </ThemedText>
                  )}
                  <View
                    style={[
                      styles.bubble,
                      mine
                        ? { backgroundColor: theme.accent }
                        : { backgroundColor: theme.backgroundElement, borderColor: theme.border, borderWidth: StyleSheet.hairlineWidth },
                    ]}>
                    <ThemedText style={{ color: mine ? theme.accentText : theme.text }}>{m.body}</ThemedText>
                  </View>
                </View>
              );
            })}
          </ScrollView>

          {/* Composer */}
          <View style={[styles.composer, { borderTopColor: theme.border, backgroundColor: theme.background }]}>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder="Message…"
              placeholderTextColor={theme.textSecondary}
              style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
              multiline
              onSubmitEditing={send}
            />
            <Pressable onPress={send} disabled={sending || !text.trim()} style={[styles.send, { backgroundColor: theme.accent, opacity: !text.trim() ? 0.5 : 1 }]}>
              <Ionicons name="send" size={18} color={theme.accentText} />
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  bubble: { maxWidth: '82%', borderRadius: 14, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.two,
    padding: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 16,
  },
  send: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
});
