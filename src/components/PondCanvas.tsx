import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { loadAssets } from "../pond/assets";
import { PondEngine } from "../pond/engine";

export interface PondHandle {
  reset(): void;
  /** Turn the water sounds on or off. */
  setSound(on: boolean): void;
}

declare global {
  interface Window {
    __pond?: PondEngine;
  }
}

function webglAvailable() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

export const PondCanvas = forwardRef<PondHandle>(function PondCanvas(_props, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<PondEngine | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "unsupported" | "error">("loading");

  useImperativeHandle(
    ref,
    () => ({
      reset: () => engineRef.current?.reset(),
      setSound: (on: boolean) => engineRef.current?.audio.setEnabled(on),
    }),
    [],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!webglAvailable()) {
      setState("unsupported");
      return;
    }

    let cancelled = false;
    let engine: PondEngine | null = null;
    const params = new URLSearchParams(window.location.search);
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

    loadAssets(8)
      .then((assets) => {
        if (cancelled) return;
        engine = new PondEngine(canvas, assets, {
          reducedMotion: motionQuery.matches,
          still: params.has("still"),
          solo: params.has("solo"),
          debug: params.has("debug"),
        });
        engineRef.current = engine;
        if (params.has("debug")) window.__pond = engine;
        engine.start();
        setState("ready");
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) setState("error");
      });

    return () => {
      cancelled = true;
      engine?.dispose();
      engineRef.current = null;
      if (window.__pond === engine) delete window.__pond;
    };
  }, []);

  return (
    <>
      <canvas
        ref={canvasRef}
        className={`pond-canvas${state === "ready" ? " is-ready" : ""}`}
        tabIndex={0}
        role="img"
        aria-label="A watercolor koi pond with koi, lily pads and lotus flowers. Tap the water to add something new."
      />
      {state === "unsupported" && <p className="notice">This pond needs WebGL, which isn't available in this browser.</p>}
      {state === "error" && <p className="notice">The pond could not be painted. Please reload the page.</p>}
    </>
  );
});
