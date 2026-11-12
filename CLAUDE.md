# SFS Forms – project notes

Health and safety field forms app for **Southland Forest Services** (sister company of NZ Conservation Services, Southland NZ). Staff fill forms on their phones; each form becomes a PDF that is emailed to the office. Built from the NZCS Forms app (repo `Wade-14/nzcs-chargeout`, same engine and look) but kept fully separate: its own Worker, database, share codes, phone storage keys and service worker.

**This repository is public.** Never commit share codes, API keys, passwords or other private values. They live only as Cloudflare secrets.

## Where things are

| What | Where |
|---|---|
| Live app (staff use this) | https://wade-14.github.io/sfs-forms/ (once the repo is on GitHub Pages) |
| Preview (test changes here first) | https://wade-14.github.io/sfs-forms/preview/ |
| Storage API (Cloudflare Worker) | https://sfs-forms-api.royal-dawn-9e17.workers.dev |
| Hosting | GitHub Pages from `main`, repo root. Pushing to `main` publishes within 1–2 minutes |

## Differences from the NZCS app (Wade, 11/12-11-2026)

- **No Charge Out**, so no jobs in progress, time tracking or materials. Nothing about jobs is stored online.
- **Only incident reports are stored online** (awaiting a manager's investigation). Every other form is one-off: filled in, sent, gone.
- **Manager and worker sides**: two share codes. Managers can read and investigate incidents, delete them, and turn on incident alerts; workers can only submit.
- **Email** goes out from the same Gmail account as NZCS (nzcsforms@gmail.com), shown as "SFS Forms". PDF names and subjects start with **SFS**, e.g. `SFS Toolbox Meeting - Block 7 - AB CD 12-11-2026.pdf`.
- Same Cloudflare account as NZCS, but its own Worker (`sfs-forms-api`) and D1 database (`sfs-forms`). Nothing here reads or writes the NZCS ones.
- Phone storage keys start `sfs.` (both apps are on wade-14.github.io and share browser storage), service worker cache `sfs-forms-vN`, notification tag `sfs-incident`.

## Files

- `index.html`: app shell. Share-code screen, home screen (folders → form tiles), settings drawer (share app, incident alerts), incident inbox/investigation. `STAFF` and `API` are near the top of the main script; `FOLDERS` sets the home-screen folders.
- `forms.js`: forms engine plus definitions (`FORMS`). New forms are added here. `SEND_TO` near the top is where every form is emailed.
- `sw.js`: service worker (network-first, offline fallback, incident alert notifications). **Bump `CACHE` on every release** in both `sw.js` and `preview/sw.js`.
- `vendor/`: jsPDF 2.5.1 and AutoTable 3.8.2. `vendor/logo.js` holds the PDF logo: the full SFS tree-of-life logo with the name (`window.NZCS_LOGO`, 1200 × 327 JPEG data URL, and `window.NZCS_LOGO_RATIO`; the engine keeps the NZCS variable names). `buildPDF` prints it 62 mm wide at the top left of page 1. Made 12-11-2026 from Wade's vector file `SFS_tree_of_life_logo.pdf` (rendered with `pdftocairo`).
- `icon-*.png`: app icons made from the tree-of-life emblem (left part of the logo) on white; `-maskable` versions keep it inside the safe zone.
- `preview/`: full copy of the app for testing.
- `worker/`: Cloudflare Worker (`src/index.js`, `src/mail.js`), D1 schema (`schema.sql`), `wrangler.toml`.

## Release process

1. Edit files in `preview/`, test, push, and let Wade try the preview if the change is big.
2. Copy `preview/index.html` and `preview/forms.js` to the root, bump `CACHE` in both service workers, commit and push to `main`.
3. Staff get updates by fully closing and reopening the app.

Worker deploy (the Cloudflare token is injected by the session's network proxy in the `nzcs-chargeout` cloud environment, never stored here):

```bash
cd worker && WRANGLER_SEND_METRICS=false CLOUDFLARE_API_TOKEN=proxy-injected CLOUDFLARE_ACCOUNT_ID=dc50d269d55490062b7b588156ed2fa1 npx wrangler deploy
```

## Storage and secrets (Cloudflare, Wade's account)

- D1 database `sfs-forms` (Oceania). Tables `incidents`, `push_subs` (`worker/schema.sql`). A daily cron removes completed incidents older than 365 days.
- Secrets on `sfs-forms-api`: `WORKER_CODE`, `MANAGER_CODE`, `VAPID_PRIVATE_JWK` (set 12-11-2026), and `MAIL_USER` / `MAIL_PASSWORD` (the nzcsforms@gmail.com address and its own Google app password "SFS Forms"; added by Wade in the Cloudflare dashboard 12-11-2026, test email confirmed). Until the mail secrets are set, `GET /api/mail` returns `ready:false` and the app falls back to the phone's share menu.
- Change a code with `npx wrangler secret put WORKER_CODE` (or `MANAGER_CODE`) in `worker/`.
- `MAIL_TO_ALLOWED` in `worker/src/mail.js` limits who the app can email; it must include every address in `SEND_TO`.

## Recipients

All forms (including the finished incident investigation) go to: southlandforestservices@gmail.com, jimie64@hotmail.com (Jimmy Sycamore, SFS managing director), team@nzconservation.nz (Wade), operations@nzconservation.nz (Gareth). The app calls them "Jimmy, Wade, Gareth and the SFS inbox".

## Forms (v1, adapted from the NZCS forms)

Folders: **Health & Safety Forms** (Toolbox Meeting, Hazard Report, Incident / Accident Report, Visitor Induction, Training Record) and **Vehicle & Equipment Checks** (Vehicle Check, LUV Check, Trailer Check).

**Toolbox Meeting** (`#toolbox`, first in Health & Safety; PDF "SFS Daily Toolbox JSA Meeting"): SFS's own form, built 12-11-2026 from their blank "SFS Daily Toolbox/JSA Meeting" (the NZCS toolbox was removed). Meeting info: date/time, person running the meeting (STAFF + Other), staff involved (tick list + Other), location + map, emergency meeting point, other people attending. Today's tasks (tick all): Pest control, Thinning to waste, E-thinning, Pruning, Spraying, Regen control, Planting, Plotting. "Are you using a chainsaw?" Yes shows the ACOP notice. Site hazards: Driving, Fatigue, then Hazard 3–5, each with hazard rating and revised hazard rating **Low / Medium / High / Very high** and a control box; Hazard 3–5's rating and control only show once the hazard is typed. Health (fit for work, medication: Yes/No + details), weather (multi + Other), weather safe Y/N, temperature Cold/Warm/Hot plus an "Actual temperature (°C)" box (typed, so frosts below zero work). E-thinning spelling and tick-more-than-one tasks confirmed by Wade. Checklist Yes/No questions with follow-up boxes on the "problem" answer. Overall risk **Low / Medium / High / Extreme**; High or Extreme shows "Stop and reassess today's activities." and a Reassessment notes box. Feel safe Y/N + why. Crew signatures. File name uses the first part of the address.

Changes from NZCS: NZCS names and the NZCS office address removed; company is "Southland Forest Services"; visitor statements name SFS; incident "who to contact" names Toby Haliday or Jimmy Sycamore (management) instead of NZCS names. **LUV Check** (`#quad-check`, renamed from Quad / LUV Check 12-11-2026; PDF "SFS LUV Pre Start Check"): LUV Polaris 570 red, LUV Polaris 570 green, LUV Polaris XP 1000, Other (→ type it). **Trailer Check**: same trailer list as NZCS (Jobmate 7x4 143G7, Jobmate 7x4 cage trailer 97F53, Red Briford trailer P301G, Briford 846M3, Briford tip trailer 6BR70, T Choice T989U, Single horse float 23F21, Double horse float, Other → type it). **Vehicle Check** (12-11-2026): Ford Ranger LJT666, Mazda BT50 DYR272, Suzuki Vitara HCE794, Nissan Caravan, Mitsubishi Triton DQU528, Toyota Hilux REA547, Toyota Prado, Other (→ type it). **Nissan Caravan and Toyota Prado regos still to come**: add them to the names when Wade sends them. Hazard Report, Incident / Accident Report, Visitor Induction and Training Record are **shared with NZCS** (Wade, 12-11-2026): keep them matching the NZCS versions apart from the SFS name, staff and recipients. When NZCS changes one of these, ask Wade whether SFS should get the same change.

**Staff** (`STAFF` in index.html, from SFS's BrightHR list, 12-11-2026): Adriu Junior, Aliki Kaikoso, Amenisitai Kunawakai, David Ross, Iliesa Veisei, Jimmy Sycamore, Jeremaia Ravisa, Jovesa Cakau, Logan Carse, Roger Hill, Sativa Sycamore, Shane Sycamore, Tenille McIntyre, Timothy Hill, Toby Haliday, Vailoa Lemamea. Jimmy is "Jamie" in BrightHR; Wade confirmed the app says Jimmy. Toby is spelled "Haliday" to match the NZCS app. **Managers** (hold the manager code): Toby Haliday and Jimmy Sycamore; the incident investigation's "who to contact" lists "Toby Haliday or Jimmy Sycamore (management)". If `STAFF` is ever emptied, name fields fall back to typed boxes.

## Outbox (sending out of reception)

Ported from the NZCS app 12-11-2026 (Wade asked). When **Send PDF** fails because there's no signal (`err.offline`), the PDF, recipients, subject and email summary are saved in IndexedDB on the phone and sent automatically when the app is open with signal: on unlock, on the `online` event, when the app comes back to the front, and every minute. The employee's **incident submission** also queues (kind `incident`, POSTed to `/api/incidents` on signal, managers alerted as usual; goes even if email isn't set up). The finished incident investigation's PDF queues like any other form. The home screen shows an amber "N forms waiting to send" box (Share instead / Delete / Try sending now) and a green "Sent from the Outbox" note afterwards. `sfs.mailReady` in localStorage remembers that email works, so the app can queue even if it opens with no signal. iPhones can't send in the background: the app has to be opened in reception.

**The IndexedDB database is `sfs-outbox`, never `nzcs-outbox`.** Both apps are on wade-14.github.io and share browser storage, so a shared name would make one app send the other's forms. Keep any future local-storage names prefixed `sfs`.

## Conventions (same as NZCS)

Dates dd-mm-yyyy, NZ English, plain short prompts. PDF file name: form – job/place – staff initials – date. Ask Wade before adding fields or features he didn't ask for.

## Testing

- `python3 -m http.server 8765` in the repo, and `npx wrangler dev --local --port 8787` in `worker/` with a gitignored `.dev.vars` (`WORKER_CODE`, `MANAGER_CODE`, `EXTRA_ORIGINS=http://localhost:8765`). On localhost the app talks to `http://localhost:8787`. Run `npx wrangler d1 execute sfs-forms --local --file=schema.sql` once first.
- Drive with Playwright (Chromium preinstalled); check PDFs with `pdftotext`.

## To do

- Regos for the Nissan Caravan and Toyota Prado.
