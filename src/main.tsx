import React from "react";
import ReactDOM from "react-dom/client";
import { DockApp } from "./app/DockApp";
import { SettingsApp } from "./features/settings/SettingsApp";
import "./styles/global.css";

// One bundle, two windows: the settings window is opened with ?window=settings.
const isSettings =
  new URLSearchParams(window.location.search).get("window") === "settings" ||
  window.location.hash.startsWith("#/settings");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>{isSettings ? <SettingsApp /> : <DockApp />}</React.StrictMode>,
);
