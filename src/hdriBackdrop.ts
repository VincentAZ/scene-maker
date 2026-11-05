import * as T from "three";
import { GroundedSkybox } from "three/addons/objects/GroundedSkybox.js";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
import type { Asset } from "../shared/scene";

/** A photographic set's projection parameters (shared/scene.ts `backdrop`). */
export type Backdrop = NonNullable<Asset["backdrop"]>;

/** What a photographed panorama says about its light. */
export type PhotoLight = {
  /** Unit direction toward the sun (or a dominant lamp), in panorama space. */
  sun: T.Vector3 | null;
  /** The sun's irradiance on a surface facing it; a DirectionalLight intensity. */
  sunIntensity: number;
  sunColor: T.Color;
  /** Darkness of a cast shadow on the floor (ShadowMaterial opacity). */
  shadowOpacity: number;
  /** Direction used for the shadow-casting key light when there is no sun. */
  key: T.Vector3;
};

const luminance = (r: number, g: number, b: number) =>
  0.2126 * r + 0.7152 * g + 0.0722 * b;

/** Direction of an equirectangular texel, matching three.js `equirectUv`
 * for a texture with flipY (row 0 is the top of the panorama). */
export function texelDirection(
  column: number,
  row: number,
  width: number,
  height: number,
  target = new T.Vector3(),
) {
  const phi = ((column + 0.5) / width - 0.5) * 2 * Math.PI;
  const elevation = (0.5 - (row + 0.5) / height) * Math.PI;
  return target.set(
    Math.cos(phi) * Math.cos(elevation),
    Math.sin(elevation),
    Math.sin(phi) * Math.cos(elevation),
  );
}

/**
 * Finds the sun in linear RGBA panorama data and removes it, so image-based
 * lighting keeps the sky and surroundings while a DirectionalLight carries the
 * sun with crisp shadows (otherwise the sun would light the cast twice).
 * A "sun" is a compact source holding at least a fifth of the light on the
 * floor; overcast skies and evenly lit rooms have none and keep all their
 * light in the environment, with a soft key light only for contact shadows.
 */
export function extractSun(
  data: Float32Array,
  width: number,
  height: number,
): PhotoLight {
  const cell = ((2 * Math.PI) / width) * (Math.PI / height);
  const direction = new T.Vector3();
  const upper: number[] = [];
  let groundIrradiance = 0;
  let peak = -1;
  let peakIndex = 0;
  for (let row = 0; row < height; row++) {
    const elevation = (0.5 - (row + 0.5) / height) * Math.PI;
    const solidAngle = cell * Math.cos(elevation);
    for (let column = 0; column < width; column++) {
      const i = (row * width + column) * 4;
      const l = luminance(data[i], data[i + 1], data[i + 2]);
      if (elevation <= 0) continue;
      upper.push(l);
      groundIrradiance += l * Math.sin(elevation) * solidAngle;
      if (l > peak) {
        peak = l;
        peakIndex = row * width + column;
      }
    }
  }
  upper.sort((a, b) => a - b);
  const median = upper[upper.length >> 1] ?? 0;
  const peakRow = Math.floor(peakIndex / width);
  const peakDirection = texelDirection(
    peakIndex % width,
    peakRow,
    width,
    height,
  );
  // Light the key from the brightest part of the sky, but steeply enough that
  // its shadow stays a short contact shadow under the feet.
  const key = new T.Vector3(peakDirection.x, 0, peakDirection.z);
  if (key.lengthSq() < 1e-6) key.set(0, 0, 1);
  key.normalize().multiplyScalar(Math.cos(1.1)).setY(Math.sin(1.1));
  const none: PhotoLight = {
    sun: null,
    sunIntensity: 0,
    sunColor: new T.Color(1, 1, 1),
    shadowOpacity: 0.32,
    key,
  };
  // Everything above this level within 8° of the peak belongs to the sun disc
  // and its glare; the sky around it keeps that level.
  const clamp = Math.max(median * 8, peak * 0.002);
  if (!(peak > clamp) || groundIrradiance <= 0) return none;
  const reach = Math.cos(T.MathUtils.degToRad(8));
  let energy = 0;
  const color = [0, 0, 0];
  const sunDirection = new T.Vector3();
  const touched: number[] = [];
  const rowSpan = Math.ceil((8 / 180) * height) + 1;
  for (
    let row = Math.max(0, peakRow - rowSpan);
    row <= Math.min(height - 1, peakRow + rowSpan);
    row++
  ) {
    const elevation = (0.5 - (row + 0.5) / height) * Math.PI;
    const solidAngle = cell * Math.cos(elevation);
    for (let column = 0; column < width; column++) {
      const i = (row * width + column) * 4;
      const l = luminance(data[i], data[i + 1], data[i + 2]);
      if (l <= clamp) continue;
      texelDirection(column, row, width, height, direction);
      if (direction.dot(peakDirection) < reach) continue;
      const excess = (l - clamp) * solidAngle;
      energy += excess;
      sunDirection.addScaledVector(direction, excess);
      for (let c = 0; c < 3; c++) color[c] += (data[i + c] / l) * excess;
      touched.push(i);
    }
  }
  sunDirection.normalize();
  const onFloor = energy * Math.max(0, sunDirection.y);
  if (energy <= 0 || onFloor < groundIrradiance * 0.2) return none;
  for (const i of touched) {
    const l = luminance(data[i], data[i + 1], data[i + 2]);
    const scale = clamp / l;
    data[i] *= scale;
    data[i + 1] *= scale;
    data[i + 2] *= scale;
  }
  const sunColor = new T.Color(color[0], color[1], color[2]);
  const strongest = Math.max(sunColor.r, sunColor.g, sunColor.b);
  sunColor.multiplyScalar(1 / strongest);
  return {
    sun: sunDirection,
    sunIntensity: energy * strongest,
    sunColor,
    // A shadowed floor keeps only the sky's light: that ratio is its darkness.
    shadowOpacity: T.MathUtils.clamp(onFloor / groundIrradiance, 0.2, 0.85),
    key: sunDirection.clone(),
  };
}

// three.js ACESFilmicToneMapping, including its 1/0.6 exposure scale.
function aces(r: number, g: number, b: number, exposure: number) {
  const s = exposure / 0.6;
  r *= s;
  g *= s;
  b *= s;
  const i = [
    0.59719 * r + 0.35458 * g + 0.04823 * b,
    0.076 * r + 0.90834 * g + 0.01566 * b,
    0.0284 * r + 0.13383 * g + 0.83777 * b,
  ].map(
    (v) =>
      (v * (v + 0.0245786) - 0.000090537) /
      (v * (0.983729 * v + 0.432951) + 0.238081),
  );
  const o = [
    1.60475 * i[0] - 0.53108 * i[1] - 0.07367 * i[2],
    -0.10208 * i[0] + 1.10813 * i[1] - 0.00605 * i[2],
    -0.00327 * i[0] - 0.07276 * i[1] + 1.07602 * i[2],
  ].map((v) => T.MathUtils.clamp(v, 0, 1));
  return o as [number, number, number];
}
const srgb = (v: number) =>
  v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;

/**
 * The renderer exposure at which the HDR, through the studio's ACES tone
 * mapping, is as bright as the photographer's tonemapped panorama that is
 * shown behind the cast. Compares the median display brightness of matching
 * samples, so a character standing in the photo is lit as brightly as the
 * surfaces around it.
 * `hdr` is linear RGBA, `photo` sRGB RGBA (0–255), both equirectangular.
 */
export function matchExposure(
  hdr: { data: ArrayLike<number>; width: number; height: number },
  photo: { data: ArrayLike<number>; width: number; height: number },
  samples = 96,
) {
  const points: [number, number, number, number][] = [];
  for (let y = 0; y < samples / 2; y++)
    for (let x = 0; x < samples; x++) {
      const u = (x + 0.5) / samples,
        v = (y + 0.5) / (samples / 2);
      const h =
        (Math.floor(v * hdr.height) * hdr.width + Math.floor(u * hdr.width)) *
        4;
      const p =
        (Math.floor(v * photo.height) * photo.width +
          Math.floor(u * photo.width)) *
        4;
      points.push([
        hdr.data[h],
        hdr.data[h + 1],
        hdr.data[h + 2],
        luminance(photo.data[p], photo.data[p + 1], photo.data[p + 2]) / 255,
      ]);
    }
  const median = (values: number[]) =>
    values.sort((a, b) => a - b)[values.length >> 1];
  const target = median(points.map((p) => p[3]));
  const shown = (exposure: number) =>
    median(
      points.map(([r, g, b]) => {
        const [x, y, z] = aces(r, g, b, exposure);
        return luminance(srgb(x), srgb(y), srgb(z));
      }),
    );
  let low = Math.log(0.01),
    high = Math.log(100);
  for (let step = 0; step < 40; step++) {
    const mid = (low + high) / 2;
    if (shown(Math.exp(mid)) < target) low = mid;
    else high = mid;
  }
  return Math.exp((low + high) / 2);
}

/**
 * Where the photographer stood, in studio coordinates. The cast is placed
 * around the origin, so the photo is taken a few meters behind it, on +Z: the
 * home view is then the photographer's own viewpoint, where every wall, table
 * and tree in the panorama is in exact perspective, and the cast stands on
 * photographed floor in front of the lens. (A ground projection is exact only
 * for the floor; everything standing on it is painted on a dome and smears
 * when seen from elsewhere.)
 */
export const backdropCenter = (backdrop: Backdrop) =>
  new T.Vector3(0, 0, T.MathUtils.clamp(backdrop.radius * 0.5, 3, 4.5));

/** The studio's orbit never goes below the floor: the viewport's polar limit. */
export const ORBIT_MAX_POLAR = Math.PI * 0.49;

/**
 * How far the camera may move from where the photo was taken. Every limit is
 * expressed so that the orbit controls can enforce it themselves, in their own
 * spherical terms (distance, azimuth, polar angle) around the cast. A clamp on
 * the camera's position in metres would fight them: orbit controls read the
 * clamped position back as a shorter distance, so each orbit that touched a
 * wall or the ceiling became a dolly, and the orbit's damping kept dollying
 * for a second after the mouse was released — the set appeared to zoom in on
 * its own.
 */
export function backdropLimits(backdrop: Backdrop) {
  const center = backdropCenter(backdrop);
  /** Horizontal distance from the photographer's position. Beyond ~8 m the
   * photographed ground nearest the camera is too coarse (cm per pixel grows
   * with the square of the distance). */
  const reach = T.MathUtils.clamp(backdrop.radius * 0.6, 3, 8);
  const target = new T.Vector3(0, 0.85, 0);
  /** Orbit no further round the cast than this, either way (radians): the far
   * side would look back at where the photographer stood, and in a small room
   * nearby walls and furniture bend sooner. */
  const azimuth = T.MathUtils.degToRad(
    T.MathUtils.clamp(backdrop.radius * 4, 30, 50),
  );
  /** Look down on the cast by at most ~18°, like a standing camera. */
  const minPolar = 1.25;
  // The farthest the camera can orbit, at any allowed angle, and still stand
  // within reach of the photographer's spot: measured along the widest orbit
  // (±azimuth) at the lowest eye, where the horizontal distance is greatest.
  const depth = center.z - target.z;
  const widest =
    depth * Math.cos(azimuth) +
    Math.sqrt(Math.max(0, reach ** 2 - (depth * Math.sin(azimuth)) ** 2));
  const maxDistance = Math.min(
    25,
    reach + center.length(),
    (widest - 0.01) / Math.sin(ORBIT_MAX_POLAR),
  );
  return {
    center,
    reach,
    target,
    azimuth,
    minPolar,
    maxDistance,
    /** As high as the steepest allowed look-down reaches at full distance;
     * never a bird's-eye view, which the polar limit already rules out. */
    ceiling: target.y + maxDistance * Math.cos(minPolar) + 0.05,
    floor: 0.15,
  };
}

/** The studio's home view in a photographic set: the photographer's own
 * viewpoint, looking toward the cast at the origin (−Z). */
export function backdropHome(backdrop: Backdrop) {
  const { center, target, azimuth, minPolar, maxDistance } =
    backdropLimits(backdrop);
  return {
    position: new T.Vector3(center.x, backdrop.height, center.z),
    target,
    maxDistance,
    azimuth,
    minPolar,
  };
}

/** Keeps a camera where the photographed set still looks right. With the
 * orbit limits from `backdropHome` applied this never has to move an orbiting
 * camera; it is the safety net for a camera placed by other means. */
export function keepInsideBackdrop(position: T.Vector3, backdrop: Backdrop) {
  const { center, reach, ceiling, floor } = backdropLimits(backdrop);
  let moved = false;
  const dx = position.x - center.x,
    dz = position.z - center.z;
  const horizontal = Math.hypot(dx, dz);
  if (horizontal > reach) {
    position.x = center.x + (dx * reach) / horizontal;
    position.z = center.z + (dz * reach) / horizontal;
    moved = true;
  }
  const y = T.MathUtils.clamp(position.y, floor, ceiling);
  if (y !== position.y) {
    position.y = y;
    moved = true;
  }
  return moved;
}

/** A loaded photographic set: the visible projection, its shadow catcher, the
 * prefiltered lighting and the measured sun. */
export class PhotoSet {
  constructor(
    /** World-space visuals (not scene content: no collisions, no export). */
    readonly group: T.Group,
    readonly environment: T.Texture,
    readonly light: PhotoLight,
    readonly exposure: number,
    readonly backdrop: Backdrop,
  ) {}

  /** The sun's or key light's world direction after the set's yaw. */
  keyDirection() {
    return this.light.key
      .clone()
      .applyAxisAngle(
        new T.Vector3(0, 1, 0),
        T.MathUtils.degToRad(this.backdrop.rotation),
      );
  }

  dispose() {
    this.group.traverse((node) => {
      if (node instanceof T.Mesh) {
        node.geometry.dispose();
        const material = node.material as T.MeshBasicMaterial;
        material.map?.dispose();
        material.dispose();
      }
    });
    this.environment.dispose();
  }
}

async function loadImage(url: string) {
  const image = new Image();
  image.decoding = "async";
  image.src = url;
  await image.decode();
  return image;
}

/** Loads a photographic set for a renderer (browser only). */
export async function loadPhotoSet(
  asset: Asset,
  renderer: T.WebGLRenderer,
): Promise<PhotoSet> {
  const backdrop = asset.backdrop;
  if (!asset.hdri || !backdrop)
    throw Error("This set is missing its photograph.");
  const [hdr, image] = await Promise.all([
    new HDRLoader().setDataType(T.FloatType).loadAsync(asset.hdri),
    loadImage(backdrop.image),
  ]);
  const { width, height } = hdr.image as { width: number; height: number };
  const data = hdr.image.data as Float32Array;
  // Exposure is matched on the full HDR, before the sun is moved to a light.
  const small = document.createElement("canvas");
  small.width = 256;
  small.height = 128;
  const drawing = small.getContext("2d", { willReadFrequently: true })!;
  drawing.drawImage(image, 0, 0, small.width, small.height);
  const exposure = matchExposure(
    { data, width, height },
    {
      data: drawing.getImageData(0, 0, small.width, small.height).data,
      width: small.width,
      height: small.height,
    },
  );
  const light = extractSun(data, width, height);
  // Hand three.js the equirectangular map rather than a prefiltered one: each
  // renderer (the viewport, and the separate recording renderer) prefilters
  // it in its own WebGL context. Half floats filter linearly everywhere.
  const half = new Uint16Array(data.length);
  for (let i = 0; i < data.length; i++)
    half[i] = T.DataUtils.toHalfFloat(data[i]);
  hdr.image.data = half;
  hdr.type = T.HalfFloatType;
  hdr.mapping = T.EquirectangularReflectionMapping;
  hdr.needsUpdate = true;
  const environment = hdr;

  const map = new T.Texture(image);
  map.colorSpace = T.SRGBColorSpace;
  map.anisotropy = renderer.capabilities.getMaxAnisotropy();
  map.needsUpdate = true;
  const group = new T.Group();
  group.name = "SceneMakerBackdrop";
  group.userData.film = true;
  const yaw = T.MathUtils.degToRad(backdrop.rotation);
  const sky = new GroundedSkybox(map, backdrop.height, backdrop.radius, 256);
  const skyMaterial = sky.material as T.MeshBasicMaterial;
  // The panorama is already tonemapped by its photographer; show it as is.
  skyMaterial.toneMapped = false;
  skyMaterial.fog = false;
  const center = backdropCenter(backdrop);
  sky.position.set(center.x, backdrop.height, center.z);
  sky.rotation.y = yaw;
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  group.add(sky);
  // Shadows land on the photographed floor through a transparent catcher.
  const catcher = new T.Mesh(
    new T.PlaneGeometry(backdrop.radius * 2, backdrop.radius * 2),
    new T.ShadowMaterial({ opacity: light.shadowOpacity }),
  );
  catcher.rotation.x = -Math.PI / 2;
  catcher.position.set(center.x, 0.002, center.z);
  catcher.receiveShadow = true;
  group.add(catcher);
  return new PhotoSet(group, environment, light, exposure, backdrop);
}

/**
 * The studio's light for the current set. A built-in stage uses the lighting
 * preset (golden/daylight/moonlight). A photographic set is lit by its own
 * photo: its HDR lights the cast, the key light follows the photographed sun
 * for shadows, and exposure matches the panorama. The presets would contradict
 * the photo, so they do not apply there.
 */
export function applyStageLighting(
  world: T.Scene,
  renderer: T.WebGLRenderer,
  lighting: "golden" | "daylight" | "moonlight",
  photo: PhotoSet | null,
) {
  const sun = world.children.find(
    (o) => o instanceof T.DirectionalLight,
  ) as T.DirectionalLight;
  const sky = world.children.find(
    (o) => o instanceof T.HemisphereLight,
  ) as T.HemisphereLight;
  if (photo) {
    const yaw = T.MathUtils.degToRad(photo.backdrop.rotation);
    world.background = new T.Color("#202020");
    world.fog = null;
    world.environment = photo.environment;
    world.environmentRotation.set(0, yaw, 0);
    sky.intensity = 0;
    sun.position.copy(photo.keyDirection().multiplyScalar(15));
    sun.color.copy(photo.light.sunColor);
    // Without a sun the key light only casts the soft contact shadow; its
    // light is already in the environment.
    sun.intensity = photo.light.sun ? photo.light.sunIntensity : 0.0001;
    renderer.toneMappingExposure = photo.exposure;
    return;
  }
  const color =
    lighting === "moonlight"
      ? "#8c9eae"
      : lighting === "daylight"
        ? "#dce1dc"
        : "#d8d4c7";
  world.background = new T.Color(color);
  world.fog = new T.Fog(color, 19, 38);
  world.environment = null;
  sky.intensity = 2.4;
  sun.position.set(-3, 8, 4);
  sun.color.set(
    lighting === "moonlight"
      ? "#a6c5ef"
      : lighting === "daylight"
        ? "#ffffff"
        : "#fff0ce",
  );
  sun.intensity = lighting === "moonlight" ? 1.2 : 4;
  renderer.toneMappingExposure = 1;
}
