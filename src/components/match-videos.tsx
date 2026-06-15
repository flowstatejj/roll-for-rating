import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, Share, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/lib/i18n';
import { deleteMatchVideo, fetchMatchVideos, uploadMatchVideo, videoPublicUrl } from '@/lib/videos';
import type { MatchVideo } from '@/lib/types';

export function MatchVideos({
  matchId,
  uploaderId,
  isParticipant,
}: {
  matchId: string;
  uploaderId: string;
  isParticipant: boolean;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const [videos, setVideos] = useState<MatchVideo[]>([]);
  const [busy, setBusy] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setVideos(await fetchMatchVideos(matchId));
    } catch (e) {
      console.warn('Failed to load videos', e);
    }
  }, [matchId]);

  useEffect(() => { load(); }, [load]);

  async function addVideo(fromCamera: boolean) {
    try {
      if (fromCamera) {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          Alert.alert(t('mv.cameraTitle'), t('mv.cameraBody'));
          return;
        }
      }
      const result = fromCamera
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['videos'], videoMaxDuration: 600 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'] });

      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];

      setBusy(true);
      await uploadMatchVideo({
        matchId,
        uploaderId,
        uri: asset.uri,
        mimeType: asset.mimeType ?? undefined,
        fileName: asset.fileName ?? undefined,
        stamp: Date.now(),
      });
      await load();
    } catch (e: any) {
      Alert.alert(t('mv.uploadFailTitle'), e.message ?? t('mv.uploadFailBody'));
    } finally {
      setBusy(false);
    }
  }

  // Download the match video and open the OS share sheet so a participant can
  // keep it (Save Video) or use it (send / post). Public URL works everywhere.
  async function saveVideo(v: MatchVideo) {
    const url = videoPublicUrl(v.path);
    try {
      setSavingId(v.id);
      if (Platform.OS === 'web') {
        await Share.share({ message: url });
        return;
      }
      const target = `${FileSystem.cacheDirectory}match-${v.id}.mp4`;
      const { uri } = await FileSystem.downloadAsync(url, target);
      await Share.share(Platform.OS === 'ios' ? { url: uri } : { url: uri, message: url });
    } catch (e: any) {
      Alert.alert(t('mv.saveFail'), e.message ?? t('md.tryAgain'));
    } finally {
      setSavingId(null);
    }
  }

  function confirmDelete(video: MatchVideo) {
    Alert.alert(t('mv.removeTitle'), t('mv.removeBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('mv.remove'),
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteMatchVideo(video);
            await load();
          } catch (e: any) {
            Alert.alert(t('mv.removeFail'), e.message ?? t('md.tryAgain'));
          }
        },
      },
    ]);
  }

  return (
    <View style={{ gap: Spacing.two }}>
      <ThemedText style={styles.label}>{t('mv.label')}</ThemedText>

      {videos.length === 0 && (
        <Card style={{ alignItems: 'center', paddingVertical: Spacing.four, gap: Spacing.one }}>
          <Ionicons name="videocam-outline" size={32} color={theme.textSecondary} />
          <ThemedText themeColor="textSecondary">{t('mv.noVideo')}</ThemedText>
        </Card>
      )}

      {videos.map((v) => (
        <View key={v.id} style={{ gap: Spacing.one }}>
          <VideoPlayerItem url={videoPublicUrl(v.path)} />
          {isParticipant && (
            <View style={styles.actionsRow}>
              <Pressable onPress={() => saveVideo(v)} disabled={savingId === v.id} style={styles.deleteRow}>
                {savingId === v.id ? (
                  <ActivityIndicator size="small" color={theme.accent} />
                ) : (
                  <Ionicons name="download-outline" size={14} color={theme.accent} />
                )}
                <ThemedText type="small" style={{ color: theme.accent }}>
                  {t('mv.save')}
                </ThemedText>
              </Pressable>
              <Pressable onPress={() => confirmDelete(v)} style={styles.deleteRow}>
                <Ionicons name="trash-outline" size={14} color={theme.danger} />
                <ThemedText type="small" style={{ color: theme.danger }}>
                  {t('mv.remove')}
                </ThemedText>
              </Pressable>
            </View>
          )}
        </View>
      ))}

      {isParticipant && (
        <View style={{ gap: Spacing.two }}>
          {busy ? (
            <Card style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.two }}>
              <ActivityIndicator color={theme.accent} />
              <ThemedText themeColor="textSecondary">{t('mv.uploading')}</ThemedText>
            </Card>
          ) : Platform.OS !== 'web' ? (
            // Record films live and auto-posts to the match — no separate upload step.
            <Button label={t('mv.record')} icon="videocam" variant="secondary" onPress={() => addVideo(true)} />
          ) : null}
        </View>
      )}
    </View>
  );
}

function VideoPlayerItem({ url }: { url: string }) {
  const player = useVideoPlayer(url, (p) => {
    p.loop = false;
  });
  return <VideoView style={styles.video} player={player} contentFit="contain" nativeControls />;
}

const styles = StyleSheet.create({
  label: { fontSize: 18, fontWeight: '800' },
  video: { width: '100%', aspectRatio: 16 / 9, borderRadius: 12, backgroundColor: '#000' },
  deleteRow: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 2 },
  actionsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: Spacing.three },
});
