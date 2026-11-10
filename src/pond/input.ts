import type { PondEngine } from "./engine";

interface Track {
  id: number;
  type: string;
  startX: number;
  startY: number;
  startT: number;
  lastX: number;
  lastY: number;
  lastT: number;
  dragged: boolean;
  pressed: boolean;
}

/** Pointer travel (CSS px) after which a press becomes a drag rather than a tap. */
const SLOP = { touch: 10, pen: 8, mouse: 6 } as const;
const TAP_MAX_MS = 550;

/**
 * Wires pointer input to the pond:
 *  - moving over the water (mouse hover) or dragging (touch / pen / pressed mouse) stirs it;
 *  - a press-and-release that barely moves and is quick is a tap and adds one item.
 */
export function attachPointerInput(canvas: HTMLCanvasElement, engine: PondEngine): () => void {
  const tracks = new Map<number, Track>();

  const slopFor = (type: string) => (type === "touch" ? SLOP.touch : type === "pen" ? SLOP.pen : SLOP.mouse);

  const onDown = (e: PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* some browsers refuse capture for synthetic events */
    }
    tracks.set(e.pointerId, {
      id: e.pointerId,
      type: e.pointerType,
      startX: e.clientX,
      startY: e.clientY,
      startT: e.timeStamp,
      lastX: e.clientX,
      lastY: e.clientY,
      lastT: e.timeStamp,
      dragged: false,
      pressed: true,
    });
  };

  const onMove = (e: PointerEvent) => {
    let tr = tracks.get(e.pointerId);
    const hovering = e.pointerType === "mouse" && !tr;
    if (!tr && !hovering) return;
    if (!tr) {
      // mouse hover: keep a lightweight, unpressed track
      tr = {
        id: e.pointerId,
        type: e.pointerType,
        startX: e.clientX,
        startY: e.clientY,
        startT: e.timeStamp,
        lastX: e.clientX,
        lastY: e.clientY,
        lastT: e.timeStamp,
        dragged: false,
        pressed: false,
      };
      tracks.set(e.pointerId, tr);
    }
    const events = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
    const list = events.length ? events : [e];
    for (const ev of list) {
      const dt = (ev.timeStamp - tr.lastT) / 1000;
      const dx = ev.clientX - tr.lastX;
      const dy = ev.clientY - tr.lastY;
      if (tr.pressed && !tr.dragged && Math.hypot(ev.clientX - tr.startX, ev.clientY - tr.startY) > slopFor(tr.type)) {
        tr.dragged = true;
      }
      if (dt > 0 && dt < 0.15 && (dx !== 0 || dy !== 0)) {
        const a = engine.clientToWorld(tr.lastX, tr.lastY);
        const b = engine.clientToWorld(ev.clientX, ev.clientY);
        engine.stirSegment(a.x, a.y, b.x, b.y, dt);
      }
      tr.lastX = ev.clientX;
      tr.lastY = ev.clientY;
      tr.lastT = ev.timeStamp;
    }
  };

  const onUp = (e: PointerEvent) => {
    const tr = tracks.get(e.pointerId);
    if (!tr) return;
    const wasPressed = tr.pressed;
    tracks.delete(e.pointerId);
    if (canvas.hasPointerCapture?.(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    if (!wasPressed) return;
    const moved = Math.hypot(e.clientX - tr.startX, e.clientY - tr.startY);
    const quick = e.timeStamp - tr.startT <= TAP_MAX_MS;
    if (!tr.dragged && moved <= slopFor(tr.type) && quick) {
      const p = engine.clientToWorld(tr.startX, tr.startY);
      if (engine.isWater(p.x, p.y)) engine.tap(p.x, p.y);
    }
  };

  const onCancel = (e: PointerEvent) => {
    tracks.delete(e.pointerId);
  };

  const onLeave = (e: PointerEvent) => {
    const tr = tracks.get(e.pointerId);
    if (tr && !tr.pressed) tracks.delete(e.pointerId);
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    engine.tapRandom();
  };

  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onCancel);
  canvas.addEventListener("pointerleave", onLeave);
  canvas.addEventListener("keydown", onKey);
  const prevent = (e: Event) => e.preventDefault();
  canvas.addEventListener("contextmenu", prevent);

  return () => {
    canvas.removeEventListener("pointerdown", onDown);
    canvas.removeEventListener("pointermove", onMove);
    canvas.removeEventListener("pointerup", onUp);
    canvas.removeEventListener("pointercancel", onCancel);
    canvas.removeEventListener("pointerleave", onLeave);
    canvas.removeEventListener("keydown", onKey);
    canvas.removeEventListener("contextmenu", prevent);
  };
}
