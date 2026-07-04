// Offline-resilient match-video uploads.
//
// A recorded video is first COPIED into permanent app storage and added to a
// persisted queue, THEN uploaded. If the upload fails (no wifi/service at the
// gym) the file and its queue entry survive, so it uploads later - on the next
// app foreground with a connection, or via a manual Retry. The local copy also
// lets a participant save/share the clip before it has uploaded.
//
// Native only (uses expo-file-system). Web uploads directly (see videos.ts).
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';

import { supabase } from './supabase';
import type { MatchVideo } from './types';

const BUCKET = 'match-videos';
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
const QUEUE_KEY = 'pending_video_uploads_v1';
const PENDING_DIR = `${FileSystem.documentDirectory ?? ''}pending-videos/`;

export interface PendingVideo {
  id: string; // stamp-based, unique
  matchId: string;
  uploaderId: string;
  localUri: string; // persistent copy in documentDirectory
  path: string; // storage path: <matchId>/<stamp>.<ext>
  contentType: string;
  createdAt: number;
}

async function getQueue(): Promise<PendingVideo[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as PendingVideo[]) : [];
  } catch {
    return [];
  }
}
async function setQueue(q: PendingVideo[]): Promise<void> {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(q));
}
async function removeFromQueue(id: string): Promise<void> {
  await setQueue((await getQueue()).filter((v) => v.id !== id));
}

/** Pending (not-yet-uploaded) videos for one match, for the UI. */
export async function pendingForMatch(matchId: string): Promise<PendingVideo[]> {
  return (await getQueue()).filter((v) => v.matchId === matchId);
}

function extFor(contentType: string, uri: string): string {
  if (/\.mov($|\?)/i.test(uri) || contentType.includes('quicktime')) return 'mov';
  return 'mp4';
}

/**
 * Persist a just-recorded video into app storage and queue it. The copy means
 * the clip is never lost even if the upload fails or the OS clears the picker's
 * temp file. Returns the queued item.
 */
export async function saveForUpload(args: {
  matchId: string;
  uploaderId: string;
  uri: string;
  mimeType?: string;
  stamp: number;
}): Promise<PendingVideo> {
  const contentType =
    args.mimeType || (/\.mov($|\?)/i.test(args.uri) ? 'video/quicktime' : 'video/mp4');
  const ext = extFor(contentType, args.uri);
  await FileSystem.makeDirectoryAsync(PENDING_DIR, { intermediates: true }).catch(() => {});
  const localUri = `${PENDING_DIR}${args.stamp}.${ext}`;
  await FileSystem.copyAsync({ from: args.uri, to: localUri });

  const item: PendingVideo = {
    id: String(args.stamp),
    matchId: args.matchId,
    uploaderId: args.uploaderId,
    localUri,
    path: `${args.matchId}/${args.stamp}.${ext}`,
    contentType,
    createdAt: args.stamp,
  };
  await setQueue([...(await getQueue()), item]);
  return item;
}

/**
 * Upload one queued item, reporting progress 0..1. On success: insert the
 * match_videos row, delete the local copy, dequeue. Throws on failure (the item
 * stays queued for a later retry).
 */
export async function uploadPending(
  item: PendingVideo,
  onProgress?: (fraction: number) => void,
): Promise<MatchVideo | null> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  if (!token) throw new Error('You are signed out - sign in and try again.');

  const task = FileSystem.createUploadTask(
    `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${item.path}`,
    item.localUri,
    {
      httpMethod: 'POST',
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: ANON_KEY,
        'Content-Type': item.contentType,
        // Upsert so a retry to the same path (after a partial attempt) succeeds.
        'x-upsert': 'true',
        'cache-control': '3600',
      },
    },
    (p) => {
      if (onProgress && p.totalBytesExpectedToSend > 0) {
        onProgress(Math.min(1, p.totalBytesSent / p.totalBytesExpectedToSend));
      }
    },
  );

  const result = await task.uploadAsync();
  if (!result || result.status !== 200) {
    let msg = `Upload failed (${result?.status ?? 'no response'}).`;
    try {
      const b = JSON.parse(result?.body ?? '');
      if (b?.message) msg = b.message;
    } catch {
      if (result?.body) msg = result.body.slice(0, 200);
    }
    throw new Error(msg);
  }

  const { data, error } = await supabase
    .from('match_videos')
    .insert({ match_id: item.matchId, uploader_id: item.uploaderId, path: item.path })
    .select('*')
    .single();
  // A duplicate means a prior attempt inserted the row but failed to dequeue -
  // treat as success rather than re-throwing.
  if (error && !/duplicate|unique/i.test(error.message)) throw error;

  await FileSystem.deleteAsync(item.localUri, { idempotent: true }).catch(() => {});
  await removeFromQueue(item.id);
  return (data as MatchVideo) ?? null;
}

/**
 * Best-effort retry of every queued upload (e.g. on app foreground). Failures
 * stay queued. Serial so uploads don't fight for bandwidth. Returns #succeeded.
 */
export async function processQueue(
  onProgress?: (id: string, fraction: number) => void,
): Promise<number> {
  let ok = 0;
  for (const item of await getQueue()) {
    try {
      await uploadPending(item, (f) => onProgress?.(item.id, f));
      ok++;
    } catch {
      // leave it queued for next time
    }
  }
  return ok;
}
