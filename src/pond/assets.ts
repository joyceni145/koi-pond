import * as THREE from "three";

export interface KoiAsset {
  name: string;
  texture: THREE.Texture;
  width: number;
  height: number;
  /** Pixel x of the head tip / tail tip in the painting (head faces +x). */
  xHead: number;
  xTail: number;
  /** Spine y (px) and body half-width (px) sampled at 64 stations, head -> tail. */
  spine: number[];
  halfWidth: number[];
}

export interface SpriteAsset {
  texture: THREE.Texture;
  width: number;
  height: number;
  visibleWidth: number;
  visibleHeight: number;
}

export interface Assets {
  water: THREE.Texture;
  koi: Record<string, KoiAsset>;
  pads: SpriteAsset[];
  lotus: SpriteAsset[];
}

interface Manifest {
  koi: Record<string, { file: string; width: number; height: number; xHead: number; xTail: number; spine: number[]; halfWidth: number[] }>;
  pads: SpriteManifestEntry[];
  lotus: SpriteManifestEntry[];
}
interface SpriteManifestEntry {
  file: string;
  width: number;
  height: number;
  visibleWidth: number;
  visibleHeight: number;
}

const base = import.meta.env.BASE_URL;
export const assetUrl = (path: string) => `${base}assets/${path}`;

export async function loadManifest(): Promise<Manifest> {
  const res = await fetch(assetUrl("manifest.json"));
  if (!res.ok) throw new Error(`Could not load asset manifest (${res.status})`);
  return res.json();
}

export async function loadAssets(maxAnisotropy: number): Promise<Assets> {
  const loader = new THREE.TextureLoader();
  const load = async (path: string, opts: { mirror?: boolean } = {}) => {
    const tex = await loader.loadAsync(assetUrl(path));
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = Math.min(8, maxAnisotropy);
    if (opts.mirror) {
      tex.wrapS = tex.wrapT = THREE.MirroredRepeatWrapping;
    }
    return tex;
  };

  const manifest = await loadManifest();

  const koiEntries = await Promise.all(
    Object.entries(manifest.koi).map(async ([name, m]) => {
      const texture = await load(m.file);
      const asset: KoiAsset = {
        name,
        texture,
        width: m.width,
        height: m.height,
        xHead: m.xHead,
        xTail: m.xTail,
        spine: m.spine,
        halfWidth: m.halfWidth,
      };
      return [name, asset] as const;
    }),
  );

  const sprites = (list: SpriteManifestEntry[]) =>
    Promise.all(
      list.map(async (m): Promise<SpriteAsset> => ({
        texture: await load(m.file),
        width: m.width,
        height: m.height,
        visibleWidth: m.visibleWidth,
        visibleHeight: m.visibleHeight,
      })),
    );

  const [water, pads, lotus] = await Promise.all([
    load("water/water.jpg", { mirror: true }),
    sprites(manifest.pads),
    sprites(manifest.lotus),
  ]);

  return { water, koi: Object.fromEntries(koiEntries), pads, lotus };
}
