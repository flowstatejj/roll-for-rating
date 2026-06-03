# Roll for Rating — marketing website

A self-contained, zero-build static site: the landing page (`index.html`), the
hosted privacy policy (`privacy.html`), styles (`styles.css`), and a tiny bit of
JS (`script.js`). No frameworks, no build step — just files you can host anywhere.

It's intentionally **separate from the app** (the Expo app lives in the repo root).
Render only auto-deploys the app, so nothing here ships automatically.

## Preview locally

Open `website/index.html` in a browser, or serve the folder:

```bash
npx serve website      # then visit the printed http://localhost:3000
```

## Deploy (pick one — all free for this)

The whole site is static, so any of these work. Point them at the **`website/`**
folder (or copy its contents to the deploy root).

- **Netlify** — drag the `website` folder onto app.netlify.com/drop, or connect
  the repo and set "Publish directory" = `website`.
- **Cloudflare Pages / Vercel** — connect the repo, framework preset **None**,
  build command empty, output directory `website`.
- **Render (static site)** — New → Static Site → this repo → Publish directory
  `website`, build command empty. (Keeps it next to the app, which is already on Render.)
- **GitHub Pages** — push `website/` to a `gh-pages` branch or set Pages to serve
  from `/website`.

### Point the domain
Once `rollforrating.com` is registered, add it as a custom domain in whichever
host you chose and follow their DNS instructions (usually a CNAME + the host's
verification record). Set `privacy.html` as the Privacy Policy URL in App Store
Connect: `https://rollforrating.com/privacy.html`.

## Before launch — quick checklist

- [ ] **Contact email:** the site uses `hello@rollforrating.com`. Set up that
      inbox, or find/replace it in `index.html`, `privacy.html`, `script.js`.
- [ ] **Waitlist:** the form currently opens the visitor's mail app (no backend).
      To collect signups automatically, point the handler in `script.js` at a form
      service (Formspree, Buttondown, ConvertKit) or a Supabase insert.
- [ ] **App Store badge:** when the app is live, replace the "Coming soon" badges
      in the `#get` section with real App Store / Play Store links + official badges.
- [ ] **Screenshots:** the hero uses a CSS mockup of the app. Swap in real
      screenshots once you have App Store assets if you want photos.
- [ ] **Privacy policy:** have a lawyer review (especially the minors section)
      before public launch. Content mirrors `PRIVACY-POLICY.md` in the repo root.
- [ ] **Analytics (optional):** drop in Plausible/Fathom/GA snippet in `<head>`.

## Notes

- Copy is drawn from `APP-STORE-LISTING.md` and `PRIVACY-POLICY.md` so the site,
  the store listing, and the policy stay consistent.
- Brand: name **Roll for Rating**, the rating value is **ROR** ("roar"), accent
  `#2f81f7`, dark chess.com-style surface — matching the app.
