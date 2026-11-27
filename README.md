# Weight Loss Tracker (PWA)

A personal weight-loss tracker that installs on your phone's home screen and works offline.
Plain HTML/CSS/JS — no build step. All data stays on your phone (IndexedDB).

## Files
| File | What it is |
|---|---|
| `index.html` | The page layout |
| `styles.css` | Dark-mode styling |
| `app.js` | All the app logic (database, chart, scanner, etc.) |
| `sw.js` | Service worker — makes it work offline. **Bump `VERSION` whenever you change any file.** |
| `manifest.json` | Makes it installable (name, colors, icons) |
| `icon-*.png` | App icons |

## Host on GitHub Pages
1. Create a free account at github.com.
2. Tap **+ → New repository**, name it `weight-tracker`, set it to **Public**, tick **Add a README**, tap **Create repository**.
3. Tap **Add file → Upload files**, select all the files in this folder, tap **Commit changes**.
4. Go to **Settings → Pages**. Under *Branch*, pick **main** and **/ (root)**, tap **Save**.
5. Wait 1–2 minutes. Your app is at `https://YOUR-USERNAME.github.io/weight-tracker/`.

## Install on Android
Open that link in **Chrome** → tap **⋮** → **Add to Home screen** → **Install**.

## Updating later
1. Edit the file(s) on GitHub (pencil icon) or upload replacements.
2. In `sw.js`, change `const VERSION = 'v1.0.0';` to a new number (e.g. `v1.0.1`) and commit.
3. Wait ~2 minutes, open the app, and tap **Update** on the banner that appears (close and reopen the app if it doesn't show up).

Your data is not affected by updates. Export a backup from **Settings** now and then.
