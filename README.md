# Ghanti (bell) — Worker deployment

This project serves a static bell site (frontend) and an optional Cloudflare Worker + KV for global visit and vote counts.

Deployment checklist (Cloudflare Worker)

1. Install Wrangler (Cloudflare CLI):

```bash
npm install -g wrangler
```

2. Authenticate Wrangler:

```bash
wrangler login
```

3. Create a KV namespace (returns an `id`):

```bash
wrangler kv:namespace create "VOTES_KV"
# Note the printed `id`, you'll paste it into `worker/wrangler.toml`
```

4. Update `worker/wrangler.toml`:

- Set `account_id` to your Cloudflare account id.
- Replace the `id` under `[[kv_namespaces]]` with the KV namespace id from step 3.
- Set `SITE_ORIGIN` to your GitHub Pages site origin (e.g. `https://<user>.github.io/ghanti`).

5. Add Turnstile secret (do NOT put this in Git):

```bash
wrangler secret put TURNSTILE_SECRET
# paste your Turnstile secret when prompted
```

6. Publish the worker:

```bash
wrangler publish --env production
```

7. Confirm the public worker URL and update `script.js` if it differs from the placeholder `WORKER_BASE`.

Local testing

- You can serve the static site locally with:

```bash
python -m http.server 8000
# then open http://localhost:8000
```

Notes

- The repository contains `worker/index.js` (the Worker code) and `worker/wrangler.toml` (config with placeholders).
- Do not store secrets in the repo. Use `wrangler secret put` for `TURNSTILE_SECRET`.
- If you'd like, run `worker/deploy.ps1` (PowerShell) from the project root; it helps automate KV creation and `wrangler.toml` updates.
