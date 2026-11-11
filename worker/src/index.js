// SFS Forms API (Southland Forest Services): stores incident reports until a manager investigates,
// sends incident alerts to managers' phones, and emails form PDFs from the forms Gmail account.
// Access is by share code: WORKER_CODE (staff) or MANAGER_CODE (can also read and investigate incidents).
// Separate from the NZCS app's Worker and database: nothing here touches nzcs-chargeout.
// The codes are Cloudflare secrets, never stored in this repository.

import { sendMail, mailReady, MAIL_TO_ALLOWED, MAX_PDF } from "./mail.js";

const ALLOWED_ORIGINS = ["https://wade-14.github.io"];
const MAX_BODY = 600_000;          // bytes; an incident report with a signature and a few photos
const KEEP_COMPLETED_DAYS = 365;   // completed incidents are removed after a year (the PDF is in email)

function cors(req, env) {
  const origin = req.headers.get("Origin") || "";
  const extra = (env.EXTRA_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
  const ok = ALLOWED_ORIGINS.concat(extra).includes(origin);
  return {
    "Access-Control-Allow-Origin": ok ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Access-Code",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}
const json = (req, env, body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors(req, env) } });
const fail = (req, env, status, message) => json(req, env, { error: message }, status);

function roleFor(code, env) {
  const c = String(code || "").trim().toLowerCase();
  if (!c) return null;
  if (env.MANAGER_CODE && c === String(env.MANAGER_CODE).toLowerCase()) return "manager";
  if (env.WORKER_CODE && c === String(env.WORKER_CODE).toLowerCase()) return "worker";
  return null;
}

const now = () => new Date().toISOString();
const uid = () => crypto.randomUUID();
const str = (v, max = 2000) => String(v ?? "").slice(0, max);
async function readBody(req) {
  const len = Number(req.headers.get("Content-Length") || 0);
  if (len > MAX_BODY) throw new Error("That's too much data to save in one go.");
  const text = await req.text();
  if (text.length > MAX_BODY) throw new Error("That's too much data to save in one go.");
  try { return JSON.parse(text || "{}"); } catch { throw new Error("The app sent something unreadable. Reload and try again."); }
}

/* ---------- Incident alerts (Web Push, no message body) ----------
   Phones subscribe with their push address; when an incident is submitted we "ping" each one.
   The app's service worker then shows "Incident reported – needs investigation".
   Signed with the VAPID key pair: public key in VAPID_PUBLIC (var), private JWK in VAPID_PRIVATE_JWK (secret). */
const PUSH_HOSTS = [/\.googleapis\.com$/, /\.push\.apple\.com$/, /\.mozilla\.com$/, /\.notify\.windows\.com$/, /^fcm\.googleapis\.com$/];
const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlText = str => b64url(new TextEncoder().encode(str));
async function vapidJWT(env, aud){
  const jwk = JSON.parse(env.VAPID_PRIVATE_JWK);
  const key = await crypto.subtle.importKey("jwk", jwk, {name:"ECDSA", namedCurve:"P-256"}, false, ["sign"]);
  const head = b64urlText(JSON.stringify({typ:"JWT", alg:"ES256"}));
  const body = b64urlText(JSON.stringify({aud, exp: Math.floor(Date.now()/1000) + 12*3600, sub:"https://wade-14.github.io/sfs-forms/"}));
  const sig = await crypto.subtle.sign({name:"ECDSA", hash:"SHA-256"}, key, new TextEncoder().encode(head + "." + body));
  return head + "." + body + "." + b64url(sig);
}
async function notifyManagers(env){
  if (!env.VAPID_PRIVATE_JWK || !env.VAPID_PUBLIC) return;
  const { results } = await env.DB.prepare("SELECT endpoint FROM push_subs").all();
  await Promise.all(results.map(async ({endpoint}) => {
    try{
      const jwt = await vapidJWT(env, new URL(endpoint).origin);
      const r = await fetch(endpoint, {method:"POST", headers:{"Authorization":`vapid t=${jwt}, k=${env.VAPID_PUBLIC}`, "TTL":"86400", "Urgency":"high", "Content-Length":"0"}});
      if (r.status === 404 || r.status === 410) await env.DB.prepare("DELETE FROM push_subs WHERE endpoint = ?1").bind(endpoint).run();
    }catch(e){ /* one bad subscription shouldn't stop the others */ }
  }));
}
function okEndpoint(u){
  try{ const url = new URL(u); return url.protocol === "https:" && PUSH_HOSTS.some(rx => rx.test(url.hostname)); }catch(e){ return false; }
}
function cleanIncidentPart(obj){
  if (!obj || typeof obj !== "object") throw new Error("Missing incident details.");
  const text = JSON.stringify(obj);
  if (text.length > 500000) throw new Error("That's too much to save in one go. Remove a photo or two and try again.");
  return text;
}

async function handle(req, env, ctx) {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req, env) });
  if (path === "" || path === "/") return json(req, env, { ok: true, service: "sfs-forms" });

  const role = roleFor(req.headers.get("X-Access-Code"), env);
  if (path === "/api/login" && req.method === "POST") {
    let code = req.headers.get("X-Access-Code");
    if (!code) { try { code = (await readBody(req)).code; } catch {} }
    const r = roleFor(code, env);
    return r ? json(req, env, { role: r }) : fail(req, env, 401, "That code isn't right. Check it and try again.");
  }
  if (!role) return fail(req, env, 401, "Your share code isn't valid any more. Enter the current code.");

  let m;
  // The worker share code, for the app's "Share the app" message (never the manager code)
  if (path === "/api/share-code" && req.method === "GET") return json(req, env, { code: env.WORKER_CODE || "" });
  /* ---------- Email sending (PDF from the forms Gmail account) ---------- */
  if (path === "/api/mail" && req.method === "GET") return json(req, env, { ready: mailReady(env) });
  if (path === "/api/mail" && req.method === "POST") {
    if (!mailReady(env)) return fail(req, env, 503, "Email sending isn't set up yet.");
    const len = Number(req.headers.get("Content-Length") || 0);
    if (len > MAX_PDF * 1.4) return fail(req, env, 413, "The PDF is too big to email. Take out some photos and try again.");
    let body; try { body = JSON.parse(await req.text()); } catch { return fail(req, env, 400, "The app sent something unreadable. Reload and try again."); }
    const to = Array.from(new Set((Array.isArray(body.to) ? body.to : []).map(t => String(t).trim().toLowerCase())));
    if (!to.length || to.some(t => !MAIL_TO_ALLOWED.includes(t))) return fail(req, env, 400, "The app can only email the office addresses.");
    const subject = str(body.subject, 200).replace(/[\r\n]+/g, " ").trim() || "SFS form";
    const filename = (str(body.filename, 200).replace(/[\r\n"\\/:*?<>|]+/g, "-").trim() || "SFS form").replace(/(\.pdf)?$/i, ".pdf");
    const pdfB64 = String(body.pdf || "").replace(/\s+/g, "");
    if (!/^JVBER/.test(pdfB64) || pdfB64.length > MAX_PDF * 1.37) return fail(req, env, 400, "The PDF didn't come through. Try again.");
    const text = str(body.text, 4000).trim();
    try { await sendMail(env, { to, subject, filename, pdfB64, text }); }
    catch (err) { return fail(req, env, 502, "The email didn't send (" + String(err && err.message || "unknown problem").replace(/\.$/, "") + ")."); }
    return json(req, env, { sent: true, to });
  }
  /* ---------- Incident reports ---------- */
  // Anyone with a code can submit the employee's part; managers are alerted.
  if (path === "/api/incidents" && req.method === "POST") {
    const body = await readBody(req);
    const report = cleanIncidentPart(body.report);
    const t = now(), id = uid();
    await env.DB.prepare("INSERT INTO incidents (id, status, reported_by, summary, report, created_at, updated_at) VALUES (?1, 'open', ?2, ?3, ?4, ?5, ?5)")
      .bind(id, str(body.reported_by, 120), str(body.summary, 200), report, t).run();
    if (ctx && ctx.waitUntil) ctx.waitUntil(notifyManagers(env)); else await notifyManagers(env);
    return json(req, env, { id }, 201);
  }
  // Everything else about incidents is managers only (they can hold injury and medical details).
  if (path.startsWith("/api/incidents") && role !== "manager") return fail(req, env, 403, "Only managers can open incident reports.");
  if (path === "/api/incidents" && req.method === "GET") {
    const status = url.searchParams.get("status") === "complete" ? "complete" : "open";
    const { results } = await env.DB.prepare("SELECT id, status, reported_by, summary, created_at, updated_at, completed_at FROM incidents WHERE status = ?1 ORDER BY created_at DESC LIMIT 200").bind(status).all();
    return json(req, env, { incidents: results });
  }
  if ((m = path.match(/^\/api\/incidents\/([\w-]{36})$/))) {
    const id = m[1];
    if (req.method === "GET") {
      const r = await env.DB.prepare("SELECT * FROM incidents WHERE id = ?1").bind(id).first();
      if (!r) return fail(req, env, 404, "That incident no longer exists. It may have been deleted.");
      return json(req, env, { incident: { ...r, report: JSON.parse(r.report), investigation: JSON.parse(r.investigation || "{}") } });
    }
    if (req.method === "PUT") {
      const body = await readBody(req);
      const inv = cleanIncidentPart(body.investigation);
      const complete = !!body.complete, t = now();
      const r = await env.DB.prepare("UPDATE incidents SET investigation = ?2, status = ?3, completed_at = ?4, updated_at = ?5 WHERE id = ?1")
        .bind(id, inv, complete ? "complete" : "open", complete ? t : null, t).run();
      if (!r.meta || !r.meta.changes) return fail(req, env, 404, "That incident no longer exists. It may have been deleted.");
      return json(req, env, { id, status: complete ? "complete" : "open" });
    }
    if (req.method === "DELETE") {
      await env.DB.prepare("DELETE FROM incidents WHERE id = ?1").bind(id).run();
      return json(req, env, { deleted: id });
    }
  }
  /* ---------- Alert subscriptions (managers) ---------- */
  if (path === "/api/push/key" && req.method === "GET") return json(req, env, { key: env.VAPID_PUBLIC || "" });
  if (path === "/api/push/subscribe" && req.method === "POST") {
    if (role !== "manager") return fail(req, env, 403, "Only managers can turn on incident alerts.");
    const body = await readBody(req), endpoint = str(body.endpoint, 1000);
    if (!okEndpoint(endpoint)) return fail(req, env, 400, "This phone's notification service isn't supported.");
    await env.DB.prepare("INSERT OR REPLACE INTO push_subs (endpoint, created_at) VALUES (?1, ?2)").bind(endpoint, now()).run();
    return json(req, env, { subscribed: true });
  }
  if (path === "/api/push/unsubscribe" && req.method === "POST") {
    const body = await readBody(req);
    await env.DB.prepare("DELETE FROM push_subs WHERE endpoint = ?1").bind(str(body.endpoint, 1000)).run();
    return json(req, env, { subscribed: false });
  }
  return fail(req, env, 404, "Not found.");
}

export default {
  async fetch(req, env, ctx) {
    try { return await handle(req, env, ctx); }
    catch (err) { return fail(req, env, 400, err && err.message ? err.message : "Something went wrong."); }
  },
  // Daily tidy-up: remove completed incidents older than a year (they're in email as PDFs).
  async scheduled(_event, env) {
    const cutoff = new Date(Date.now() - KEEP_COMPLETED_DAYS * 86400000).toISOString();
    await env.DB.prepare("DELETE FROM incidents WHERE status = 'complete' AND completed_at < ?1").bind(cutoff).run();
  },
};
