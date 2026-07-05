/**
 * First-launch welcome: a glass card blooming above the empty dock.
 * One choice, zero clutter: bring your apps over, or start clean.
 */

import { motion } from "motion/react";
import { useState } from "react";
import { springs } from "../../engine/animation/springs";
import { importStarterApps, startEmpty } from "./firstRun";
import "./welcome.css";

export function Welcome() {
  const [busy, setBusy] = useState(false);

  const run = (action: () => Promise<void>) => {
    setBusy(true);
    action().catch((e) => {
      console.error("onboarding action failed", e);
      setBusy(false);
    });
    // success needs no cleanup: the settings event flips
    // onboardingComplete and this card unmounts
  };

  return (
    <motion.div
      className="welcome-card glass"
      style={{ position: "absolute", zIndex: 90 }}
      initial={{ opacity: 0, scale: 0.85, y: 24 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.94, filter: "blur(6px)", transition: { duration: 0.2 } }}
      transition={{ ...springs.bloom, delay: 0.25 }}
    >
      <span className="welcome-orb" aria-hidden />
      <h1>Welcome to Aero Dock</h1>
      <p>Glass, water, and light for your desktop. Let's set up your dock.</p>
      <div className="welcome-actions">
        <button className="welcome-primary" disabled={busy} onClick={() => run(importStarterApps)}>
          {busy ? "Importing…" : "Import my apps"}
        </button>
        <button className="welcome-secondary" disabled={busy} onClick={() => run(startEmpty)}>
          Start empty
        </button>
      </div>
      <p className="welcome-hint">
        Tip: drop any app or folder from Explorer onto the dock to pin it.
      </p>
    </motion.div>
  );
}
