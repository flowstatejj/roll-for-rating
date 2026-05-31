/**
 * Validate a MM / DD / YYYY date of birth and return the ISO date + current
 * age, or null if invalid. Shared by sign-up and the juniors manager.
 */
export function parseDob(mm: string, dd: string, yyyy: string): { iso: string; age: number } | null {
  const m = Number(mm);
  const d = Number(dd);
  const y = Number(yyyy);
  if (!mm || !dd || yyyy.length !== 4) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900) return null;
  const date = new Date(y, m - 1, d);
  // Reject impossible dates (e.g. Feb 30 rolls over).
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  const now = new Date();
  let age = now.getFullYear() - y;
  const beforeBirthday = now.getMonth() < m - 1 || (now.getMonth() === m - 1 && now.getDate() < d);
  if (beforeBirthday) age -= 1;
  const iso = `${y.toString().padStart(4, '0')}-${m.toString().padStart(2, '0')}-${d
    .toString()
    .padStart(2, '0')}`;
  return { iso, age };
}
