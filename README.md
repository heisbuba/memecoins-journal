# Memecoins Trading Journal

My manual, static, and serverless trading journal. Private to me at
[journal.quantvat.name.ng](https://journal.quantvat.name.ng).

PIN-locked like the wapka sites of 2017. 🔒 Hosted on Cloudflare.

## Features

- 100% serverless — Cloudflare Pages static site + Pages Functions + D1 database
- PIN login (4–8 digits) with HMAC-signed session cookies
- Login attempt tracking (rate limiting via the `login_attempts` table)
- Fully static frontend (no build step), installable as a PWA
- All data lives in D1 SQL — no backend server needed

## Tech Stack

- **Frontend:** Static HTML/CSS/JS (`public/`), service worker + PWA manifest
- **Backend:** Cloudflare Pages Functions (`functions/api/`)
- **Database:** Cloudflare D1 (SQLite)
- **Auth:** PIN + HMAC-SHA256 signed session cookies (`functions/_middleware.js`)

## Setup

1. **Clone the repo**

   ```bash
   git clone https://github.com/YOUR_USER/memecoins-journal.git
   cd memecoins-journal
   ```

2. **Create the D1 database**

   ```bash
   wrangler d1 create memecoins-journal
   ```

   Copy the `database_id` — you'll need it for the Pages binding in step 4.

3. **Create the tables**

   ```bash
   wrangler d1 execute memecoins-journal --remote --file=schema.sql
   ```

   > If the `ALTER TABLE` at the bottom of `schema.sql` fails with
   > "duplicate column name: exit_mc", it's safe to ignore — it only adds
   > `exit_mc` for databases created before that column existed.

4. **Deploy as a Cloudflare Pages project**

   Either connect the repo in the Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git**, or deploy directly:

   ```bash
   npx wrangler pages deploy public
   ```

5. **Bind the database** in **Pages → your project → Settings → Functions → D1 database bindings**:

   - Variable name: **`DB`** (must be exactly `DB` — the functions read `env.DB`)
   - D1 database: `memecoins-journal`

6. **Set the secrets** (Pages → Settings → Environment variables → **Encrypt**, or via CLI):

   - `PIN` — any 4–8 digit number, e.g. `4242`
   - `SECRET` — 40+ random characters, e.g. generate one with:

     ```bash
     openssl rand -hex 32
     ```

   ```bash
   wrangler pages secret put PIN
   wrangler pages secret put SECRET
   ```

7. **Attach your custom domain** (e.g. `journal.quantvat.name.ng`) in
   **Pages → Custom domains**, and point the DNS record to Cloudflare.

That's it. 🎉

## Security Notes

- The PIN never leaves the server — login is verified in `functions/api/login.js` and compared against the encrypted `PIN` secret.
- Sessions are HMAC-SHA256 signed with the `SECRET` key and expire server-side (see `functions/_middleware.js`).
- Repeated failed logins are tracked per-IP in the `login_attempts` table.
- The middleware also redirects the default `*.pages.dev` hostname to your custom domain, so the journal only answers on your own domain.

## Project Structure

```
├── public/                 # Static frontend (deployed as-is)
│   ├── index.html
│   ├── app.js
│   ├── calc.js
│   ├── style.css
│   ├── sw.js               # Service worker (PWA)
│   ├── manifest.webmanifest
│   └── icons/              # PWA icons
├── functions/              # Cloudflare Pages Functions
│   ├── _middleware.js      # Session auth + pages.dev redirect
│   └── api/
│       ├── login.js        # PIN login endpoint
│       └── trades.js       # CRUD for trades (requires session)
├── schema.sql              # D1 schema (trades + login_attempts)
└── README.md
```

## License

Personal project — all rights reserved.
