# snapp

A full-stack, privacy-first downloader for public Instagram posts, Reels, videos, and carousels. It uses a small Node server to resolve public Instagram pages and proxy the returned media so the browser can preview and download it without exposing a media URL to the page.

## Run locally

```bash
npm start
```

Open [http://localhost:3000](http://localhost:3000).

## Deploy to Vercel

The repo is already configured for Vercel: `api/index.js` exposes the same Node
request handler the local server uses, and `vercel.json` routes every path to
it.

### One-click (no CLI needed)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fluckydev-dev%2FTest)

Import the repo, keep the default settings (Vercel detects `vercel.json`), and
deploy. If you want this branch's work deployed first, merge it into `main` or
set **Production Branch** to the branch you pushed.

### From the CLI

```bash
npx vercel login        # or: npm run deploy (uses npx --yes vercel)
npm run deploy          # vercel deploy --prod
```

The first `vercel deploy` in a folder links the project; answer the prompts
(`Set up and deploy` → yes) or pre-create the project in the dashboard.

### Automatic deploys with GitHub Actions

`.github/workflows/vercel.yml` deploys on every push to `main`. It stays idle
until you add three repository secrets
(**Settings → Secrets and variables → Actions**):

| Secret | Where to find it |
| --- | --- |
| `VERCEL_TOKEN` | [vercel.com/account/tokens](https://vercel.com/account/tokens) |
| `VERCEL_ORG_ID` | `.vercel/project.json` after `vercel link`, or Project Settings |
| `VERCEL_PROJECT_ID` | same as above |

### Notes for the serverless runtime

- `maxDuration` is 60s (`api/index.js` + `vercel.json`); Hobby accounts cap
  functions at 60s, so very large video downloads can time out.
- The build step copies `public/` to the deployment root so Vercel's CDN serves
  `index.html`, `app.js`, and `styles.css` directly; the function is only used
  for `/api/*`.
- No environment variables are required. `PORT` is ignored on Vercel and
  `SNAPP_UPSTREAM_TIMEOUT` (ms, default `18000`) is optional.

## Notes

- Only public Instagram `p`, `reel`, `reels`, and `tv` URLs are accepted.
- Private posts, stories, live streams, and login-gated content are intentionally not supported.
- No Instagram credentials are collected.
- Recent links are kept in the browser's local storage; the server does not persist them.
