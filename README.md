# Twitter Likes → Google Sheets (GitHub Pages)

Static app hosted on **GitHub Pages** with sync powered by **GitHub Actions**. No server to run.

- **UI**: React SPA at `https://<your-username>.github.io/twitter-sync-bot/`
- **Sync**: "Sync now" triggers a workflow that fetches your Twitter likes (via cookies) and appends them to a Google Sheet.
- **Data**: Stored in your own Google Sheet; you can add agentic actions per row later.

---

## 1. Clone and deploy

1. **Fork or create a repo** (e.g. `twitter-sync-bot`) and clone it.

2. **Enable GitHub Pages** (Actions):
   - Repo → **Settings** → **Pages** → Source: **GitHub Actions**.

3. **Secrets** (Repo → **Settings** → **Secrets and variables** → **Actions**):

   | Secret | Description |
   |--------|-------------|
   | `VITE_GOOGLE_CLIENT_ID` | Google OAuth 2.0 client ID (Web app) for sign-in. |
   | `VITE_DEFAULT_SPREADSHEET_ID` | (Optional) Default spreadsheet ID so users don’t have to type it. |
   | `VITE_GITHUB_REPO` | (Optional) Default repo (e.g. `Mihirokte/twitter-sync-bot`) for Sync now. |
   | `TWITTER_COOKIES_JSON` | JSON string: `{"auth_token":"...","ct0":"..."}` (from x.com cookies). |
   | `TWITTER_HANDLE` | Your X/Twitter username (no `@`). |
   | `SPREADSHEET_ID` | Target Google Sheet ID (from the sheet URL). |
   | `SHEET_NAME` | (Optional) Sheet tab name; default `TwitterLikes`. |
   | `MAX_LIKES` | (Optional) Max likes to fetch per run; default `100`. |
   | `GOOGLE_SERVICE_ACCOUNT_JSON` | Full JSON key of a **service account** that has access to the spreadsheet (share the sheet with the service account email). |

4. **Push to `main`**  
   The **Deploy to GitHub Pages** workflow builds the app and publishes it. The site will be at:

   `https://<owner>.github.io/twitter-sync-bot/`

### If you get a 404 or stuck "Loading..." with 404 for `/src/main.tsx`

The site is serving **repo source** instead of the **built app**. You must use the workflow output:

1. **Pages source**  
   Repo → **Settings** → **Pages** → under "Build and deployment", set **Source** to **GitHub Actions** (not "Deploy from a branch"). Save.

2. **Deploy workflow**  
   Repo → **Actions** → open **"Deploy to GitHub Pages"**. Check the latest run on `main`:
   - If it’s missing or failed, push a new commit to `main` and wait for the run to finish (green check).
   - If the **build** job failed, open it and read the log (e.g. `npm ci` or `npm run build` errors).
   - If the **deploy** job failed, check that the **Pages** environment exists and that the run has permission to deploy.

3. **Exact URL**  
   Use the exact repo name (case-sensitive in the path):  
   `https://mihirokte.github.io/twitter-sync-bot/`  
   (no trailing slash is fine; GitHub redirects.)

4. **Cache**  
   Try a hard refresh (Ctrl+Shift+R) or an incognito window.

---

## 2. One-time setup in the UI

1. Open the deployed URL and open **Settings**.
2. **Spreadsheet ID**: Paste the ID of the Google Sheet you use for Twitter likes (same as `SPREADSHEET_ID` if you want).
3. **Sheet name**: Tab name (e.g. `TwitterLikes`), same as `SHEET_NAME` in secrets.
4. **GitHub repo**: `owner/repo` of this repo (e.g. `yourname/twitter-sync-bot`).
5. **GitHub PAT**: A [personal access token](https://github.com/settings/tokens) with `repo` (or at least enough to trigger `repository_dispatch`). Used only to call the GitHub API when you click "Sync now"; stored in your browser (localStorage) only.

Click **Sign in with Google** so the app can read the sheet and show the table. Then **Sync now** will trigger the sync workflow and refresh the table after a few seconds.

---

## 3. How sync works

- Clicking **Sync now** sends a `repository_dispatch` event to your repo.
- The **Sync Twitter likes to Sheets** workflow runs: it uses `twikit` with `TWITTER_COOKIES_JSON` to fetch your recent likes, then appends new rows to the sheet via the service account.
- Columns: `tweetId`, `author`, `authorHandle`, `content`, `tweetUrl`, `likes`, `retweets`, `action` (set to `synced`). You can change `action` later for agentic steps (e.g. `summarized`, `posted`).

---

## 4. Local development

```bash
npm install
npm run dev
```

For local sync (without GitHub Actions), use the Python script with config files:

```bash
pip install -r requirements.txt
# Create config.json (from config.example.json) and cookies.json
export GOOGLE_SERVICE_ACCOUNT_FILE=/path/to/key.json
export GOOGLE_SHEETS_SPREADSHEET_ID=your_sheet_id
python twitter_sync.py
```

---

## 5. Base path

The app is built with `base: "/twitter-sync-bot/"` for GitHub Pages. If you use a different repo name, change `base` in `vite.config.ts` and redeploy.
