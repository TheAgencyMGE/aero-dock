/**
 * Ambient scenes: persistent, gentle weather living in the dock's air.
 * Each is an Effect with an `enabled` switch that fades the scene out
 * so the layer can dispose it (same contract as the launch effects).
 * Counts scale with the particle-density setting; everything runs on
 * the shared capped ticker and sleeps with the rest of ambient motion.
 */

import { Container, Graphics, Sprite, Texture } from "pixi.js";
import type { Effect } from "./effects";

interface SceneBase {
  enabled: boolean;
}

/** Rain: thin streaks falling past the dock with a soft splash fade. */
export class RainScene implements Effect, SceneBase {
  readonly view = new Container();
  enabled = true;
  private drops: { g: Graphics; speed: number; len: number }[] = [];
  private w: number;
  private h: number;

  constructor(tint: number, density: number, w: number, h: number) {
    this.w = w;
    this.h = h;
    const count = Math.round(14 + density * 30);
    for (let i = 0; i < count; i++) {
      const g = new Graphics();
      const len = 10 + Math.random() * 16;
      g.moveTo(0, 0)
        .lineTo(1.5, len)
        .stroke({ color: tint, alpha: 0.28 + Math.random() * 0.25, width: 1.2 });
      g.blendMode = "add";
      g.position.set(Math.random() * w, Math.random() * h);
      this.view.addChild(g);
      this.drops.push({ g, speed: 260 + Math.random() * 220, len });
    }
  }

  update(dt: number): void {
    for (const d of this.drops) {
      d.g.y += d.speed * dt;
      d.g.x += 18 * dt; // a whisper of wind
      if (d.g.y > this.h + 10) {
        d.g.y = -d.len - Math.random() * 40;
        d.g.x = Math.random() * this.w;
      }
    }
    if (!this.enabled) this.view.alpha = Math.max(0, this.view.alpha - dt * 1.6);
  }

  done(): boolean {
    return !this.enabled && this.view.alpha <= 0;
  }
}

/** Snow: fat soft flakes swaying down. */
export class SnowScene implements Effect, SceneBase {
  readonly view = new Container();
  enabled = true;
  private flakes: { s: Sprite; speed: number; sway: number; phase: number }[] = [];
  private t = 0;
  private w: number;
  private h: number;

  constructor(texture: Texture, density: number, w: number, h: number) {
    this.w = w;
    this.h = h;
    const count = Math.round(10 + density * 26);
    for (let i = 0; i < count; i++) {
      const s = new Sprite(texture);
      s.anchor.set(0.5);
      s.tint = 0xffffff;
      s.alpha = 0.5 + Math.random() * 0.4;
      s.scale.set(0.06 + Math.random() * 0.1);
      s.position.set(Math.random() * w, Math.random() * h);
      this.view.addChild(s);
      this.flakes.push({
        s,
        speed: 22 + Math.random() * 30,
        sway: 8 + Math.random() * 14,
        phase: Math.random() * Math.PI * 2,
      });
    }
  }

  update(dt: number): void {
    this.t += dt;
    for (const f of this.flakes) {
      f.s.y += f.speed * dt;
      f.s.x += Math.sin(this.t * 0.8 + f.phase) * f.sway * dt;
      if (f.s.y > this.h + 8) {
        f.s.y = -8;
        f.s.x = Math.random() * this.w;
      }
    }
    if (!this.enabled) this.view.alpha = Math.max(0, this.view.alpha - dt * 1.6);
  }

  done(): boolean {
    return !this.enabled && this.view.alpha <= 0;
  }
}

/** Bubbles: the ocean under the glass — rising, wobbling, popping. */
export class BubblesScene implements Effect, SceneBase {
  readonly view = new Container();
  enabled = true;
  private bubbles: { g: Graphics; speed: number; sway: number; phase: number; r: number }[] = [];
  private t = 0;
  private w: number;
  private h: number;

  constructor(tint: number, density: number, w: number, h: number) {
    this.w = w;
    this.h = h;
    const count = Math.round(8 + density * 18);
    for (let i = 0; i < count; i++) {
      const r = 2.5 + Math.random() * 5;
      const g = new Graphics();
      g.circle(0, 0, r).stroke({ color: 0xffffff, alpha: 0.55, width: 1.1 });
      g.circle(-r * 0.3, -r * 0.35, r * 0.28).fill({ color: 0xffffff, alpha: 0.5 });
      g.circle(0, 0, r).fill({ color: tint, alpha: 0.1 });
      g.blendMode = "add";
      g.position.set(Math.random() * w, h + Math.random() * h);
      this.view.addChild(g);
      this.bubbles.push({
        g,
        speed: 18 + Math.random() * 26,
        sway: 6 + Math.random() * 10,
        phase: Math.random() * Math.PI * 2,
        r,
      });
    }
  }

  update(dt: number): void {
    this.t += dt;
    for (const b of this.bubbles) {
      b.g.y -= b.speed * dt;
      b.g.x += Math.sin(this.t * 1.1 + b.phase) * b.sway * dt;
      if (b.g.y < -b.r * 2) {
        b.g.y = this.h + b.r * 2;
        b.g.x = Math.random() * this.w;
      }
    }
    if (!this.enabled) this.view.alpha = Math.max(0, this.view.alpha - dt * 1.6);
  }

  done(): boolean {
    return !this.enabled && this.view.alpha <= 0;
  }
}

/** Aurora: broad ribbons of light breathing across the sky. */
export class AuroraScene implements Effect, SceneBase {
  readonly view = new Container();
  enabled = true;
  private ribbons: { s: Sprite; phase: number; drift: number }[] = [];
  private t = 0;

  constructor(texture: Texture, density: number, w: number, h: number) {
    const colors = [0x63f2c2, 0x7c6cf0, 0x4fc3dd];
    const count = 2 + Math.round(density * 2);
    for (let i = 0; i < count; i++) {
      const s = new Sprite(texture);
      s.anchor.set(0.5);
      s.blendMode = "add";
      s.tint = colors[i % colors.length];
      s.alpha = 0.16;
      s.rotation = -0.35 + i * 0.18;
      s.scale.set((w / 64) * 0.7, (h / 64) * 0.5);
      s.position.set(w * (0.25 + i * 0.25), h * 0.35);
      this.view.addChild(s);
      this.ribbons.push({ s, phase: i * 1.7, drift: 0.12 + i * 0.05 });
    }
  }

  update(dt: number): void {
    this.t += dt;
    for (const r of this.ribbons) {
      r.s.x += Math.sin(this.t * r.drift + r.phase) * 6 * dt;
      r.s.alpha = 0.1 + (Math.sin(this.t * 0.35 + r.phase) + 1) * 0.06;
      r.s.rotation += Math.sin(this.t * 0.2 + r.phase) * 0.004 * dt;
    }
    if (!this.enabled) this.view.alpha = Math.max(0, this.view.alpha - dt * 1.2);
  }

  done(): boolean {
    return !this.enabled && this.view.alpha <= 0;
  }
}
