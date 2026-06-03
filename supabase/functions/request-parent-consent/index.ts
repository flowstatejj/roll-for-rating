// Sends (or re-sends) the parental-consent approval email for the signed-in
// minor's account. Requires the caller's JWT (default — deploy normally).
//
// Env (Supabase project secrets):
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY  (auto-provided)
//   RESEND_API_KEY        — optional; if absent the link is returned for manual sharing
//   CONSENT_FROM_EMAIL    — optional; defaults to Resend's onboarding sender
//   PUBLIC_FUNCTIONS_URL  — optional; base URL for the verify link
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") ?? "";

  // Identify the caller from their JWT.
  const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: "Not signed in." }, 401);

  // Read the (locked) consent row with the service role.
  const admin = createClient(url, service);
  const { data: pc } = await admin
    .from("parent_consents")
    .select("token, parent_email, status")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!pc) return json({ error: "No parental consent is pending for this account." }, 400);
  if (pc.status === "verified") return json({ ok: true, alreadyVerified: true });

  const base = Deno.env.get("PUBLIC_FUNCTIONS_URL") ?? `${url}/functions/v1`;
  const link = `${base}/verify-parent-consent?token=${pc.token}`;

  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (resendKey) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: Deno.env.get("CONSENT_FROM_EMAIL") ?? "Rollr <onboarding@resend.dev>",
        to: pc.parent_email,
        subject: "Approve your child's Rollr account",
        html: `
          <div style="font-family:system-ui,Arial,sans-serif;max-width:520px;margin:auto">
            <h2>Rollr</h2>
            <p>Your child created an account on Rollr, a Jiu-Jitsu matching &amp; rating app.
               Their account stays restricted until you approve it.</p>
            <p style="margin:28px 0">
              <a href="${link}" style="background:#2f81f7;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:700">
                Approve this account
              </a>
            </p>
            <p style="color:#666;font-size:13px">If you didn't expect this, you can ignore this email and the account will stay restricted.</p>
          </div>`,
      }),
    });
    if (!res.ok) {
      const detail = await res.text();
      return json({ error: "Email provider rejected the request.", detail }, 502);
    }
    return json({ ok: true, sent: true, parent_email: pc.parent_email });
  }

  // No email provider configured yet — return the link so it can be shared manually.
  return json({ ok: true, sent: false, link, parent_email: pc.parent_email });
});
