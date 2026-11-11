# Hosting the landing page where the audience can reach it

GitHub Pages is blocked on many Chinese campus and office networks. This is not a guess: during the first round of
testing, a tester scanned the poster and got a blank tap on the button — the page loaded on mobile data and did nothing
on the campus Wi-Fi. One tester put it plainly: "不能用宿舍网，得用流量."

The grading check is *"test the link on a phone, from WeChat, logged out — if it does not open, it does not count."*
On the network our testers actually use, the current URL does not count.

## What to upload

```bash
pnpm build:landing
```

writes `deploy/landing/`:

```
deploy/landing/
  index.html      the page, relative paths only
  assets/         the eight images and the one SVG it uses
  .nojekyll       harmless on non-GitHub hosts
```

The page has no build step, no server and no absolute paths, so it runs from any origin unchanged. Both doors point at
the same wenjuanxing form, which is domestic and reachable everywhere.

## Three ways to get a second door

| Option | Cost | Effort | Notes |
|---|---|---|---|
| **Tencent COS static website** | a few yuan | ~30 min | needs a real-name account; most reliable in China |
| **Gitee Pages** | free | ~20 min | needs real-name; Gitee has restricted new Pages sign-ups, check before relying on it |
| **Custom domain in front of GitHub Pages** | a domain | ~1 h | the block is usually on the `github.io` hostname, not the IP; a CNAME often gets through |

### Tencent COS, step by step

1. Create a bucket, region Guangzhou or Shanghai, **public read**.
2. Open **Static website** for the bucket: index document `index.html`, error document `index.html`.
3. Upload the contents of `deploy/landing/` to the bucket root (not into a subfolder — `assets/` must sit beside
   `index.html`).
4. Note the static website endpoint, which looks like
   `https://<bucket>.cos-website.ap-guangzhou.myqcloud.com/`.
5. Open that URL on the phone, on the campus network, logged out. If it loads, the second door works.

### Gitee, step by step

1. Create a public repository, push `deploy/landing/` to its `master` branch.
2. **Services → Gitee Pages**, deploy from `master`, no build command.
3. The URL is `https://<user>.gitee.io/<repo>/`.

## After the second door exists

Pick which one the QR points at:

- **QR at the domestic host.** Works on every network; GitHub stays the canonical source in the repo. Regenerate
  `promo/qr-code.png` and the poster QR.
- **Two QR codes.** Poster carries the domestic one; the GitHub link lives in the post text for people outside China.
  More honest about the split, and nobody hits a wall.

Either way, update the places that spell the URL out:

- `promo/qr-code.png` and the poster image
- `README.md` — the **Promo materials** table
- `promo/social.md` — the "Where to post" table
- `docs/SUBMISSION.md` — the link the grader clicks

## Do not forget

The page still links to `github.com` in the nav and footer (source, issues, docs). On a blocked network those are dead
ends, but they are secondary links, not the call to action — the call to action is the survey. Leave them: on the
domestic door the primary path works, and the GitHub links are a bonus for anyone who can reach them.
