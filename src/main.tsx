import React from "react";
import ReactDOM from "react-dom/client";
import { DockApp } from "./app/DockApp";
import { DesktopWidgets } from "./features/desktop/DesktopWidgets";
import { SettingsApp } from "./features/settings/SettingsApp";
import "./styles/global.css";

// One bundle, three windows, told apart by ?window=. The dock is the
// default because it is the one that always exists.
const requested = new URLSearchParams(window.location.search).get("window");
const isSettings = requested === "settings" || window.location.hash.startsWith("#/settings");
const isWidgets = requested === "widgets";

function Root() {
  if (isSettings) return <SettingsApp />;
  if (isWidgets) return <DesktopWidgets />;
  return <DockApp />;
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
