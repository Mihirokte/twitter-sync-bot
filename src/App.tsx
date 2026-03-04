import { useCallback, useEffect, useState } from "react";

const STORAGE_KEYS = {
  spreadsheetId: "twitter_sync_spreadsheet_id",
  sheetName: "twitter_sync_sheet_name",
  githubRepo: "twitter_sync_github_repo",
  githubToken: "twitter_sync_github_token",
} as const;

const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string;

type SheetRow = string[];

function loadSetting(key: keyof typeof STORAGE_KEYS): string {
  try {
    return localStorage.getItem(STORAGE_KEYS[key]) ?? "";
  } catch {
    return "";
  }
}

function saveSetting(key: keyof typeof STORAGE_KEYS, value: string): void {
  try {
    localStorage.setItem(STORAGE_KEYS[key], value);
  } catch {
    // ignore
  }
}

function getGoogleToken(): Promise<string> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !(window as unknown as { google?: unknown }).google) {
      reject(new Error("Google Identity Services not loaded"));
      return;
    }
    const google = (window as unknown as {
      google: {
        accounts: {
          oauth2: {
            initTokenClient: (config: {
              client_id: string;
              scope: string;
              callback: (res: { access_token?: string; error?: string }) => void;
            }) => { requestAccessToken: (opts?: { callback?: (res: unknown) => void }) => void };
          };
        };
      };
    }).google;
    const client = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SHEETS_SCOPE,
      callback: (res: { access_token?: string; error?: string }) => {
        if (res.error) reject(new Error(res.error));
        else if (res.access_token) resolve(res.access_token);
        else reject(new Error("No access token"));
      },
    });
    client.requestAccessToken();
  });
}

async function fetchSheetRows(accessToken: string, spreadsheetId: string, sheetName: string): Promise<SheetRow[]> {
  const range = encodeURIComponent(`${sheetName}!A1:Z`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?valueRenderOption=FORMATTED_VALUE`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || `Sheets API ${res.status}`);
  }
  const data = (await res.json()) as { values?: SheetRow[] };
  return data.values ?? [];
}

function triggerSync(githubRepo: string, githubToken: string): Promise<void> {
  const [owner, repo] = githubRepo.split("/").map((s) => s.trim());
  if (!owner || !repo) return Promise.reject(new Error("Invalid repo: use owner/repo"));
  const url = `https://api.github.com/repos/${owner}/${repo}/dispatches`;
  return fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github.v3+json",
      Authorization: `token ${githubToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ event_type: "sync" }),
  }).then((r) => {
    if (!r.ok) return r.json().then((j) => Promise.reject(new Error((j as { message?: string }).message || String(r.status))));
  });
}

export default function App() {
  const [spreadsheetId, setSpreadsheetId] = useState(() => loadSetting("spreadsheetId"));
  const [sheetName, setSheetName] = useState(() => loadSetting("sheetName") || "TwitterLikes");
  const [githubRepo, setGithubRepo] = useState(() => loadSetting("githubRepo"));
  const [githubToken, setGithubToken] = useState(() => loadSetting("githubToken"));
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [rows, setRows] = useState<SheetRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    saveSetting("spreadsheetId", spreadsheetId);
  }, [spreadsheetId]);
  useEffect(() => {
    saveSetting("sheetName", sheetName);
  }, [sheetName]);
  useEffect(() => {
    saveSetting("githubRepo", githubRepo);
  }, [githubRepo]);
  useEffect(() => {
    saveSetting("githubToken", githubToken);
  }, [githubToken]);

  const signIn = useCallback(() => {
    setError(null);
    getGoogleToken()
      .then(setAccessToken)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const loadSheet = useCallback(() => {
    if (!accessToken || !spreadsheetId || !sheetName) {
      setError("Sign in with Google and set Spreadsheet ID + Sheet name.");
      return;
    }
    setError(null);
    setLoading(true);
    fetchSheetRows(accessToken, spreadsheetId, sheetName)
      .then(setRows)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [accessToken, spreadsheetId, sheetName]);

  const syncNow = useCallback(() => {
    if (!githubRepo || !githubToken) {
      setSyncStatus("Set GitHub repo and token in Settings first.");
      return;
    }
    setError(null);
    setSyncStatus("Triggering sync…");
    triggerSync(githubRepo, githubToken)
      .then(() => {
        setSyncStatus("Sync triggered. Refreshing sheet in 5s…");
        setTimeout(() => {
          if (accessToken && spreadsheetId && sheetName) {
            fetchSheetRows(accessToken, spreadsheetId, sheetName).then(setRows);
          }
          setSyncStatus("Done. Refresh the table if needed.");
        }, 5000);
      })
      .catch((e) => {
        setSyncStatus(null);
        setError(e instanceof Error ? e.message : String(e));
      });
  }, [githubRepo, githubToken, accessToken, spreadsheetId, sheetName]);

  const headers = rows[0] ?? ["tweetId", "author", "authorHandle", "content", "tweetUrl", "likes", "retweets", "action"];
  const dataRows = rows.slice(1);

  return (
    <div style={{ maxWidth: 900, width: "100%" }}>
      <h1 style={{ marginBottom: 8 }}>Twitter Likes → Sheets</h1>
      <p style={{ color: "#94a3b8", marginBottom: 24 }}>
        Hosted on GitHub Pages. Sync runs in GitHub Actions using your repo secrets.
      </p>

      <section style={{ marginBottom: 24, padding: 16, background: "#1e293b", borderRadius: 12 }}>
        <h2 style={{ marginTop: 0, fontSize: "1rem" }}>Settings</h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            Spreadsheet ID:
            <input
              type="text"
              value={spreadsheetId}
              onChange={(e) => setSpreadsheetId(e.target.value)}
              placeholder="1BxiMVs0XRA5n..."
              style={{ width: 220, padding: "6px 8px", borderRadius: 6, border: "1px solid #475569" }}
            />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            Sheet name:
            <input
              type="text"
              value={sheetName}
              onChange={(e) => setSheetName(e.target.value)}
              placeholder="TwitterLikes"
              style={{ width: 120, padding: "6px 8px", borderRadius: 6, border: "1px solid #475569" }}
            />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            GitHub repo (owner/repo):
            <input
              type="text"
              value={githubRepo}
              onChange={(e) => setGithubRepo(e.target.value)}
              placeholder="yourname/twitter-sync-bot"
              style={{ width: 200, padding: "6px 8px", borderRadius: 6, border: "1px solid #475569" }}
            />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            GitHub PAT (repo scope):
            <input
              type="password"
              value={githubToken}
              onChange={(e) => setGithubToken(e.target.value)}
              placeholder="ghp_..."
              style={{ width: 180, padding: "6px 8px", borderRadius: 6, border: "1px solid #475569" }}
            />
          </label>
        </div>
      </section>

      <section style={{ marginBottom: 24 }}>
        {!CLIENT_ID && (
          <p style={{ color: "#f97316" }}>
            Set <code>VITE_GOOGLE_CLIENT_ID</code> at build time (e.g. in repo secrets) for Google Sign-in.
          </p>
        )}
        {CLIENT_ID && !accessToken && (
          <button
            type="button"
            onClick={signIn}
            style={{
              padding: "10px 20px",
              borderRadius: 9999,
              border: "none",
              background: "#22c55e",
              color: "#022c22",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Sign in with Google
          </button>
        )}
        {accessToken && (
          <button
            type="button"
            onClick={loadSheet}
            disabled={loading || !spreadsheetId}
            style={{
              padding: "10px 20px",
              borderRadius: 9999,
              border: "none",
              background: "#3b82f6",
              color: "#fff",
              fontWeight: 600,
              cursor: loading ? "default" : "pointer",
              opacity: loading || !spreadsheetId ? 0.8 : 1,
            }}
          >
            {loading ? "Loading…" : "Load sheet"}
          </button>
        )}
      </section>

      <section style={{ marginBottom: 24 }}>
        <button
          type="button"
          onClick={syncNow}
          disabled={!githubRepo || !githubToken}
          style={{
            padding: "12px 28px",
            borderRadius: 9999,
            border: "none",
            background: "#22c55e",
            color: "#022c22",
            fontWeight: 600,
            fontSize: "1rem",
            cursor: !githubRepo || !githubToken ? "default" : "pointer",
            opacity: !githubRepo || !githubToken ? 0.7 : 1,
          }}
        >
          Sync now
        </button>
        {syncStatus && <span style={{ marginLeft: 12, color: "#94a3b8" }}>{syncStatus}</span>}
      </section>

      {error && (
        <p style={{ color: "#f97373", marginBottom: 16 }} role="alert">
          {error}
        </p>
      )}

      {dataRows.length > 0 && (
        <section>
          <h2 style={{ fontSize: "1rem" }}>Sheet data ({dataRows.length} rows)</h2>
          <div style={{ overflowX: "auto", border: "1px solid #334155", borderRadius: 8 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
              <thead>
                <tr style={{ background: "#1e293b" }}>
                  {headers.map((h, i) => (
                    <th key={i} style={{ padding: "8px 10px", textAlign: "left", borderBottom: "1px solid #334155" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dataRows.map((row, ri) => (
                  <tr key={ri} style={{ borderBottom: "1px solid #334155" }}>
                    {headers.map((_, ci) => (
                      <td key={ci} style={{ padding: "8px 10px", maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis" }}>
                        {ci === 4 && row[ci] ? (
                          <a href={row[ci]} target="_blank" rel="noopener noreferrer">
                            {row[ci].slice(0, 40)}…
                          </a>
                        ) : (
                          String(row[ci] ?? "").slice(0, 80)
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
