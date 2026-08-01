// Shared Cloudflare R2 access for the edge functions.
//
// Match videos live in R2 (functions/video-url presigns the upload), NOT in
// Supabase storage. Both the retention job and account deletion have to delete
// the same objects the same way, and they previously did not - delete-account
// removed from the Supabase bucket (a no-op for real uploads) while
// purge-old-videos removed from R2. Keeping one helper stops them diverging.
//
// Requires secrets on every function that imports it:
//   R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
import { AwsClient } from 'https://esm.sh/aws4fetch@1.0.20';

export const R2_ENDPOINT = `https://${Deno.env.get('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`;
export const R2_BUCKET = Deno.env.get('R2_BUCKET') ?? 'match-videos';

// Built lazily, NOT at module load. delete-account imports this and did not
// previously need the R2 secrets; if they are missing on that function, a
// constructor throw at import time would take the whole endpoint down and make
// account deletion impossible - which Apple 5.1.1(v) requires to work. Missing
// credentials must degrade to "this delete failed" (recorded as residue), not
// to a dead function.
let _r2: AwsClient | null = null;
function client(): AwsClient | null {
  if (_r2) return _r2;
  const accessKeyId = Deno.env.get('R2_ACCESS_KEY_ID');
  const secretAccessKey = Deno.env.get('R2_SECRET_ACCESS_KEY');
  if (!accessKeyId || !secretAccessKey || !Deno.env.get('R2_ACCOUNT_ID')) return null;
  _r2 = new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region: 'auto' });
  return _r2;
}

export interface DeleteOutcome {
  path: string;
  ok: boolean;
  status: number | null;
  error?: string;
}

/**
 * Delete one object from R2 and report what actually happened.
 *
 * r2.fetch RESOLVES on 403/404/5xx (it only rejects on a transport error), so
 * the status MUST be inspected. Treating every settled promise as success is
 * what let a bad credential silently turn retention into metadata-only
 * deletion: rows vanished, files stayed, and nothing could find them again
 * because the rows were the only index into R2.
 *
 * 404 counts as success - the object is already gone, which is the desired end
 * state and makes the whole operation idempotent.
 */
/** True when the R2 secrets are present on THIS function. */
export function r2Configured(): boolean {
  return client() !== null;
}

/**
 * Encode a key the same way every other R2 caller builds one, per path segment.
 * encodeURI would leave '#' and '?' intact, which truncates the key at sign
 * time: the DELETE would then target a DIFFERENT object, R2 answers 404, and a
 * 404-is-success rule would drop the row while the real file survives.
 */
function encodeKey(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

export async function deleteR2Object(path: string): Promise<DeleteOutcome> {
  const r2 = client();
  if (!r2) return { path, ok: false, status: null, error: 'R2 credentials not configured' };
  try {
    const res = await r2.fetch(`${R2_ENDPOINT}/${R2_BUCKET}/${encodeKey(path)}`, {
      method: 'DELETE',
    });
    if (res.ok || res.status === 404) return { path, ok: true, status: res.status };
    return { path, ok: false, status: res.status, error: `HTTP ${res.status}` };
  } catch (e) {
    return { path, ok: false, status: null, error: String((e as Error)?.message ?? e) };
  }
}

/**
 * Delete many objects with BOUNDED concurrency; never throws.
 *
 * An unbounded Promise.all over every path a busy competitor accumulated can
 * fire hundreds of signed requests in one invocation. An edge function that
 * blows its CPU or wall-clock budget is killed, and that kill is not catchable
 * - in delete-account that would mean the auth user never gets deleted and the
 * user sees "we couldn't delete your account", the exact App Store 5.1.1(v)
 * failure this code exists to avoid.
 */
export async function deleteR2Objects(paths: string[], concurrency = 12): Promise<DeleteOutcome[]> {
  const unique = [...new Set(paths.filter(Boolean))];
  const out: DeleteOutcome[] = [];
  for (let i = 0; i < unique.length; i += concurrency) {
    out.push(...await Promise.all(unique.slice(i, i + concurrency).map((p) => deleteR2Object(p))));
  }
  return out;
}
