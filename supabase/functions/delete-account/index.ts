// Supabase Edge Function: delete-account
// Permanently deletes the signed-in user's account. Apple requires apps with
// account creation to offer in-app deletion (App Store Guideline 5.1.1(v)).
//
// Deleting the auth user cascades through the schema (profiles.id references
// auth.users on delete cascade, and matches/attempts/consent/etc. reference
// profiles on delete cascade), so the user's DB rows are removed.
//
// STORAGE IS NOT CASCADED, and getting that wrong is unrecoverable: the DB rows
// are the only index into the object stores, so anything not deleted BEFORE the
// cascade becomes permanently unreachable - no later job can even enumerate it.
// The previous version deleted match videos from the Supabase storage bucket,
// but every native upload goes to Cloudflare R2 (see functions/video-url), so
// real users' videos - including managed juniors', which can show a child -
// survived forever. It also only cleaned the deleting user's own avatar,
// leaving every managed junior's photo behind.
//
// Deploy with "Verify JWT" ON. Now ALSO requires the R2 secrets:
//   R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
import { createClient } from 'npm:@supabase/supabase-js@2';
import { deleteR2Objects, r2Configured } from '../_shared/r2.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

/** PostgREST `in` filters have a URL length limit; page through ids. */
function chunk<T>(arr: T[], size = 150): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Identify the caller from their JWT - they can only delete themselves.
    const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
    const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
    if (userErr || !userData?.user) return json({ error: 'Not authenticated' }, 401);
    const uid = userData.user.id;

    // Every cleanup step below is best-effort: Apple 5.1.1(v) requires deletion
    // to succeed, so a storage failure must not block it. But best-effort is
    // NOT silent - anything we fail to delete is recorded in deletion_residue
    // so it can be swept later instead of becoming invisible forever.
    const residue: { kind: string; path: string; reason: string }[] = [];

    // Managed juniors are separate profile rows that cascade away with their
    // guardian, taking their videos and avatar photos out of reach with them.
    // supabase-js RESOLVES with { data: null, error } instead of throwing, so
    // every query below checks `error` explicitly - a swallowed failure here
    // would silently skip a child's media and record no residue either.
    let juniorIds: string[] = [];
    {
      const { data: juniors, error } = await admin
        .from('profiles').select('id').eq('managed_by', uid);
      if (error) {
        residue.push({ kind: 'r2-video', path: '(junior lookup failed)', reason: error.message });
      } else {
        juniorIds = (juniors ?? []).map((j: { id: string }) => j.id);
      }
    }
    const allIds = [uid, ...juniorIds];

    // ---- Match videos -------------------------------------------------------
    // Delete a FILE only when its match_videos ROW is about to disappear too.
    // Otherwise a surviving row points at a missing object and the app shows a
    // video that 404s, with nothing left to reap it.
    //
    // Two disjoint sources:
    //   (a) matches where one of these profiles COMPETED - the match row
    //       cascades away (schema.sql challenger_id/opponent_id), taking every
    //       video row with it whoever uploaded it, so all those files must go.
    //       This is what catches clips of the user filmed by their opponent.
    //   (b) video rows this profile UPLOADED on any OTHER match - those rows
    //       cascade via match_videos.uploader_id even though the match lives on.
    //
    // Matches where the profile was ONLY the referee are deliberately excluded:
    // the paired SQL changes that FK to ON DELETE SET NULL precisely so those
    // matches survive for the two competitors. Deleting their footage here
    // would destroy a third party's record - the very thing this batch fixes.
    try {
      const matchIds = new Set<string>();
      for (const ids of chunk(allIds, 40)) {
        const list = ids.map((i) => `"${i}"`).join(',');
        const { data: ms, error } = await admin
          .from('matches')
          .select('id')
          .or(`challenger_id.in.(${list}),opponent_id.in.(${list})`)
          .limit(10000);
        if (error) {
          residue.push({ kind: 'r2-video', path: '(match lookup failed)', reason: error.message });
          continue;
        }
        (ms ?? []).forEach((m: { id: string }) => matchIds.add(m.id));
      }

      const paths = new Set<string>();
      for (const ids of chunk([...matchIds], 100)) {
        const { data: vids, error } = await admin
          .from('match_videos').select('path').in('match_id', ids).limit(10000);
        if (error) {
          residue.push({ kind: 'r2-video', path: `(video lookup failed for ${ids.length} matches)`, reason: error.message });
          continue;
        }
        (vids ?? []).forEach((v: { path: string }) => { if (v.path) paths.add(v.path); });
      }
      for (const ids of chunk(allIds, 40)) {
        const { data: mine, error } = await admin
          .from('match_videos').select('path').in('uploader_id', ids).limit(10000);
        if (error) {
          residue.push({ kind: 'r2-video', path: '(uploaded-video lookup failed)', reason: error.message });
          continue;
        }
        (mine ?? []).forEach((v: { path: string }) => { if (v.path) paths.add(v.path); });
      }

      const pathList = [...paths];
      if (pathList.length) {
        if (!r2Configured()) {
          // Loudly recorded once rather than as N identical rows: without the
          // R2 secrets on THIS function the whole cleanup silently degrades to
          // the pre-fix behaviour, which is exactly how the original bug hid.
          residue.push({
            kind: 'r2-video',
            path: `(R2 not configured - ${pathList.length} objects NOT deleted)`,
            reason: 'missing R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY',
          });
        }
        const outcomes = await deleteR2Objects(pathList);
        outcomes.filter((o) => !o.ok).forEach((o) =>
          residue.push({ kind: 'r2-video', path: o.path, reason: o.error ?? 'unknown' }));

        // Legacy/web uploads went to the Supabase bucket; harmless no-op for
        // R2-era paths, so keep removing them for older accounts. One residue
        // row PER PATH so a sweeper has something actionable to retry.
        try {
          const { error: bErr } = await admin.storage.from('match-videos').remove(pathList);
          if (bErr) pathList.forEach((p) =>
            residue.push({ kind: 'bucket-video', path: p, reason: bErr.message }));
        } catch (e) {
          pathList.forEach((p) => residue.push({ kind: 'bucket-video', path: p, reason: String(e) }));
        }
      }
    } catch (e) {
      residue.push({ kind: 'r2-video', path: '(collection failed)', reason: String(e) });
    }

    // ---- Avatars (the user's AND every managed junior's) --------------------
    // Path convention is '<profile_id>/avatar.<ext>' (supabase/avatars.sql), so
    // list each profile's folder rather than trusting profiles.avatar_path -
    // replaced photos can leave older objects behind.
    // avatars.ts writes a NEW object per upload and only best-effort removes the
    // previous one, so folders really do accumulate past one page. Page until a
    // short page comes back; a single .list() would silently leave a minor's
    // photo behind, which is the exact thing this is meant to clean up.
    for (const id of allIds) {
      try {
        for (let offset = 0; offset < 2000; offset += 100) {
          const { data: objs, error: lErr } = await admin.storage
            .from('avatars').list(id, { limit: 100, offset });
          if (lErr) {
            residue.push({ kind: 'avatar', path: `${id}/`, reason: lErr.message });
            break;
          }
          const page = objs ?? [];
          // Entries with a null id are sub-folders, not objects; remove() is a
          // silent no-op on those, so do not pretend they were cleaned.
          const names = page
            .filter((o: { id: string | null }) => o.id !== null)
            .map((o: { name: string }) => `${id}/${o.name}`);
          if (names.length) {
            const { error: aErr } = await admin.storage.from('avatars').remove(names);
            if (aErr) names.forEach((n) => residue.push({ kind: 'avatar', path: n, reason: aErr.message }));
          }
          if (page.length < 100) break;
        }
      } catch (e) {
        residue.push({ kind: 'avatar', path: `${id}/`, reason: String(e) });
      }
    }

    // Record anything that survived, BEFORE the account disappears.
    if (residue.length) {
      // Chunked and error-checked: a single oversized insert that fails would
      // wipe out the only record of what leaked. Logged either way, so the
      // function logs still show it even if the table is missing (i.e. the
      // paired SQL file has not been run yet).
      console.error(`delete-account: ${residue.length} storage object(s) left behind for ${uid}`);
      for (const batch of chunk(residue.map((r) => ({ ...r, user_id: uid })), 200)) {
        const { error: rErr } = await admin.from('deletion_residue').insert(batch);
        if (rErr) console.error(`delete-account: residue insert failed: ${rErr.message}`);
      }
    }

    // PII tables that reference the user but do not cascade on delete.
    try { await admin.from('analytics_events').delete().eq('user_id', uid); } catch { /* best-effort */ }
    try { await admin.from('support_requests').delete().eq('user_id', uid); } catch { /* best-effort */ }

    const { error: delErr } = await admin.auth.admin.deleteUser(uid);
    if (delErr) return json({ error: delErr.message }, 400);

    return json({ ok: true, residue: residue.length }, 200);
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
