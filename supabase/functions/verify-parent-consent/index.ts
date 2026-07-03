// Public page a parent lands on after clicking the approval link in their email.
// Deploy WITHOUT JWT verification:  supabase functions deploy verify-parent-consent --no-verify-jwt
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function page(message: string, status = 200) {
  return new Response(
    `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
     <title>Roll for Rating</title></head>
     <body style="font-family:system-ui,Arial,sans-serif;background:#0d1117;color:#e6edf3;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0">
       <div style="max-width:460px;text-align:center;padding:32px">
         <h1 style="color:#2f81f7">Roll for Rating</h1>
         <p style="font-size:18px;line-height:1.5">${message}</p>
       </div>
     </body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

// A confirmation page with a button that POSTs. Email link previewers / security
// scanners follow the GET link but will NOT submit this form, so consent is
// never granted without a real human click. (Guideline: never perform a state
// change on a bare GET.)
function confirmPage(token: string) {
  const safeToken = token.replace(/"/g, "");
  return new Response(
    `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
     <title>Roll for Rating</title></head>
     <body style="font-family:system-ui,Arial,sans-serif;background:#0d1117;color:#e6edf3;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0">
       <div style="max-width:460px;text-align:center;padding:32px">
         <h1 style="color:#2f81f7">Roll for Rating</h1>
         <p style="font-size:18px;line-height:1.5">Your child asked to join Roll for Rating, a Jiu-Jitsu matching &amp; rating app. Their account stays restricted until you approve it.</p>
         <form method="POST" style="margin-top:28px">
           <input type="hidden" name="token" value="${safeToken}">
           <button type="submit" style="background:#2f81f7;color:#fff;padding:14px 24px;border:0;border-radius:8px;font-size:16px;font-weight:700;cursor:pointer">Approve this account</button>
         </form>
         <p style="color:#8b949e;font-size:13px;margin-top:20px">If you didn't expect this, close this page and the account stays restricted.</p>
       </div>
     </body></html>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

Deno.serve(async (req) => {
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // GET: show the confirmation page (no state change on GET).
  if (req.method !== "POST") {
    const token = new URL(req.url).searchParams.get("token");
    if (!token) return page("This approval link is missing its code.", 400);
    return confirmPage(token);
  }

  // POST: the parent clicked "Approve". Read the token from the form body.
  const form = await req.formData().catch(() => null);
  const token = form?.get("token")?.toString() ?? "";
  if (!token) return page("This approval link is missing its code.", 400);

  const { data: pc } = await admin
    .from("parent_consents")
    .select("user_id, status")
    .eq("token", token)
    .maybeSingle();

  if (!pc) return page("This approval link is invalid or has expired.", 404);

  if (pc.status !== "verified") {
    await admin
      .from("parent_consents")
      .update({ status: "verified", verified_at: new Date().toISOString() })
      .eq("token", token);
    await admin
      .from("profiles")
      .update({ consent_status: "verified" })
      .eq("id", pc.user_id);
  }

  return page("✅ Thank you — your child's account is now approved. They can open the app and start competing.");
});
