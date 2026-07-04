import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, Vibration, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, TextField } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';

type Status = 'idle' | 'running' | 'paused';
interface TimerState {
  status: Status;
  durationSec: number;
  endsAt: number | null; // epoch ms when a running countdown hits 0
  remainingSec: number;  // shown when idle/paused
}

const fmt = (sec: number) =>
  `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;

/**
 * A settable countdown timer for a match, synced live to everyone viewing it via
 * a Supabase broadcast channel. Any participant (competitor or referee) can set,
 * start, pause and reset; the absolute end timestamp is shared so every device
 * shows the same countdown. Spectators see it read-only.
 */
export function MatchTimer({ matchId, canControl }: { matchId: string; canControl: boolean }) {
  const theme = useTheme();
  const { t } = useTranslation();

  const [st, setSt] = useState<TimerState>({ status: 'idle', durationSec: 300, endsAt: null, remainingSec: 300 });
  const [mm, setMm] = useState('05');
  const [ss, setSs] = useState('00');
  const [open, setOpen] = useState(false);
  const [display, setDisplay] = useState(300);

  const chanRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const stRef = useRef(st);
  const buzzedRef = useRef(false);
  useEffect(() => { stRef.current = st; }, [st]);

  // Live sync over a broadcast channel (no DB writes).
  useEffect(() => {
    const ch = supabase.channel(`match-timer:${matchId}`, { config: { broadcast: { self: true } } });
    ch.on('broadcast', { event: 'timer' }, ({ payload }) => {
      const s = payload as TimerState;
      buzzedRef.current = false;
      setSt(s);
      if (s.status !== 'idle') setOpen(true);
    });
    // A newly-opened screen asks for the current state; anyone running replies.
    ch.on('broadcast', { event: 'sync_req' }, () => {
      if (stRef.current.status !== 'idle') ch.send({ type: 'broadcast', event: 'timer', payload: stRef.current });
    });
    ch.subscribe((status) => {
      if (status === 'SUBSCRIBED') ch.send({ type: 'broadcast', event: 'sync_req', payload: {} });
    });
    chanRef.current = ch;
    return () => { supabase.removeChannel(ch); chanRef.current = null; };
  }, [matchId]);

  const push = useCallback((s: TimerState) => {
    buzzedRef.current = false;
    setSt(s);
    chanRef.current?.send({ type: 'broadcast', event: 'timer', payload: s });
  }, []);

  // Tick the display + fire the buzzer once at zero.
  useEffect(() => {
    const id = setInterval(() => {
      const s = stRef.current;
      if (s.status === 'running' && s.endsAt) {
        const rem = Math.max(0, Math.round((s.endsAt - Date.now()) / 1000));
        setDisplay(rem);
        if (rem === 0 && !buzzedRef.current) {
          buzzedRef.current = true;
          Vibration.vibrate([0, 400, 150, 400, 150, 400]);
          Alert.alert(t('tm.doneTitle'), t('tm.doneBody'));
        }
      } else {
        setDisplay(s.remainingSec);
      }
    }, 250);
    return () => clearInterval(id);
  }, [t]);

  function applyTime() {
    const dur = Math.max(1, (parseInt(mm, 10) || 0) * 60 + (parseInt(ss, 10) || 0));
    push({ status: 'idle', durationSec: dur, endsAt: null, remainingSec: dur });
  }
  function start() {
    const rem = st.status === 'paused' ? st.remainingSec : st.durationSec;
    if (rem <= 0) return;
    push({ status: 'running', durationSec: st.durationSec, endsAt: Date.now() + rem * 1000, remainingSec: rem });
  }
  function pause() {
    const rem = st.endsAt ? Math.max(0, Math.round((st.endsAt - Date.now()) / 1000)) : st.remainingSec;
    push({ status: 'paused', durationSec: st.durationSec, endsAt: null, remainingSec: rem });
  }
  function reset() {
    push({ status: 'idle', durationSec: st.durationSec, endsAt: null, remainingSec: st.durationSec });
  }

  // Collapsed entry point.
  if (!open && st.status === 'idle') {
    return <Button label={t('tm.enable')} icon="timer-outline" variant="secondary" onPress={() => setOpen(true)} />;
  }

  const atZero = st.status === 'running' && display === 0;
  return (
    <Card style={{ gap: Spacing.three, alignItems: 'center', borderWidth: 1, borderColor: atZero ? theme.danger : theme.tileBorder }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
        <Ionicons name="timer-outline" size={16} color={theme.textSecondary} />
        <ThemedText type="small" themeColor="textSecondary">{t('tm.title')}</ThemedText>
      </View>

      <ThemedText style={{ fontWeight: '900', fontSize: 56, lineHeight: 64, letterSpacing: 2, fontVariant: ['tabular-nums'], color: atZero ? theme.danger : theme.text }}>
        {fmt(display)}
      </ThemedText>

      {!canControl ? (
        <ThemedText type="small" themeColor="textSecondary">{t('tm.live')}</ThemedText>
      ) : st.status === 'idle' ? (
        <View style={{ gap: Spacing.two, alignItems: 'center' }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.two }}>
            <View style={{ width: 68 }}>
              <TextField label={t('tm.min')} value={mm} onChangeText={(v) => setMm(v.replace(/\D/g, '').slice(0, 2))} keyboardType="number-pad" />
            </View>
            <ThemedText style={{ fontWeight: '800', fontSize: 22, paddingBottom: 10 }}>:</ThemedText>
            <View style={{ width: 68 }}>
              <TextField label={t('tm.sec')} value={ss} onChangeText={(v) => { const n = v.replace(/\D/g, '').slice(0, 2); setSs(n === '' ? '' : String(Math.min(59, parseInt(n, 10) || 0))); }} keyboardType="number-pad" />
            </View>
            <Button label={t('tm.set')} variant="ghost" onPress={applyTime} />
          </View>
          <Button label={t('tm.start')} icon="play" onPress={start} />
        </View>
      ) : (
        <View style={styles.controls}>
          {st.status === 'running' ? (
            <Button label={t('tm.pause')} icon="pause" variant="secondary" onPress={pause} />
          ) : (
            <Button label={t('tm.resume')} icon="play" onPress={start} />
          )}
          <Button label={t('tm.reset')} icon="refresh" variant="ghost" onPress={reset} />
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  controls: { flexDirection: 'row', gap: Spacing.two },
});
