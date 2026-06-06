import FaceDetection from '@react-native-ml-kit/face-detection';
import { decode } from 'base64-arraybuffer';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

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
 * On-device check that the image contains at least one clear human face. Runs
 * entirely on the phone (ML Kit) — the photo is never sent anywhere to verify.
 * Fails OPEN if detection itself errors (e.g. on web, where there's no native
 * module), but fails CLOSED when it runs and finds no face.
 */
export async function hasHumanFace(uri: string): Promise<boolean> {
  // No native detector on web — don't block there.
  if (Platform.OS === 'web') return true;
  // On a device, run it for real. If the native module throws (e.g. not linked),
  // let the error propagate so it's visible instead of silently allowing anything.
  const faces = await FaceDetection.detect(uri, { performanceMode: 'accurate', minFaceSize: 0.15 });
  return faces.length >= 1;
}

/** Upload a local image URI as `profileId`'s avatar and save the path on the profile. */
export async function uploadAvatar(profileId: string, uri: string): Promise<string> {
  const ext = (uri.split('?')[0].split('.').pop() || 'jpg').toLowerCase();
  const contentType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
  const path = `${profileId}/avatar.${ext}`;

  // RN can't make a Blob from an ArrayBuffer, so read the file as base64 and
  // upload an ArrayBuffer directly (the supported Expo + Supabase path).
  const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, decode(base64), { contentType, upsert: true });
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
