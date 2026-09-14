# snapp

A full-stack, privacy-first downloader for public Instagram posts, Reels, videos, and carousels. It uses a small Node server to resolve public Instagram pages and proxy the returned media so the browser can preview and download it without exposing a media URL to the page.

## Run locally

```bash
npm start
```

Open [http://localhost:3000](http://localhost:3000).

## Notes

- Only public Instagram `p`, `reel`, `reels`, and `tv` URLs are accepted.
- Private posts, stories, live streams, and login-gated content are intentionally not supported.
- No Instagram credentials are collected.
- Recent links are kept in the browser's local storage; the server does not persist them.
