# StockLink

Private, real-time stock sharing and ordering between wholesalers and retailers.
Needs Node 22.5 or newer. Data lives in one SQLite file by default, or in Supabase Postgres when DATABASE_URL is set.

## Try it in 30 seconds (demo mode)

    DEMO_MODE=1 npm start
    open http://localhost:3000

Tap a demo account on the login screen (password for all: Demo@1234). Invite code for the demo wholesaler: K7QM-3XRP.
Suggested walkthrough: log in as Retailer (not connected yet), enter the code, then log in as Wholesaler (verified) and approve the request, go back to the retailer and place an order, then advance it as the wholesaler.

DEMO MODE PUBLISHES LOGINS ON THE LOGIN SCREEN. Use it only for showing the product. Never put real customers on a demo-mode server.

## Launch day checklist (go live on the internet)

This puts StockLink on a real web address with HTTPS, so phones can install it and get alerts.
Website for Instagram and WhatsApp: `https://YOUR-ADDRESS/download`. The app itself is at `https://YOUR-ADDRESS/`.

1. **Database (Supabase):** create a project in **Asia-Pacific → Singapore**, the same region as the Render server (step 3), so every database call stays inside one city. Project Settings > Database > Connection string > **Session pooler**. Copy it and put your database password in it.
2. **Code on GitHub:** create a **private** repository and upload this folder. `.gitignore` keeps out `node_modules`, the database files and `secret.key`; check that `lib/data` is NOT uploaded.
3. **Server (Render):** New > Web Service > pick the repository. It finds the Dockerfile. Choose the region nearest India (Singapore) and a paid **always-on** plan (free plans fall asleep, and the first retailer of the morning waits 30+ seconds).
4. **Environment variables on Render:**
   `NODE_ENV=production`, `TRUST_PROXY=1`, `DATABASE_URL=` (from step 1), `SESSION_SECRET=` (any 40+ random characters; never change it later), `ADMIN_PHONE=`, `ADMIN_PASSWORD=`, `ADMIN_NAME=`. Do **not** set `DEMO_MODE`.
5. **Health check path:** `/healthz`. Deploy. Open the Render address, log in as admin, approve your first wholesaler.
6. **Your own domain (optional):** Render > Settings > Custom domain, then add the DNS record it shows at your domain seller.
7. **Run exactly one server.** Live updates and spam limits live inside one server process. One always-on instance handled 1,300+ catalog loads a second in testing; that is plenty for the pilot. Before adding a second server, move those to Redis.
8. **Before you have thousands of shops:** turn on Supabase daily backups (Pro plan), add SMS OTP login, and add error tracking (Sentry).

## Run for real customers (production mode)

Set these environment variables, leave DEMO_MODE unset:

| Variable | Meaning |
|---|---|
| NODE_ENV=production | Secure cookies, HSTS |
| SESSION_SECRET | Long random string (32+ chars). Keys the invite-code hashes. Do not change after launch. |
| ADMIN_PHONE, ADMIN_PASSWORD, ADMIN_NAME | Creates your super admin on first start. Password 8+ characters. |
| DB_PATH | Path to the SQLite file. Must be on persistent disk. |
| TRUST_PROXY=1 | Set when behind Render/Railway/Fly/nginx so rate limits see the real client IP |
| PORT | Default 3000 |

Then `npm start`. New wholesalers sign up and wait in the admin Shops tab until you approve them.

## Deploy

Any host that runs Node 22 or Docker and has a persistent disk. Cheapest paths:

* Render / Railway / Fly.io: create a web service from this folder (it has a Dockerfile), add a persistent disk mounted at /data, set the variables above. Their HTTPS is automatic.
* A small VPS: `docker build -t stocklink .` then `docker run -d -p 3000:3000 -v stocklink-data:/data -e SESSION_SECRET=... -e ADMIN_PHONE=... -e ADMIN_PASSWORD=... stocklink`, with Caddy or nginx in front for HTTPS.

Always serve over HTTPS. Run exactly ONE instance (SQLite and in-memory rate limits are single-process).

## Phone app and notifications

StockLink is a web app that installs like a phone app (a PWA). It does not go through the Play Store or App Store.

- **Install on Android (Chrome):** open the site, then tap Menu (avatar) → "Install app", or Chrome's own "Add to Home screen". It opens full-screen with its own icon.
- **Install on iPhone (Safari):** tap Share → "Add to Home Screen". Phone alerts on iPhone only work from this home-screen app (iOS 16.4 or later).
- **Phone alerts:** Menu → "Turn on alerts". They arrive even when the app is closed:
  - Wholesaler: new order, payment UTR sent, new retailer request, order cancelled by retailer, shop verified.
  - Retailer: order status changes, order cancelled, connection approved, new product, item back in stock.
- Every alert also lands in the bell (top bar) inside the app.

**Alerts and install need HTTPS.** Browsers only allow them on `https://` addresses, or on `http://localhost` on the same computer.
Opening `http://192.168.x.x:3000` from a phone on your Wi-Fi works for screens, but not for install or alerts.
Deploy (see Deploy) behind HTTPS to use them on phones.

Push keys are created automatically on first start and stored in the database. To pin them yourself, set
`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (from `npx web-push generate-vapid-keys`) and `VAPID_SUBJECT=mailto:you@yourdomain`.
Changing the keys means every phone has to turn alerts on again.

## Use Supabase (hosted Postgres)

1. In Supabase: Project Settings > Database > Connection string > **Session pooler**. Copy the URI and put your database password in it.
2. Run `npm install` once in this folder (installs the `pg` driver).
3. Set the variables and start (Windows cmd example):

        set DATABASE_URL=postgresql://postgres.xxxx:YOURPASSWORD@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres
        set SESSION_SECRET=any-long-random-text-at-least-32-characters
        set ADMIN_PHONE=1234567890
        set ADMIN_PASSWORD=12345678
        npm start

   SESSION_SECRET is mandatory with Supabase and must never change afterwards (it protects invite codes). Tables are created automatically on first start.
4. The server enables Row Level Security with no policies on every table, so Supabase's public REST API (anon key) cannot read any StockLink data. Only this server can. Never put the Supabase `service_role` key or the database password in the browser or in code.
5. `DEMO_MODE=1 npm run seed` loads the demo data into Supabase too. Do not do that on a database with real customers.

## Project layout

```
server.js            entry point: wires config, database, services and routes
seed.js              CLI: npm run seed (-- --reset)
lib/                 config, db (SQLite + Postgres), auth helpers, services, http, security headers, gstin, demo data
routes/              API handlers by role: auth, admin, wholesaler, retailer, shared (media, stream), notify (feed, push)
public/index.html    single page shell
public/style.css     theme (design tokens at the top)
public/sw.js         service worker: install, offline shell, phone notifications (never caches /api)
public/manifest.webmanifest, public/icons/   app name and icons for the home screen
public/js/           front end, plain ES modules, no build step
  main.js            event wiring + boot
  i18n.js            English and Hinglish text
  core/              state, api, live updates (SSE), data loading, render
  ui/                shell (top bar, tabs), shared components, sheets (menu, tutorial, add product)
  features/          auth, retailer, wholesaler, admin screens and their actions
test/                security.test.js (122 checks), e2e.js (browser, needs Playwright)
```

Every value shown on screen goes through the `html` template tag in `public/js/core/html.js`, which escapes by default.

## Backups

Copy the SQLite file (and secret.key if you did not set SESSION_SECRET) nightly. With the file stopped or using `sqlite3 stocklink.db ".backup backup.db"`.

## Android app (APK)

The APK is a small (about 1–2 MB) Android app that opens your **live** StockLink website full screen with its own icon, no browser bar, and phone alerts. It needs the website to be online first (see the Launch day checklist).

One-time setup:
1. Deploy to Render and note your address, for example `https://stocklink-xxxx.onrender.com`. Open `https://your-address/.well-known/assetlinks.json` in a browser; it must show the key fingerprint.
2. GitHub > your repository > **Settings > Secrets and variables > Actions**:
   - **Variables** tab > New repository variable: `APP_URL` = your address (starts with `https://`, no `/` at the end).
   - **Secrets** tab > New repository secret: `ANDROID_KEYSTORE_B64` (text of `android-signing/keystore-base64.txt`) and `ANDROID_KEYSTORE_PASSWORD` (text of `android-signing/PASSWORD.txt`).
3. Add the build file once: on github.com open your repository > **Add file > Create new file**, name it `.github/workflows/android-apk.yml`, paste the whole text of `android/COPY-TO-github-workflows-android-apk.yml`, and **Commit**.
4. **Actions > Build Android APK > Run workflow.** After about 5–8 minutes, open the finished run and download **StockLink-apk** (a zip with `StockLink.apk` inside).

Share it:
- Send `StockLink.apk` on WhatsApp, or put it on the website: copy it to `public/download/StockLink.apk`, push, and the website shows a red **Download Android app (APK)** button automatically on the `/download` page.
- On the phone: open the file, allow **Install unknown apps** for the browser/WhatsApp if asked, tap **Install**.
- Updates: run the workflow again and share the new APK; it installs over the old one (same signing key).

Keep `android-signing/` private and backed up. It is excluded from GitHub. If you lose it you cannot update installed apps.
iPhone users install from the website (Safari > Share > Add to Home Screen); iPhones do not accept APK files.

## Website

`/download` is the public website (Install button, features, how it works, FAQ). Files: `public/download/`.
To show a WhatsApp contact link, put your number in `public/download/site.js` (`WHATSAPP = '919812345678'`).
Replace the screenshots in `public/download/img/` with real ones whenever you like.

## Chat and payment options

* **Chat:** each wholesaler and each of its retailers (approved or pending) has one private conversation. Open it from the Chat tab or the "Message" button on any order; the message is then tagged with that order. Quick replies, unread badges, read ticks (✓ sent, ✓✓ seen), live updates and a push alert. Limit: 20 messages a minute per person, 1,000 characters each. Shops that are not connected, and admins, cannot read or send.
* **How the retailer pays and collects:** Pickup or Delivery, then UPI, Cash (at pickup, or on delivery) or Credit.
* **Wholesaler controls:** Menu → Shop settings → "What retailers can choose": turn Cash and Delivery on or off. The server refuses a cash or delivery order when that option is off, so an old app screen cannot get around it.

## Tests

    npm test                 # 174 security and integrity checks (incl. chat and payment options), starts its own temp server
    node test/e2e.js         # browser test (needs Playwright and a fresh demo server on port 3111)

See SECURITY.md for what is covered and what is not.

## Not built yet (be honest with customers and investors)

* Login is phone + password. No SMS OTP, no password reset (admin must reset).
* Payments are manual: retailer pays by UPI and submits the UTR, wholesaler verifies in their bank app. No payment gateway, no automatic reconciliation.
* No Tally / billing-software stock sync. Wholesalers update counts by hand (-1 sold, +10 restock, set exact count).
* No WhatsApp notifications. Chat has no photos or voice notes yet.
* No GST invoices, no delivery tracking, no multi-user staff accounts per shop.
* Photos are stored in the database. Fine for pilots; move them to Supabase Storage plus a CDN before thousands of products.
* Live-update streams (SSE) and rate limits are per server process. Run one instance until they move to Redis.
