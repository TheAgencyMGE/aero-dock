/**
 * The WebGL effects layer: one transparent PixiJS canvas over the whole
 * window, pointer-events none. Listens to the effects bus and renders
 * ripples, launch bursts, and ambient dust.
 *
 * Performance contract: the ticker runs ONLY while at least one effect
 * is alive (dust counts as alive only when density > 0), and stops when
 * the document is hidden. Idle GPU cost is zero.
 */

import { Application, Container, Ticker } from "pixi.js";
import { useEffect, useRef } from "react";
import type { DockEdge, Settings } from "../../ipc/types";
import { ClickRipple, DustField, getGlowTexture, LaunchBurst, type Effect } from "./effects";
import { effectsBus } from "./effectsBus";

/** Where the dock is glued; effect coordinates anchor there so they
 * survive the window growing/shrinking for flyouts. */
function anchorPoint(edge: DockEdge, w: number, h: number): { x: number; y: number } {
  switch (edge) {
    case "bottom":
      return { x: w / 2, y: h };
    case "top":
      return { x: w / 2, y: 0 };
    case "left":
      return { x: 0, y: h / 2 };
    case "right":
      return { x: w, y: h / 2 };
  }
}

function cssAccentAsTint(): number {
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue("--bloom-color")
    .trim();
  // --bloom-color is rgba(...); parse the rgb triple
  const m = v.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (!m) return 0xa0e1ff;
  return (Number(m[1]) << 16) | (Number(m[2]) << 8) | Number(m[3]);
}

interface EffectsLayerProps {
  settings: Settings;
}

export function EffectsLayer({ settings }: EffectsLayerProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<{
    app: Application | null;
    effects: Effect[];
    dust: DustField | null;
    root: Container | null;
    bloomRef?: number;
    speedRef?: number;
    edgeRef?: DockEdge;
    cleanup?: () => void;
  }>({ app: null, effects: [], dust: null, root: null });

  const density = settings.appearance.particleDensity;
  const bloom = settings.appearance.bloomAmount;
  const speed = settings.appearance.animationSpeed;

  // one-time Pixi init
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    const app = new Application();
    const st = stateRef.current;

    (async () => {
      await app.init({
        backgroundAlpha: 0,
        resizeTo: window,
        antialias: true,
        autoStart: false,
        preference: "webgl",
      });
      if (disposed) {
        app.destroy(true);
        return;
      }
      host.appendChild(app.canvas);
      st.app = app;

      // edge-anchored root: short-lived effects live in coordinates
      // relative to the dock's screen edge
      const root = new Container();
      app.stage.addChild(root);
      st.root = root;

      const wake = () => {
        if (!app.ticker.started && document.visibilityState === "visible") {
          app.ticker.start();
        }
      };

      app.ticker.add((ticker: Ticker) => {
        const dt = (ticker.deltaMS / 1000) * (stateRef.current.speedRef ?? 1);
        const a = anchorPoint(
          stateRef.current.edgeRef ?? "bottom",
          app.screen.width,
          app.screen.height,
        );
        root.position.set(a.x, a.y);
        const alive: Effect[] = [];
        for (const fx of st.effects) {
          fx.update(dt);
          if (fx.done()) {
            fx.view.destroy({ children: true });
            if (fx === st.dust) st.dust = null;
          } else {
            alive.push(fx);
          }
        }
        st.effects = alive;
        app.renderer.render(app.stage);
        if (alive.length === 0) app.ticker.stop(); // sleep until next event
      });

      /** convert emit-time window coords to edge-anchored coords */
      const toAnchored = (x: number, y: number, winW: number, winH: number) => {
        const a = anchorPoint(stateRef.current.edgeRef ?? "bottom", winW, winH);
        return { x: x - a.x, y: y - a.y };
      };

      const spawn = (fx: Effect) => {
        st.effects.push(fx);
        root.addChild(fx.view);
        wake();
      };

      const offRipple = effectsBus.on("ripple", ({ x, y, winW, winH }) => {
        const p = toAnchored(x, y, winW, winH);
        spawn(new ClickRipple(p.x, p.y, cssAccentAsTint()));
      });
      const offBurst = effectsBus.on("burst", ({ x, y, winW, winH }) => {
        const p = toAnchored(x, y, winW, winH);
        const tex = getGlowTexture(app.renderer);
        spawn(new LaunchBurst(p.x, p.y, tex, cssAccentAsTint(), stateRef.current.bloomRef ?? 0.7));
      });
      const onVis = () => {
        if (document.visibilityState === "hidden") app.ticker.stop();
        else if (st.effects.length > 0) app.ticker.start();
      };
      document.addEventListener("visibilitychange", onVis);

      st.cleanup = () => {
        offRipple();
        offBurst();
        document.removeEventListener("visibilitychange", onVis);
      };
    })().catch((e) => console.error("effects init failed", e));

    return () => {
      disposed = true;
      st.cleanup?.();
      st.effects = [];
      st.dust = null;
      if (st.app) {
        st.app.destroy(true);
        st.app = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // dust field tracks density setting
  useEffect(() => {
    const st = stateRef.current;
    const app = st.app;
    if (!app) return;
    // density changed: fade the old field out and (below) grow a new one
    if (st.dust && density > 0) {
      st.dust.enabled = false;
      st.dust = null;
    }
    if (density > 0 && !st.dust) {
      const dust = new DustField(
        getGlowTexture(app.renderer),
        cssAccentAsTint(),
        density,
        window.innerWidth,
        window.innerHeight,
      );
      st.dust = dust;
      st.effects.push(dust);
      app.stage.addChild(dust.view);
      if (!app.ticker.started && document.visibilityState === "visible") app.ticker.start();
    } else if (density === 0 && st.dust) {
      st.dust.enabled = false; // fades out, then ticker sleeps
    }
  }, [density, settings.appearance.theme]);

  // live tuning refs (avoid re-init on slider moves)
  stateRef.current.bloomRef = bloom;
  stateRef.current.speedRef = speed;
  stateRef.current.edgeRef = settings.dock.edge;

  return (
    <div
      ref={hostRef}
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        zIndex: 50,
      }}
    />
  );
}
