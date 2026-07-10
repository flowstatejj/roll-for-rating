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
import { deleteMatchVideo, fetchMatchVideos, videoSignedUrl } from '@/lib/videos';
import { pendingForMatch, saveForUpload, uploadPending, type PendingVideo } from '@/lib/video-queue';
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
  // Signed playback URLs by video id (the bucket is private — no public URL).
  const [urls, setUrls] = useState<Record<string, string>>({});
  // Videos recorded but not yet uploaded (offline queue), for this match.
  const [pending, setPending] = useState<PendingVideo[]>([]);
  // Live upload progress 0..1 by pending-video id (present only while uploading).
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  // Which clip has a live player mounted. Clips render as tap-to-play poster
  // tiles so multiple players never run at once (tapping one swaps the active one).
  const [playingId, setPlayingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [vids, queued] = await Promise.all([fetchMatchVideos(matchId), pendingForMatch(matchId)]);
      setVideos(vids);
      setPending(queued);
      const entries = await Promise.all(
        vids.map(async (v) => [v.id, await videoSignedUrl(v.path)] as const),
      );
      setUrls(Object.fromEntries(entries.filter((e): e is [string, string] => !!e[1])));
    } catch (e) {
      console.warn('Failed to load videos', e);
    }
  }, [matchId]);

  useEffect(() => { load(); }, [load]);

  const setPct = (id: string, f: number) => setProgress((p) => ({ ...p, [id]: f }));
  const clearPct = (id: string) =>
    setProgress((p) => {
      const n = { ...p };
      delete n[id];
      return n;
    });

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
        ? await ImagePicker.launchCameraAsync({
            mediaTypes: ['videos'],
            videoMaxDuration: 600,
            // Pin to a FIXED 720p H.264 (capture + export) so a match is never
            // recorded in 4K/1080p - keeps files a manageable upload size while
            // staying sharp enough to review technique. (iOS options; Android
            // captures at the device default.)
            videoQuality: ImagePicker.UIImagePickerControllerQualityType.IFrame1280x720,
            videoExportPreset: ImagePicker.VideoExportPreset.H264_1280x720,
          })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'] });

      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];

      setBusy(true);
      // Persist + queue the clip FIRST so it's never lost, then try to upload.
      const item = await saveForUpload({
        matchId,
        uploaderId,
        uri: asset.uri,
        mimeType: asset.mimeType ?? undefined,
        stamp: Date.now(),
      });
      setPending((p) => [...p, item]);
      setPct(item.id, 0);
      try {
        await uploadPending(item, (f) => setPct(item.id, f));
      } catch {
        Alert.alert(
          'Saved',
          "No connection right now - your video is saved and will upload automatically when you're back online.",
        );
      } finally {
        clearPct(item.id);
      }
      await load();
    } catch (e: any) {
      Alert.alert(t('mv.uploadFailTitle'), e.message ?? t('mv.uploadFailBody'));
    } finally {
      setBusy(false);
    }
  }

  async function retry(item: PendingVideo) {
    setPct(item.id, 0);
    try {
      await uploadPending(item, (f) => setPct(item.id, f));
      await load();
    } catch {
      Alert.alert('Still offline', "Couldn't upload yet - it will keep trying automatically when you have a connection.");
    } finally {
      clearPct(item.id);
    }
  }

  // Share/save the raw local file for a not-yet-uploaded clip (works offline, so
  // either competitor can grab a copy at the gym before it uploads).
  async function savePending(item: PendingVideo) {
    try {
      await Share.share(Platform.OS === 'ios' ? { url: item.localUri } : { url: item.localUri });
    } catch (e: any) {
      Alert.alert(t('mv.saveFail'), e.message ?? t('md.tryAgain'));
    }
  }

  // Download an uploaded video and open the OS share sheet so either participant
  // can keep it (Save Video) or use it (send / post).
  async function saveVideo(v: MatchVideo) {
    try {
      setSavingId(v.id);
      const url = urls[v.id] ?? (await videoSignedUrl(v.path));
      if (!url) throw new Error(t('mv.saveFail'));
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

      {videos.length === 0 && pending.length === 0 && (
        <Card style={{ alignItems: 'center', paddingVertical: Spacing.four, gap: Spacing.one }}>
          <Ionicons name="videocam-outline" size={32} color={theme.textSecondary} />
          <ThemedText themeColor="textSecondary">{t('mv.noVideo')}</ThemedText>
        </Card>
      )}

      {videos.map((v) => (
        <View key={v.id} style={{ gap: Spacing.one }}>
          {!urls[v.id] ? (
            <View style={[styles.video, styles.videoLoading]}>
              <ActivityIndicator color={theme.accent} />
            </View>
          ) : playingId === v.id ? (
            <VideoPlayerItem url={urls[v.id]} />
          ) : (
            <Pressable onPress={() => setPlayingId(v.id)} style={[styles.video, styles.videoLoading]}>
              <Ionicons name="play-circle" size={56} color="rgba(255,255,255,0.9)" />
            </Pressable>
          )}
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

      {/* Recorded-but-not-yet-uploaded clips (offline queue). */}
      {pending.map((item) => {
        const pct = progress[item.id];
        const uploading = pct != null;
        return (
          <Card key={item.id} style={{ gap: Spacing.two }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
              <Ionicons
                name={uploading ? 'cloud-upload-outline' : 'cloud-offline-outline'}
                size={18}
                color={theme.textSecondary}
              />
              <ThemedText type="small" themeColor="textSecondary" style={{ flex: 1 }}>
                {uploading
                  ? `Uploading ${Math.round(pct * 100)}%`
                  : 'Saved - will upload when you are back online'}
              </ThemedText>
            </View>
            {uploading ? (
              <View style={[styles.barTrack, { backgroundColor: theme.tileBorder }]}>
                <View
                  style={[styles.barFill, { width: `${Math.round(pct * 100)}%`, backgroundColor: theme.accent }]}
                />
              </View>
            ) : (
              isParticipant && (
                <View style={styles.actionsRow}>
                  <Pressable onPress={() => savePending(item)} style={styles.deleteRow}>
                    <Ionicons name="download-outline" size={14} color={theme.accent} />
                    <ThemedText type="small" style={{ color: theme.accent }}>
                      {t('mv.save')}
                    </ThemedText>
                  </Pressable>
                  <Pressable onPress={() => retry(item)} style={styles.deleteRow}>
                    <Ionicons name="refresh" size={14} color={theme.accent} />
                    <ThemedText type="small" style={{ color: theme.accent }}>
                      Retry
                    </ThemedText>
                  </Pressable>
                </View>
              )
            )}
          </Card>
        );
      })}

      {isParticipant && Platform.OS !== 'web' && (
        // Record films live and auto-posts to the match - no separate upload step.
        <Button label={t('mv.record')} icon="videocam" variant="secondary" loading={busy} onPress={() => addVideo(true)} />
      )}

      <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center' }}>
        Videos are kept for 2 weeks, then automatically deleted.
      </ThemedText>
    </View>
  );
}

function VideoPlayerItem({ url }: { url: string }) {
  const player = useVideoPlayer(url, (p) => {
    p.loop = false;
    // Mounted only after the user taps the poster tile, so start right away.
    p.play();
  });
  return <VideoView style={styles.video} player={player} contentFit="contain" nativeControls />;
}

const styles = StyleSheet.create({
  label: { fontSize: 18, fontWeight: '800' },
  video: { width: '100%', aspectRatio: 16 / 9, borderRadius: 12, backgroundColor: '#000' },
  videoLoading: { alignItems: 'center', justifyContent: 'center' },
  deleteRow: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 2 },
  actionsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: Spacing.three },
  barTrack: { height: 6, borderRadius: 3, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3 },
});
