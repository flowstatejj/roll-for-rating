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

const VIDEO_WORKER_URL = process.env.EXPO_PUBLIC_VIDEO_WORKER_URL ?? '';

/**
 * Time-limited SIGNED playback URL for a stored video path. Videos live in
 * Cloudflare R2 (free egress); access (participant, or public match) is checked
 * before returning a presigned R2 GET URL. Presigning runs on the Cloudflare
 * Worker when EXPO_PUBLIC_VIDEO_WORKER_URL is set (far cheaper per view at
 * scale), and falls back to the Supabase video-url edge function otherwise.
 * Returns null on failure.
 */
export async function videoSignedUrl(path: string): Promise<string | null> {
  if (VIDEO_WORKER_URL) {
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (token) {
        const res = await fetch(VIDEO_WORKER_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ path }),
        });
        if (res.ok) {
          const j = (await res.json()) as { url?: string };
          if (j?.url) return j.url;
        }
      }
    } catch {
      /* fall back to the edge function below */
    }
  }

  const { data, error } = await supabase.functions.invoke('video-url', {
    body: { op: 'play', path },
  });
  if (error || !data?.url) {
    console.warn('Failed to sign video url', error?.message);
    return null;
  }
  return data.url as string;
}

/** The newest 10 videos attached to a match, oldest first. */
export async function fetchMatchVideos(matchId: string): Promise<MatchVideo[]> {
  const { data, error } = await supabase
    .from('match_videos')
    .select('*')
    .eq('match_id', matchId)
    .order('created_at', { ascending: false })
    .limit(10);
  if (error) throw error;
  // Newest 10, shown oldest-first so a fresh upload always appears (at the end).
  return ((data ?? []) as MatchVideo[]).reverse();
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

/** Remove a video (R2 file via the edge function + the DB row). */
export async function deleteMatchVideo(video: MatchVideo): Promise<void> {
  // Best-effort R2 delete (edge fn checks participation); always remove the row.
  await supabase.functions.invoke('video-url', { body: { op: 'delete', path: video.path } }).catch(() => {});
  const { error } = await supabase.from('match_videos').delete().eq('id', video.id);
  if (error) throw error;
}
