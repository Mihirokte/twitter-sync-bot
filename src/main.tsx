import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

const rootEl = document.getElementById("root");
if (!rootEl) {
  document.body.innerHTML = "<p style='padding:2rem;color:#f97373'>Root element not found.</p>";
} else {
  try {
    createRoot(rootEl).render(
      <StrictMode>
        <App />
      </StrictMode>
    );
  } catch (err) {
    rootEl.innerHTML = `<p style="padding:2rem;color:#f97373">Load error: ${err instanceof Error ? err.message : String(err)}</p>`;
  }
}
