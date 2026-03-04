import { useCallback, useEffect, useState } from "react";

const STORAGE_KEYS = {
  spreadsheetId: "twitter_sync_spreadsheet_id",
  sheetName: "twitter_sync_sheet_name",
  githubRepo: "twitter_sync_github_repo",
  githubToken: "twitter_sync_github_token",
  googleToken: "twitter_sync_google_token",
  googleExpiry: "twitter_sync_google_expiry",
} as const;

const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const TOKEN_BUFFER_MS = 60 * 1000; // treat as expired 1 min early
const TOKEN_LIFETIME_MS = 50 * 60 * 1000; // 50 min

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string;
const DEFAULT_SPREADSHEET_ID = (import.meta.env.VITE_DEFAULT_SPREADSHEET_ID as string) || "";
const DEFAULT_GITHUB_REPO = (import.meta.env.VITE_GITHUB_REPO as string) || "";

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

function getStoredGoogleToken(): string | null {
  const token = loadSetting("googleToken");
  const expiry = loadSetting("googleExpiry");
  if (!token || !expiry) return null;
  const exp = Number(expiry);
  if (Number.isNaN(exp) || exp <= Date.now() + TOKEN_BUFFER_MS) return null;
  return token;
}

function storeGoogleToken(token: string): void {
  saveSetting("googleToken", token);
  saveSetting("googleExpiry", String(Date.now() + TOKEN_LIFETIME_MS));
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
        else if (res.access_token) {
          storeGoogleToken(res.access_token);
          resolve(res.access_token);
        } else reject(new Error("No access token"));
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

const btnPrimary = {
  padding: "12px 24px",
  borderRadius: 9999,
  border: "none",
  fontWeight: 600,
  cursor: "pointer" as const,
};
const btnGreen = { ...btnPrimary, background: "#22c55e", color: "#022c22" };
const btnBlue = { ...btnPrimary, background: "#3b82f6", color: "#fff" };

export default function App() {
  const [spreadsheetId, setSpreadsheetId] = useState(() => loadSetting("spreadsheetId") || DEFAULT_SPREADSHEET_ID);
  const [sheetName, setSheetName] = useState(() => loadSetting("sheetName") || "TwitterLikes");
  const [githubRepo, setGithubRepo] = useState(() => loadSetting("githubRepo") || DEFAULT_GITHUB_REPO);
  const [githubToken, setGithubToken] = useState(() => loadSetting("githubToken"));
  const [accessToken, setAccessToken] = useState<string | null>(() => getStoredGoogleToken());
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
      setError("Sign in with Google and set a spreadsheet.");
      return;
    }
    setError(null);
    setLoading(true);
    fetchSheetRows(accessToken, spreadsheetId, sheetName)
      .then(setRows)
      .catch((e) => {
        setError(e instanceof Error ? e.message : String(e));
        if (String(e).includes("401") || String(e).includes("403")) {
          saveSetting("googleToken", "");
          saveSetting("googleExpiry", "");
          setAccessToken(null);
        }
      })
      .finally(() => setLoading(false));
  }, [accessToken, spreadsheetId, sheetName]);

  const syncNow = useCallback(() => {
    if (!githubRepo || !githubToken) {
      setSyncStatus("Add GitHub repo and PAT in Settings first.");
      return;
    }
    setError(null);
    setSyncStatus("Triggering sync…");
    triggerSync(githubRepo, githubToken)
      .then(() => {
        setSyncStatus("Sync triggered. Refreshing in 5s…");
        setTimeout(() => {
          if (accessToken && spreadsheetId && sheetName) {
            fetchSheetRows(accessToken, spreadsheetId, sheetName).then(setRows);
          }
          setSyncStatus("Done.");
        }, 5000);
      })
      .catch((e) => {
        setSyncStatus(null);
        setError(e instanceof Error ? e.message : String(e));
      });
  }, [githubRepo, githubToken, accessToken, spreadsheetId, sheetName]);

  const headers = rows[0] ?? ["tweetId", "author", "authorHandle", "content", "tweetUrl", "likes", "retweets", "action"];
  const dataRows = rows.slice(1);
  const effectiveSpreadsheet = spreadsheetId || DEFAULT_SPREADSHEET_ID;
  const canSync = !!githubRepo && !!githubToken;
  const canLoadSheet = !!accessToken && !!effectiveSpreadsheet && !!sheetName;

  return (
    <div style={{ maxWidth: 720, width: "100%" }}>
      <h1 style={{ marginBottom: 4 }}>Twitter Likes → Sheets</h1>
      <p style={{ color: "#94a3b8", marginBottom: 20, fontSize: "0.9rem" }}>
        Sign in with Google, then sync. Your session is kept across refreshes.
      </p>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", marginBottom: 20 }}>
        {!CLIENT_ID ? (
          <span style={{ color: "#f97316" }}>Configure VITE_GOOGLE_CLIENT_ID in repo secrets.</span>
        ) : !accessToken ? (
          <button type="button" onClick={signIn} style={btnGreen}>
            Sign in with Google
          </button>
        ) : (
          <>
            <span style={{ color: "#4ade80" }}>Signed in</span>
            <button
              type="button"
              onClick={loadSheet}
              disabled={loading || !canLoadSheet}
              style={{ ...btnBlue, opacity: loading || !canLoadSheet ? 0.8 : 1 }}
            >
              {loading ? "Loading…" : "Load sheet"}
            </button>
          </>
        )}
        <button
          type="button"
          onClick={syncNow}
          disabled={!canSync}
          style={{ ...btnGreen, opacity: canSync ? 1 : 0.7, cursor: canSync ? "pointer" : "default" }}
        >
          Sync now
        </button>
        {syncStatus && <span style={{ color: "#94a3b8", fontSize: "0.9rem" }}>{syncStatus}</span>}
      </div>

      <details style={{ marginBottom: 20, background: "#1e293b", borderRadius: 12, padding: "12px 16px" }}>
        <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: "0.95rem" }}>Settings</summary>
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10, maxWidth: 400 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            Spreadsheet ID
            <input
              type="text"
              value={spreadsheetId}
              onChange={(e) => setSpreadsheetId(e.target.value)}
              placeholder={DEFAULT_SPREADSHEET_ID ? "Uses default if empty" : "1BxiMVs0XRA5n..."}
              style={{ padding: "8px 10px", borderRadius: 6, border: "1px solid #475569", background: "#0f172a" }}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            Sheet name
            <input
              type="text"
              value={sheetName}
              onChange={(e) => setSheetName(e.target.value)}
              placeholder="TwitterLikes"
              style={{ padding: "8px 10px", borderRadius: 6, border: "1px solid #475569", background: "#0f172a" }}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            GitHub repo (owner/repo)
            <input
              type="text"
              value={githubRepo}
              onChange={(e) => setGithubRepo(e.target.value)}
              placeholder={DEFAULT_GITHUB_REPO || "Mihirokte/twitter-sync-bot"}
              style={{ padding: "8px 10px", borderRadius: 6, border: "1px solid #475569", background: "#0f172a" }}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            GitHub PAT (for Sync now)
            <input
              type="password"
              value={githubToken}
              onChange={(e) => setGithubToken(e.target.value)}
              placeholder="ghp_..."
              style={{ padding: "8px 10px", borderRadius: 6, border: "1px solid #475569", background: "#0f172a" }}
            />
          </label>
        </div>
      </details>

      {error && (
        <p style={{ color: "#f97373", marginBottom: 16 }} role="alert">
          {error}
        </p>
      )}

      {dataRows.length > 0 && (
        <section>
          <h2 style={{ fontSize: "1rem" }}>Sheet ({dataRows.length} rows)</h2>
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
                      <td key={ci} style={{ padding: "8px 10px", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis" }}>
                        {ci === 4 && row[ci] ? (
                          <a href={String(row[ci])} target="_blank" rel="noopener noreferrer">
                            {String(row[ci]).slice(0, 36)}…
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
