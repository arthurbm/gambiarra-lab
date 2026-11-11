import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AdminPage } from "./admin/admin-page";
import { CelularPage } from "./celular/celular-page";
import { TelaoDemoPage } from "./telao/demo-page";
import { TelaoPage } from "./telao/telao-page";
import "./index.css";

const TRAILING_SLASH = /\/+$/;

// Three screens, one page each; no router is needed for that.
function Screen() {
  const path = window.location.pathname.replace(TRAILING_SLASH, "") || "/";
  if (path === "/telao/demo") {
    return <TelaoDemoPage />;
  }
  if (path === "/telao") {
    return <TelaoPage />;
  }
  if (path === "/admin") {
    return <AdminPage />;
  }
  return <CelularPage />;
}

const root = document.getElementById("app");
if (!root) {
  throw new Error("#app is missing from index.html");
}
createRoot(root).render(
  <StrictMode>
    <Screen />
  </StrictMode>
);
