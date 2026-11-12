import { useRef, useState } from "react";
import { PondCanvas, type PondHandle } from "./components/PondCanvas";
import { readStoredSound } from "./pond/audio";

export function App() {
  const pond = useRef<PondHandle>(null);
  const [sound, setSound] = useState(readStoredSound);

  const toggleSound = () => {
    const next = !sound;
    setSound(next);
    pond.current?.setSound(next);
  };

  return (
    <main className="page">
      <PondCanvas ref={pond} />
      <footer className="caption">
        <p>Tap the water to bring your pond to life.</p>
        <div className="actions">
          <button type="button" className="reset" onClick={() => pond.current?.reset()}>
            Reset pond
          </button>
          <button
            type="button"
            className="reset sound"
            aria-pressed={sound}
            aria-label={sound ? "Sound on. Turn water sounds off" : "Sound off. Turn water sounds on"}
            onClick={toggleSound}
          >
            <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 9.5v5h3.6L12 18.5v-13L7.6 9.5H4z" fill="currentColor" stroke="none" />
              {sound ? (
                <>
                  <path d="M15.2 9.2a4 4 0 0 1 0 5.6" />
                  <path d="M17.6 6.8a7.4 7.4 0 0 1 0 10.4" />
                </>
              ) : (
                <path d="M16 9.5l5 5M21 9.5l-5 5" />
              )}
            </svg>
          </button>
        </div>
      </footer>
    </main>
  );
}
