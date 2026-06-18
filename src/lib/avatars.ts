import { decode } from 'base64-arraybuffer';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';

import { supabase } from './supabase';

const BUCKET = 'avatars';

/**
 * Let the user pick (or shoot) a square profile photo. Returns the local file
 * URI, or null if they cancelled / denied permission.
 * (Phase 2 will run an on-device face check on this URI before uploading.)
 */
export async function pickAvatar(fromCamera: boolean): Promise<string | null> {
  if (fromCamera) {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return null;
    const res = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });
    return res.canceled ? null : res.assets[0].uri;
  }
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.7,
  });
  return res.canceled ? null : res.assets[0].uri;
}

/**
 * Server-side check that the image shows one clear human face, via the
 * `verify-face` edge function (Claude vision). On-device ML Kit doesn't link
 * under this app's New Architecture, so verification runs on the server.
 *
 * Only call this for ADULT profiles — minors / managed juniors skip the face
 * check (their photo just needs to exist and is gated behind an accepted match
 * by storage RLS).
 *
 * A real verdict of `false` (Claude saw no clear human face) blocks the upload.
 * But if the check can't RUN — the function isn't deployed yet, the device is
 * offline, or the AI errored — we degrade OPEN and allow the upload rather than
 * hard-block it. The gate therefore turns on automatically once verify-face is
 * deployed, with no client update needed.
 */
export async function hasHumanFace(uri: string): Promise<boolean> {
  try {
    const ext = (uri.split('?')[0].split('.').pop() || 'jpg').toLowerCase();
    const media_type = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    const image_base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });

    const { data, error } = await supabase.functions.invoke('verify-face', {
      body: { image_base64, media_type },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data?.face === true;
  } catch (e) {
    console.warn('Face check unavailable — allowing upload:', e);
    return true;
  }
}

/** Save a non-photographic warrior avatar (the only avatar minors can use). */
export async function setWarriorAvatar(profileId: string, warrior: string, color: string): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update({ avatar_warrior: warrior, avatar_color: color, avatar_path: null })
    .eq('id', profileId);
  if (error) throw error;
}

/** Upload a local image URI as `profileId`'s avatar and save the path on the profile. */
export async function uploadAvatar(profileId: string, uri: string): Promise<string> {
  const ext = (uri.split('?')[0].split('.').pop() || 'jpg').toLowerCase();
  const contentType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
  // Unique path per upload: a fresh object the CDN has never cached, and a path
  // string that actually CHANGES so the UI re-resolves immediately (no stale
  // photo for a few seconds after changing it).
  const path = `${profileId}/avatar-${Date.now()}.${ext}`;

  // Remember the current avatar so we can delete it once the new one is saved.
  const { data: prof } = await supabase.from('profiles').select('avatar_path').eq('id', profileId).single();
  const prevPath = (prof as { avatar_path: string | null } | null)?.avatar_path ?? null;

  // RN can't make a Blob from an ArrayBuffer, so read the file as base64 and
  // upload an ArrayBuffer directly (the supported Expo + Supabase path).
  const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, decode(base64), { contentType, upsert: true });
  if (upErr) throw upErr;

  const { error: updErr } = await supabase
    .from('profiles')
    .update({ avatar_path: path, avatar_warrior: null, avatar_color: null })
    .eq('id', profileId);
  if (updErr) throw updErr;

  // Best-effort cleanup of the old file so storage doesn't accumulate.
  if (prevPath && prevPath !== path) {
    supabase.storage.from(BUCKET).remove([prevPath]).then(() => {}, () => {});
  }
  return path;
}

/**
 * Short-lived signed URL for a stored avatar. Returns null if the path is empty
 * or the viewer isn't allowed to see it (the storage read policy gates minors'
 * photos behind an accepted match).
 */
export async function avatarSignedUrl(path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
  if (error) return null;
  return data?.signedUrl ?? null;
}

/**
 * Batch-resolve signed URLs for many avatar paths in ONE request (e.g. the
 * leaderboard). Returns a path -> URL map; paths the viewer can't read (gated
 * minor photos) are simply omitted, so those rows fall back to their avatar.
 */
export async function avatarSignedUrls(paths: (string | null | undefined)[]): Promise<Record<string, string>> {
  const unique = [...new Set(paths.filter((p): p is string => !!p))];
  if (unique.length === 0) return {};
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(unique, 3600);
  if (error || !data) return {};
  const map: Record<string, string> = {};
  for (const d of data) {
    if (d.path && d.signedUrl) map[d.path] = d.signedUrl;
  }
  return map;
}
