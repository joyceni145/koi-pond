import { useRef } from "react";
import { PondCanvas, type PondHandle } from "./components/PondCanvas";
import { Reeds } from "./components/Reeds";

export function App() {
  const pond = useRef<PondHandle>(null);

  return (
    <main className="page">
      <div className="stage">
        <PondCanvas ref={pond} />
        <Reeds />
      </div>
      <footer className="caption">
        <p>Tap the water to bring your pond to life.</p>
        <button type="button" className="reset" onClick={() => pond.current?.reset()}>
          Reset pond
        </button>
      </footer>
    </main>
  );
}
