import type { CSSProperties } from "react";
import { assetUrl } from "../pond/assets";

interface Reed {
  /** Base position of the clump as % of the stage. */
  x: number;
  y: number;
  /** Width as % of the stage. */
  w: number;
  img: number;
  flip?: boolean;
}

/** A few hand-placed clumps of painted reeds around the pond's edge, like the composition reference. */
const REEDS: Reed[] = [
  { x: 17.5, y: 13.4, w: 4.1, img: 0 },
  { x: 22.4, y: 12.2, w: 2.9, img: 3, flip: true },
  { x: 36.5, y: 12.4, w: 2.3, img: 1 },
  { x: 58.5, y: 11.8, w: 2.1, img: 2, flip: true },
  { x: 80.6, y: 12.9, w: 3.2, img: 1, flip: true },
  { x: 85.4, y: 12.0, w: 3.5, img: 0 },
  { x: 7.4, y: 62, w: 3.6, img: 2 },
  { x: 8.8, y: 54, w: 2.5, img: 3, flip: true },
  { x: 16.5, y: 91, w: 3.2, img: 1, flip: true },
  { x: 21.2, y: 92, w: 2.3, img: 0 },
  { x: 37, y: 92.2, w: 2, img: 2 },
  { x: 69, y: 92.4, w: 2.2, img: 1 },
  { x: 77.5, y: 91.2, w: 3.1, img: 3 },
  { x: 82.5, y: 89.8, w: 2.5, img: 2, flip: true },
  { x: 92.4, y: 77, w: 3, img: 0, flip: true },
];

export function Reeds() {
  return (
    <div className="reeds" aria-hidden="true">
      {REEDS.map((r, i) => {
        const style = {
          left: `${r.x}%`,
          top: `${r.y}%`,
          width: `${r.w * 1.45}%`,
          "--dur": `${7.5 + ((i * 1.7) % 5)}s`,
          "--delay": `${-((i * 2.3) % 7)}s`,
          "--amp": `${1.0 + ((i * 0.37) % 0.9)}deg`,
        } as CSSProperties;
        return (
          <div className="reed" style={style} key={i}>
            <img
              src={assetUrl(`reeds/reeds-${r.img}.png`)}
              alt=""
              draggable={false}
              style={r.flip ? { transform: "scaleX(-1)" } : undefined}
            />
          </div>
        );
      })}
    </div>
  );
}
