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

/** Upload a local image URI as `profileId`'s avatar and save the path on the profile. */
export async function uploadAvatar(profileId: string, uri: string): Promise<string> {
  const ext = (uri.split('?')[0].split('.').pop() || 'jpg').toLowerCase();
  const contentType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
  const path = `${profileId}/avatar.${ext}`;

  const blob = await (await fetch(uri)).blob();
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType, upsert: true });
  if (upErr) throw upErr;

  const { error: updErr } = await supabase.from('profiles').update({ avatar_path: path }).eq('id', profileId);
  if (updErr) throw updErr;
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
