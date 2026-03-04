/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GOOGLE_CLIENT_ID: string;
  readonly VITE_DEFAULT_SPREADSHEET_ID: string;
  readonly VITE_GITHUB_REPO: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
