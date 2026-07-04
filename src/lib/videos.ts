import { Platform } from 'react-native';

import { supabase } from './supabase';
import { saveForUpload, uploadPending, type PendingVideo } from './video-queue';
import type { MatchVideo } from './types';

const BUCKET = 'match-videos';

/** Result of trying to upload a recorded clip. On native with no connection the
 *  clip is safely queued and will upload later, so this is not an error. */
export type UploadResult =
  | { status: 'uploaded'; video: MatchVideo | null }
  | { status: 'queued'; item: PendingVideo };

/**
 * Time-limited SIGNED playback URL for a stored video path. The match-videos
 * bucket is PRIVATE (a match video can show a minor), so there is no public URL.
 * Supabase only issues the signed URL if the caller may read the object per the
 * bucket's RLS (a participant, or the match is public). Returns null on failure.
 */
export async function videoSignedUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
  if (error) {
    console.warn('Failed to sign video url', error.message);
    return null;
  }
  return data?.signedUrl ?? null;
}

/** All videos attached to a match, oldest first. */
export async function fetchMatchVideos(matchId: string): Promise<MatchVideo[]> {
  const { data, error } = await supabase
    .from('match_videos')
    .select('*')
    .eq('match_id', matchId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as MatchVideo[];
}

function extFor(mimeType?: string, fileName?: string): string {
  if (fileName && fileName.includes('.')) return fileName.split('.').pop()!.toLowerCase();
  if (mimeType?.includes('quicktime') || mimeType?.includes('mov')) return 'mov';
  return 'mp4';
}

/**
 * Upload a recorded clip. On native the clip is first persisted + queued (so it
 * survives an offline gym), then uploaded with progress; if the upload fails it
 * stays queued and returns { status: 'queued' } instead of throwing. Web uploads
 * directly. `onProgress` reports 0..1 during a native upload.
 */
export async function uploadMatchVideo(
  args: {
    matchId: string;
    uploaderId: string;
    uri: string;
    mimeType?: string;
    fileName?: string;
    stamp: number; // pass Date.now() from the caller (UI layer)
  },
  onProgress?: (fraction: number) => void,
): Promise<UploadResult> {
  if (Platform.OS === 'web') {
    const contentType = args.mimeType || 'video/mp4';
    const ext = extFor(contentType, args.fileName);
    const path = `${args.matchId}/${args.stamp}.${ext}`;
    const res = await fetch(args.uri);
    const blob = await res.blob();
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(path, blob, { contentType, upsert: false });
    if (upErr) throw upErr;
    const { data, error } = await supabase
      .from('match_videos')
      .insert({ match_id: args.matchId, uploader_id: args.uploaderId, path })
      .select('*')
      .single();
    if (error) throw error;
    return { status: 'uploaded', video: data as MatchVideo };
  }

  // Native: persist + queue first so the clip is never lost, then try now.
  const item = await saveForUpload(args);
  try {
    const video = await uploadPending(item, onProgress);
    return { status: 'uploaded', video };
  } catch {
    // No connection / upload rejected - it stays saved and retries later.
    return { status: 'queued', item };
  }
}

/** Remove a video (storage file + row). */
export async function deleteMatchVideo(video: MatchVideo): Promise<void> {
  await supabase.storage.from(BUCKET).remove([video.path]);
  const { error } = await supabase.from('match_videos').delete().eq('id', video.id);
  if (error) throw error;
}
