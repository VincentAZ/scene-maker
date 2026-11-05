import * as T from "three";
import { PhotoSet, texelDirection } from "./hdriBackdrop";
import { fitSunShadow, floorIrradiance, ModelSet } from "./modelSet";

/** What the viewport shows around the cast: a photographic set, a real 3D
 * set, or the plain studio stage (null). */
export type StageView = PhotoSet | ModelSet | null;

const presetColor = (lighting: "golden" | "daylight" | "moonlight") =>
  lighting === "moonlight"
    ? "#8c9eae"
    : lighting === "daylight"
      ? "#dce1dc"
      : "#d8d4c7";
const presetSun = new T.Vector3(-3, 8, 4);
const presetSunColor = (lighting: "golden" | "daylight" | "moonlight") =>
  lighting === "moonlight"
    ? "#a6c5ef"
    : lighting === "daylight"
      ? "#ffffff"
      : "#fff0ce";

/** The studio's fill: its hemisphere light's intensity and colours
 * (Viewport.tsx). */
const FILL = 2.4;
const fillSky = new T.Color("#fff4da"),
  fillGround = new T.Color("#747e69");
const luminance = (color: T.Color) =>
  0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;

let surround: T.DataTexture | undefined;
/**
 * A soft studio surround for a 3D set without its own HDR, so metal, glass
 * and mirrors have something to reflect instead of turning black: the
 * studio's fill (a warm sky over a green-grey ground) with two broad
 * softboxes in front of the cast. It lights a level floor as the studio's
 * hemisphere fill does, which it replaces. It is equirectangular, so each
 * renderer (the viewport and the recording one) prefilters it itself.
 */
export function studioSurround() {
  if (surround) return surround;
  const width = 128,
    height = 64;
  const data = new Float32Array(width * height * 4);
  const direction = new T.Vector3();
  const softboxes = [
    new T.Vector3(-0.6, 0.65, 0.6).normalize(),
    new T.Vector3(0.7, 0.55, 0.45).normalize(),
  ];
  for (let row = 0; row < height; row++)
    for (let column = 0; column < width; column++) {
      texelDirection(column, row, width, height, direction);
      // The ground fades into the sky over a few degrees at the horizon.
      const up = T.MathUtils.smoothstep(direction.y, -0.05, 0.05);
      const glow =
        1 +
        softboxes.reduce(
          (sum, box) =>
            sum + 2.5 * Math.exp(-((direction.angleTo(box) / 0.3) ** 2)),
          0,
        ) *
          up;
      const i = (row * width + column) * 4;
      for (const [c, channel] of (["r", "g", "b"] as const).entries())
        data[i + c] =
          (fillSky[channel] * glow * up + fillGround[channel] * (1 - up)) /
          Math.PI;
      data[i + 3] = 1;
    }
  // Scale the sky so a level floor gets what the hemisphere fill gave it.
  const scale =
    (FILL * luminance(fillSky)) / floorIrradiance(data, width, height);
  const half = new Uint16Array(data.length);
  for (let row = 0; row < height; row++)
    for (let i = row * width * 4; i < (row + 1) * width * 4; i++)
      half[i] = T.DataUtils.toHalfFloat(
        i % 4 === 3 ? 1 : data[i] * (row < height / 2 ? scale : FILL),
      );
  surround = new T.DataTexture(
    half,
    width,
    height,
    T.RGBAFormat,
    T.HalfFloatType,
    T.EquirectangularReflectionMapping,
  );
  surround.colorSpace = T.LinearSRGBColorSpace;
  surround.minFilter = surround.magFilter = T.LinearFilter;
  surround.generateMipmaps = false;
  surround.flipY = true;
  surround.needsUpdate = true;
  return surround;
}

/**
 * The exposure for a set lit by its HDR. A floor of 45 % grey shows at 60 %
 * white through the studio's ACES tone mapping — the set pipeline's own
 * measure, so the studio matches its thumbnails — unless the set names its
 * exposure. Either way a sunlit floor of 80 % white stays below 80 % display
 * light, so a strong sun never washes the set out.
 * `floor` is the light on a level floor (luminance; sun, sky and fill).
 */
export function hdrExposure(floor: number, authored?: number) {
  const light = Math.max(floor, 1e-4);
  const metered = T.MathUtils.clamp((0.567 * Math.PI) / light, 0.15, 3);
  // ACES (with three's 1/0.6 scale) shows 80 % at a scene value of 1.966.
  const limit = (1.966 * 0.6 * Math.PI) / (0.8 * light);
  return Math.min(authored ?? metered, limit);
}

/**
 * The studio's light for the current set. A built-in stage uses the lighting
 * preset (golden/daylight/moonlight). A photographic set is lit by its own
 * photo: its HDR lights the cast, the key light follows the photographed sun
 * for shadows, and exposure matches the panorama. A 3D set with an HDR is lit
 * the same way, with the HDR as its sky when the set asks for it and an
 * exposure metered from its light; without one the preset's sun lights it,
 * with the studio surround as its fill and reflections, adjusted by the
 * set's own lighting notes. Sets are shown clear unless they ask for fog,
 * and the sun's shadow covers the set (around the cast in a large one). The
 * presets would contradict a photo or a set's own HDR, so they do not apply
 * there.
 */
export function applyStageLighting(
  world: T.Scene,
  renderer: T.WebGLRenderer,
  lighting: "golden" | "daylight" | "moonlight",
  view: StageView,
) {
  const sun = world.children.find(
    (o) => o instanceof T.DirectionalLight,
  ) as T.DirectionalLight;
  const sky = world.children.find(
    (o) => o instanceof T.HemisphereLight,
  ) as T.HemisphereLight;
  world.environmentIntensity = 1;
  if (view instanceof PhotoSet) {
    const yaw = T.MathUtils.degToRad(view.backdrop.rotation);
    world.background = new T.Color("#202020");
    world.fog = null;
    world.environment = view.environment;
    world.environmentRotation.set(0, yaw, 0);
    sky.intensity = 0;
    fitSunShadow(sun, view.keyDirection(), null);
    sun.color.copy(view.light.sunColor);
    // Without a sun the key light only casts the soft contact shadow; its
    // light is already in the environment.
    sun.intensity = view.light.sun ? view.light.sunIntensity : 0.0001;
    renderer.toneMappingExposure = view.exposure;
    return;
  }
  const color = presetColor(lighting);
  world.environmentRotation.set(0, 0, 0);
  if (view instanceof ModelSet) {
    const notes = view.set.lighting ?? {};
    const focus = new T.Vector3(...view.set.spawn);
    world.fog = notes.fog ? new T.Fog(color, 19, 38) : null;
    const authored = notes.sun ? new T.Vector3(...notes.sun) : null;
    if (view.light) {
      const { map, sun: measured, skyIrradiance } = view.light;
      world.environment = map;
      world.background = notes.sky ? map : new T.Color(color);
      // The HDR already carries the sky's light; only a measured or authored
      // sun is added as a shadow-casting light.
      sky.intensity = notes.hemisphere ?? 0;
      const key = authored ?? measured.key;
      fitSunShadow(sun, key, view.bounds, focus);
      sun.color.copy(measured.sunColor);
      sun.intensity =
        notes.sunIntensity ?? (measured.sun ? measured.sunIntensity : 0.0001);
      const floor =
        skyIrradiance +
        sun.intensity *
          luminance(sun.color) *
          Math.max(0, key.clone().normalize().y) +
        sky.intensity * luminance(fillSky);
      renderer.toneMappingExposure = hdrExposure(floor, notes.exposure);
      return;
    }
    world.environment = studioSurround();
    world.environmentIntensity = (notes.hemisphere ?? FILL) / FILL;
    world.background = new T.Color(color);
    sky.intensity = 0;
    fitSunShadow(sun, authored ?? presetSun, view.bounds, focus);
    sun.color.set(presetSunColor(lighting));
    sun.intensity = notes.sunIntensity ?? (lighting === "moonlight" ? 1.2 : 4);
    renderer.toneMappingExposure = notes.exposure ?? 1;
    return;
  }
  world.background = new T.Color(color);
  world.fog = new T.Fog(color, 19, 38);
  world.environment = null;
  sky.intensity = FILL;
  fitSunShadow(sun, presetSun, null);
  sun.color.set(presetSunColor(lighting));
  sun.intensity = lighting === "moonlight" ? 1.2 : 4;
  renderer.toneMappingExposure = 1;
}
