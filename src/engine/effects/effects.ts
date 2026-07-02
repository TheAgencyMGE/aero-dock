/**
 * Effect implementations for the PixiJS layer. Each effect owns its
 * display objects, advances in update(dt) (dt in seconds, already
 * animation-speed scaled), and reports done() so the layer can dispose
 * it and stop the ticker when nothing is alive.
 */

import { Container, Graphics, Sprite, Texture } from "pixi.js";

/** Soft radial glow texture, generated once and shared. */
let glowTexture: Texture | null = null;

export function getGlowTexture(renderer: {
  generateTexture: (g: Graphics) => Texture;
}): Texture {
  if (glowTexture) return glowTexture;
  const g = new Graphics();
  const steps = 12;
  for (let i = steps; i >= 1; i--) {
    const r = (i / steps) * 32;
    const alpha = (1 - i / steps) ** 2 * 0.35;
    g.circle(32, 32, r).fill({ color: 0xffffff, alpha });
  }
  glowTexture = renderer.generateTexture(g);
  g.destroy();
  return glowTexture;
}

export interface Effect {
  readonly view: Container;
  update(dt: number): void;
  done(): boolean;
}

/** Water ripple: expanding rings that thin and fade. */
export class ClickRipple implements Effect {
  readonly view = new Container();
  private rings: { g: Graphics; delay: number }[] = [];
  private t = 0;
  private readonly life = 0.9;

  constructor(x: number, y: number, tint: number) {
    for (let i = 0; i < 3; i++) {
      const g = new Graphics();
      g.blendMode = "add";
      this.view.addChild(g);
      this.rings.push({ g, delay: i * 0.12 });
    }
    this.view.position.set(x, y);
    this.view.scale.y = 0.35; // rippling on a floor plane, not a wall
    for (const { g } of this.rings) g.tint = tint;
  }

  update(dt: number): void {
    this.t += dt;
    for (const { g, delay } of this.rings) {
      const lt = (this.t - delay) / this.life;
      g.clear();
      if (lt <= 0 || lt >= 1) continue;
      const radius = 6 + lt * 46;
      const alpha = (1 - lt) ** 1.6 * 0.85;
      const width = Math.max(1, 3.5 * (1 - lt));
      g.circle(0, 0, radius).stroke({ color: 0xffffff, alpha, width });
    }
  }

  done(): boolean {
    return this.t >= this.life + 0.3;
  }
}

/** Launch burst: a flash of light and a fountain of sparks. */
export class LaunchBurst implements Effect {
  readonly view = new Container();
  private sparks: { s: Sprite; vx: number; vy: number; spin: number }[] = [];
  private flash: Sprite;
  private t = 0;
  private readonly life = 0.85;

  constructor(x: number, y: number, texture: Texture, tint: number, intensity: number) {
    this.view.position.set(x, y);

    this.flash = new Sprite(texture);
    this.flash.anchor.set(0.5);
    this.flash.blendMode = "add";
    this.flash.tint = tint;
    this.view.addChild(this.flash);

    const count = Math.round(10 + intensity * 12);
    for (let i = 0; i < count; i++) {
      const s = new Sprite(texture);
      s.anchor.set(0.5);
      s.blendMode = "add";
      s.tint = i % 3 === 0 ? 0xffffff : tint;
      s.scale.set(0.12 + Math.random() * 0.2);
      const angle = Math.random() * Math.PI * 2;
      // fountain bias: mostly upward, like droplets off a splash
      const speed = 90 + Math.random() * 190;
      this.sparks.push({
        s,
        vx: Math.cos(angle) * speed * 0.8,
        vy: Math.sin(angle) * speed * 0.5 - 130,
        spin: (Math.random() - 0.5) * 3,
      });
      this.view.addChild(s);
    }
  }

  update(dt: number): void {
    this.t += dt;
    const lt = this.t / this.life;
    this.flash.alpha = Math.max(0, (1 - lt * 2.2) * 0.9);
    this.flash.scale.set(1.4 + lt * 2.4);
    for (const p of this.sparks) {
      p.vy += 420 * dt; // gravity pulls the droplets back down
      p.s.x += p.vx * dt;
      p.s.y += p.vy * dt;
      p.s.rotation += p.spin * dt;
      p.s.alpha = Math.max(0, (1 - lt) ** 1.3);
    }
  }

  done(): boolean {
    return this.t >= this.life;
  }
}

/** Ambient dust: tiny motes drifting up through the dock's light. */
export class DustField implements Effect {
  readonly view = new Container();
  private motes: {
    s: Sprite;
    baseX: number;
    speed: number;
    sway: number;
    phase: number;
    twinkle: number;
  }[] = [];
  private t = 0;
  private w: number;
  private h: number;
  /** set false to let motes finish their travel and fade the field out */
  enabled = true;

  constructor(texture: Texture, tint: number, density: number, w: number, h: number) {
    this.w = w;
    this.h = h;
    const count = Math.round(density * 26);
    for (let i = 0; i < count; i++) {
      const s = new Sprite(texture);
      s.anchor.set(0.5);
      s.blendMode = "add";
      s.tint = tint;
      const size = 0.045 + Math.random() * 0.075;
      s.scale.set(size);
      const baseX = Math.random() * w;
      s.position.set(baseX, Math.random() * h);
      this.motes.push({
        s,
        baseX,
        speed: 5 + Math.random() * 11,
        sway: 4 + Math.random() * 9,
        phase: Math.random() * Math.PI * 2,
        twinkle: 0.5 + Math.random() * 1.2,
      });
      this.view.addChild(s);
    }
  }

  resize(w: number, h: number): void {
    this.w = w;
    this.h = h;
  }

  update(dt: number): void {
    this.t += dt;
    for (const m of this.motes) {
      m.s.y -= m.speed * dt;
      if (m.s.y < -8) {
        m.s.y = this.h + 8;
        m.baseX = Math.random() * this.w;
      }
      m.s.x = m.baseX + Math.sin(this.t * 0.6 + m.phase) * m.sway;
      const tw = 0.55 + Math.sin(this.t * m.twinkle + m.phase) * 0.45;
      m.s.alpha = (this.enabled ? 0.5 : Math.max(0, this.view.alpha - dt)) * tw;
    }
    if (!this.enabled) this.view.alpha = Math.max(0, this.view.alpha - dt * 1.5);
  }

  done(): boolean {
    return !this.enabled && this.view.alpha <= 0;
  }
}
