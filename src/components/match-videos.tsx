import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, StyleSheet, View } from 'react-native';

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
            <Pressable onPress={() => confirmDelete(v)} style={styles.deleteRow}>
              <Ionicons name="trash-outline" size={14} color={theme.danger} />
              <ThemedText type="small" style={{ color: theme.danger }}>
                {t('mv.remove')}
              </ThemedText>
            </Pressable>
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
          ) : (
            <>
              <Button label={t('mv.upload')} icon="cloud-upload" variant="secondary" onPress={() => addVideo(false)} />
              {Platform.OS !== 'web' && (
                <Button label={t('mv.record')} icon="videocam" variant="secondary" onPress={() => addVideo(true)} />
              )}
            </>
          )}
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
  deleteRow: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-end', paddingVertical: 2 },
});
