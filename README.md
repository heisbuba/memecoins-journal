# Memecoins Trading Journal

My manual, static, serverless memecoin trading journal. Live at
[journal.quantvat.name.ng](https://journal.quantvat.name.ng), but you'll need the PIN. (You don't have it. 😄)
 
Before and after charts, pattern analysis, and zero broker sync. PIN-locked like the wapka sites of 2017. 🔒 Hosted on Cloudflare.

## Features

- 100% serverless — Cloudflare Pages static site + Pages Functions + D1 database + R2 storage
- PIN login (4–8 digits) with HMAC-signed session cookies
- Login attempt tracking (rate limiting via the `login_attempts` table)
- Fully static frontend (no build step), installable as a PWA
- All data lives in D1 SQL — no backend server needed
- Before and after chart for every trade, stored in a private R2 bucket (paste a screenshot or pick a file) and opened in a full-screen viewer with a side-by-side Compare mode
- Charts browser (`/charts`) to filter, sort and browse the charts of all trades
- Pattern analysis (`/patterns`) with key findings, bar charts and tables by strategy, time of day, weekday, entry hour, market cap, review, tags and risk

## Tech Stack

- **Frontend:** Static HTML/CSS/JS (`public/`), service worker + PWA manifest
- **Backend:** Cloudflare Pages Functions (`functions/api/`)
- **Database:** Cloudflare D1 (SQLite)
- **File storage:** Cloudflare R2 (trade charts)
- **Auth:** PIN + HMAC-SHA256 signed session cookies (`functions/_middleware.js`)

## Setup

1. **Clone the repo**

   ```bash
   git clone https://github.com/heisbuba/memecoins-journal.git
   cd memecoins-journal
   ```

2. **Create the D1 database**

   ```bash
   wrangler d1 create memecoins-journal
   ```

   Copy the `database_id` — you'll need it for the Pages binding in step 6.

3. **Create the tables**

   ```bash
   wrangler d1 execute memecoins-journal --remote --file=schema.sql
   ```

   > Upgrading a database created before the charts feature? Add the two
   > chart columns (a "duplicate column name" error means it's already there):
   >
   > ```bash
   > wrangler d1 execute memecoins-journal --remote --command "ALTER TABLE trades ADD COLUMN before_image TEXT"
   > wrangler d1 execute memecoins-journal --remote --command "ALTER TABLE trades ADD COLUMN after_image TEXT"
   > ```

4. **Create the R2 bucket** for the trade charts

   ```bash
   wrangler r2 bucket create journal-charts
   ```

   Keep it private — charts are served through the PIN-protected `/api/images`.
   R2 asks for a payment method on file even on the free tier.

5. **Deploy as a Cloudflare Pages project**

   Either connect the repo in the Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git**, or deploy directly:

   ```bash
   npx wrangler pages deploy public
   ```

6. **Bind the database and the bucket** in **Pages → your project → Settings → Functions → D1 database bindings**:

   - Variable name: **`DB`** (must be exactly `DB` — the functions read `env.DB`)
   - D1 database: `memecoins-journal`

   Then add an R2 bucket binding the same way:

   - Variable name: **`BUCKET`** (must be exactly `BUCKET` — `functions/api/images.js` reads `env.BUCKET`)
   - R2 bucket: `journal-charts`

   Bindings only apply to new deployments, so redeploy after adding them.

7. **Set the secrets** (Pages → Settings → Environment variables → **Encrypt**, or via CLI):

   - `PIN` — any 4–8 digit number, e.g. `4242`
   - `SECRET` — 40+ random characters, e.g. generate one with:

     ```bash
     openssl rand -hex 32
     ```

   ```bash
   wrangler pages secret put PIN
   wrangler pages secret put SECRET
   ```

8. **Attach your custom domain** (e.g. `journal.quantvat.name.ng`) in
   **Pages → Custom domains**, and point the DNS record to Cloudflare.

That's it.

## License

Personal project — all rights reserved.
