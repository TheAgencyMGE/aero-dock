/**
 * Tiny event bus decoupling UI components from the PixiJS layer.
 * Components fire fire-and-forget visual events; the effects layer
 * (if mounted and enabled) renders them.
 */

export interface RippleEvent {
  x: number;
  y: number;
  /** window inner size at emit time — the dock window resizes for
   * flyouts, so the layer re-anchors coordinates to the dock edge */
  winW: number;
  winH: number;
}

export interface BurstEvent {
  x: number;
  y: number;
  winW: number;
  winH: number;
}

type EffectEvents = {
  ripple: RippleEvent;
  burst: BurstEvent;
};

type Handler<T> = (payload: T) => void;

const handlers: { [K in keyof EffectEvents]: Set<Handler<EffectEvents[K]>> } = {
  ripple: new Set(),
  burst: new Set(),
};

export const effectsBus = {
  emit<K extends keyof EffectEvents>(kind: K, payload: EffectEvents[K]): void {
    for (const h of handlers[kind]) h(payload);
  },
  on<K extends keyof EffectEvents>(kind: K, handler: Handler<EffectEvents[K]>): () => void {
    handlers[kind].add(handler);
    return () => handlers[kind].delete(handler);
  },
};
