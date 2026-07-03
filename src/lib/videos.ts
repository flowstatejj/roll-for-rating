import { supabase } from './supabase';
import type { MatchVideo } from './types';

const BUCKET = 'match-videos';

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
 * Upload a video file (from the picker/camera) to storage and link it to the
 * match. Works on web (blob: URLs) and native (file:// URIs) via fetch→blob.
 */
export async function uploadMatchVideo(args: {
  matchId: string;
  uploaderId: string;
  uri: string;
  mimeType?: string;
  fileName?: string;
  stamp: number; // pass Date.now() from the caller (UI layer)
}): Promise<MatchVideo> {
  const res = await fetch(args.uri);
  const blob = await res.blob();
  const contentType = args.mimeType || blob.type || 'video/mp4';
  const ext = extFor(contentType, args.fileName);
  const path = `${args.matchId}/${args.stamp}.${ext}`;

  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, blob, {
    contentType,
    upsert: false,
  });
  if (upErr) throw upErr;

  const { data, error } = await supabase
    .from('match_videos')
    .insert({ match_id: args.matchId, uploader_id: args.uploaderId, path })
    .select('*')
    .single();
  if (error) throw error;
  return data as MatchVideo;
}

/** Remove a video (storage file + row). */
export async function deleteMatchVideo(video: MatchVideo): Promise<void> {
  await supabase.storage.from(BUCKET).remove([video.path]);
  const { error } = await supabase.from('match_videos').delete().eq('id', video.id);
  if (error) throw error;
}
