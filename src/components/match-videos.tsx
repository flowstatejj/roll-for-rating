import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
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
          Alert.alert('Camera needed', 'Allow camera access to record the match.');
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
      Alert.alert('Upload failed', e.message ?? 'Could not add the video.');
    } finally {
      setBusy(false);
    }
  }

  function confirmDelete(video: MatchVideo) {
    Alert.alert('Remove video?', 'This deletes the video from the match.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteMatchVideo(video);
            await load();
          } catch (e: any) {
            Alert.alert('Could not remove', e.message ?? 'Try again.');
          }
        },
      },
    ]);
  }

  return (
    <View style={{ gap: Spacing.two }}>
      <ThemedText style={styles.label}>Match video</ThemedText>

      {videos.length === 0 && (
        <Card style={{ alignItems: 'center', paddingVertical: Spacing.four, gap: Spacing.one }}>
          <Ionicons name="videocam-outline" size={32} color={theme.textSecondary} />
          <ThemedText themeColor="textSecondary">No video yet</ThemedText>
        </Card>
      )}

      {videos.map((v) => (
        <View key={v.id} style={{ gap: Spacing.one }}>
          <VideoPlayerItem url={videoPublicUrl(v.path)} />
          {isParticipant && (
            <Pressable onPress={() => confirmDelete(v)} style={styles.deleteRow}>
              <Ionicons name="trash-outline" size={14} color={theme.danger} />
              <ThemedText type="small" style={{ color: theme.danger }}>
                Remove
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
              <ThemedText themeColor="textSecondary">Uploading…</ThemedText>
            </Card>
          ) : (
            <>
              <Button label="Upload a video" icon="cloud-upload" variant="secondary" onPress={() => addVideo(false)} />
              {Platform.OS !== 'web' && (
                <Button label="Record video" icon="videocam" variant="secondary" onPress={() => addVideo(true)} />
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
