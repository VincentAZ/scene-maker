import * as T from "three";
import { PhotoSet } from "./hdriBackdrop";
import { fitSunShadow, ModelSet } from "./modelSet";

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

/**
 * The studio's light for the current set. A built-in stage uses the lighting
 * preset (golden/daylight/moonlight). A photographic set is lit by its own
 * photo: its HDR lights the cast, the key light follows the photographed sun
 * for shadows, and exposure matches the panorama. A 3D set with an HDR is lit
 * the same way, with the HDR as its sky when the set asks for it; without one
 * the preset lights it, adjusted by the set's own lighting notes. Sets are
 * shown clear unless they ask for fog, and the sun's shadow covers their
 * whole extent. The presets would contradict a photo, so they do not apply
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
    world.fog = notes.fog ? new T.Fog(color, 19, 38) : null;
    renderer.toneMappingExposure = notes.exposure ?? 1;
    const authored = notes.sun ? new T.Vector3(...notes.sun) : null;
    if (view.light) {
      const { map, sun: measured } = view.light;
      world.environment = map;
      world.background = notes.sky ? map : new T.Color(color);
      // The HDR already carries the sky's light; only a measured or authored
      // sun is added as a shadow-casting light.
      sky.intensity = notes.hemisphere ?? 0;
      fitSunShadow(sun, authored ?? measured.key, view.bounds);
      sun.color.copy(measured.sunColor);
      sun.intensity =
        notes.sunIntensity ?? (measured.sun ? measured.sunIntensity : 0.0001);
      return;
    }
    world.environment = null;
    world.background = new T.Color(color);
    sky.intensity = notes.hemisphere ?? 2.4;
    fitSunShadow(sun, authored ?? presetSun, view.bounds);
    sun.color.set(presetSunColor(lighting));
    sun.intensity = notes.sunIntensity ?? (lighting === "moonlight" ? 1.2 : 4);
    return;
  }
  world.background = new T.Color(color);
  world.fog = new T.Fog(color, 19, 38);
  world.environment = null;
  sky.intensity = 2.4;
  fitSunShadow(sun, presetSun, null);
  sun.color.set(presetSunColor(lighting));
  sun.intensity = lighting === "moonlight" ? 1.2 : 4;
  renderer.toneMappingExposure = 1;
}
