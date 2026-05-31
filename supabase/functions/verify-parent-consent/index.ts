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

Deno.serve(async (req) => {
  const token = new URL(req.url).searchParams.get("token");
  if (!token) return page("This approval link is missing its code.", 400);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

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
