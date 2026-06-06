import { Ionicons } from '@expo/vector-icons';

export type SocialKey = 'instagram' | 'tiktok' | 'youtube' | 'facebook';

export const SOCIAL_KEYS: SocialKey[] = ['instagram', 'tiktok', 'youtube', 'facebook'];

type SocialConfig = {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  /** brand color; '#000000' is treated as "use the theme text color" (TikTok). */
  color: string;
  /** prepended to a bare handle to build the link. */
  base: string;
  placeholder: string;
};

export const SOCIALS: Record<SocialKey, SocialConfig> = {
  instagram: { label: 'Instagram', icon: 'logo-instagram', color: '#E1306C', base: 'https://instagram.com/', placeholder: '@handle' },
  tiktok: { label: 'TikTok', icon: 'logo-tiktok', color: '#000000', base: 'https://www.tiktok.com/@', placeholder: '@handle' },
  youtube: { label: 'YouTube', icon: 'logo-youtube', color: '#FF0000', base: 'https://www.youtube.com/@', placeholder: '@channel' },
  facebook: { label: 'Facebook', icon: 'logo-facebook', color: '#1877F2', base: 'https://facebook.com/', placeholder: 'username or page' },
};

/**
 * Clean user input for storage: trim, drop a leading @, strip spaces. A full
 * URL is kept as-is so people can paste e.g. a custom YouTube/Facebook link.
 */
export function cleanHandle(input: string | null | undefined): string {
  const v = (input ?? '').trim();
  if (!v) return '';
  if (/^https?:\/\//i.test(v)) return v;
  return v.replace(/^@+/, '').replace(/\s+/g, '');
}

/** Build a tappable URL from a stored handle (or pass through a full URL). */
export function socialUrl(key: SocialKey, value: string | null | undefined): string | null {
  const v = (value ?? '').trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  const handle = v.replace(/^@+/, '').replace(/\s+/g, '');
  if (!handle) return null;
  return SOCIALS[key].base + handle;
}
