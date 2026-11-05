import {
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import {
  Footprints,
  Maximize2,
  Plus,
  Redo2,
  RotateCcw,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Modal } from "./Modal";
import {
  allAssets,
  motionSchema,
  uid,
  type Entity,
  type Motion,
  type Scene,
} from "../shared/scene";
import {
  compilePath,
  pathToWorld,
  worldToPath,
  pointActionMotions,
  type PointAction,
  type PathFrame,
  type MotionPath,
} from "../shared/path";
import type { Point } from "../shared/ladder";
import type { Footprint } from "../shared/navigation";
import {
  defaultRouteLocomotion,
  matchingRouteLocomotion,
  routeLocomotions,
  routeLocomotionFields,
  routeMovement,
  routePace,
  type RouteGaitCycle,
} from "./routeLocomotion";
import { useRouteGait, type RouteGaitOverride } from "./useRouteGait";

type Props = {
  scene: Scene;
  actor: Entity;
  frame: PathFrame;
  motion?: Motion;
  footprints?: Footprint[];
  speechDuration?: number;
  onPlan?: (
    targetId: string,
    movement: "walk" | "run",
    locomotion?: Motion,
    measuredCycle?: RouteGaitCycle,
  ) => Motion;
  locomotionCycle?: RouteGaitOverride;
  onSave: (motion: Motion, pointActions?: PointAction[]) => void;
  onClose: () => void;
};
type Waypoint = {
  id: string;
  point: Point;
  action?: Omit<PointAction, "pointIndex">;
};
/** What the map's own undo history covers: the points and the arrival facing. */
type Sketch = { waypoints: Waypoint[]; endHeading?: number };
type History = Sketch & {
  past: Sketch[];
  future: Sketch[];
  // A drag or a run of keystrokes stays one undo step until it is sealed.
  coalesce: string | null;
};
type HistoryAction =
  | { type: "edit"; next: (sketch: Sketch) => Sketch; coalesce?: string }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "seal" };
function editHistory(state: History, action: HistoryAction): History {
  const current: Sketch = {
    waypoints: state.waypoints,
    endHeading: state.endHeading,
  };
  switch (action.type) {
    case "edit": {
      const next = action.next(current);
      if (
        next.waypoints === current.waypoints &&
        next.endHeading === current.endHeading
      )
        return state;
      const kept =
        action.coalesce && action.coalesce === state.coalesce
          ? state.past
          : [...state.past, current].slice(-200);
      return {
        waypoints: next.waypoints,
        endHeading: next.endHeading,
        past: kept,
        future: [],
        coalesce: action.coalesce ?? null,
      };
    }
    case "undo": {
      const previous = state.past.at(-1);
      if (!previous) return state;
      return {
        waypoints: previous.waypoints,
        endHeading: previous.endHeading,
        past: state.past.slice(0, -1),
        future: [current, ...state.future],
        coalesce: null,
      };
    }
    case "redo": {
      const [next, ...future] = state.future;
      if (!next) return state;
      return {
        waypoints: next.waypoints,
        endHeading: next.endHeading,
        past: [...state.past, current],
        future,
        coalesce: null,
      };
    }
    case "seal":
      return state.coalesce === null ? state : { ...state, coalesce: null };
  }
}
type Gesture =
  | { kind: "pan"; x: number; y: number; origin: Bounds; moved: boolean }
  | { kind: "point"; id: string; x: number; y: number; moved: boolean }
  | { kind: "heading" };
type Bounds = { x: number; z: number; width: number };
const MAP_WIDTH = 600,
  MAP_HEIGHT = 400;
const minimumGap = 0.05;
const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

export function PathEditor({
  scene,
  actor,
  frame,
  motion,
  footprints = [],
  speechDuration,
  onPlan,
  locomotionCycle,
  onSave,
  onClose,
}: Props) {
  const [history, dispatch] = useReducer(editHistory, undefined, () => ({
    waypoints: (
      motion?.path?.points.map((p) => pathToWorld(p, frame)) || [
        [...frame.position] as Point,
      ]
    ).map((point) => ({ id: uid(), point })),
    endHeading: motion?.path?.endHeading,
    past: [],
    future: [],
    coalesce: null,
  }));
  const { waypoints, endHeading } = history;
  const edit = (next: (sketch: Sketch) => Sketch, coalesce?: string) =>
    dispatch({ type: "edit", next, coalesce });
  const editWaypoints = (
    next: (waypoints: Waypoint[]) => Waypoint[],
    coalesce?: string,
  ) =>
    edit(
      (sketch) => ({ ...sketch, waypoints: next(sketch.waypoints) }),
      coalesce,
    );
  const setEndHeading = (endHeading: number | undefined, coalesce?: string) =>
    edit((sketch) => ({ waypoints: sketch.waypoints, endHeading }), coalesce);
  const undo = () => dispatch({ type: "undo" });
  const redo = () => dispatch({ type: "redo" });
  const points = useMemo(
    () => waypoints.map((waypoint) => waypoint.point),
    [waypoints],
  );
  const pointActions: PointAction[] =
    speechDuration === undefined
      ? waypoints.flatMap((waypoint, pointIndex) =>
          waypoint.action ? [{ ...waypoint.action, pointIndex }] : [],
        )
      : [];
  const actionSeconds = pointActions.reduce(
    (total, action) => total + action.duration,
    0,
  );
  const invalidAction = pointActions.some(
    (action) =>
      !Number.isFinite(action.duration) ||
      action.duration < 0.2 ||
      action.duration > 60,
  );
  const [planNotice, setPlanNotice] = useState("");
  const locomotions = useMemo(
    () => routeLocomotions(scene, actor, motion),
    [scene, actor, motion],
  );
  const [name, setName] = useState(motion?.name || `${actor.name}'s route`),
    [locomotionId, setLocomotionId] = useState(
      () =>
        (motion && matchingRouteLocomotion(locomotions, motion))?.id ||
        defaultRouteLocomotion(scene, actor).id,
    );
  const locomotion =
    locomotions.find((candidate) => candidate.id === locomotionId) ||
    defaultRouteLocomotion(scene, actor);
  const kind = routeMovement(locomotion);
  const gait = useRouteGait(scene, actor, locomotion, locomotionCycle);
  const measuredCycle = gait.cycle;
  const [smooth, setSmooth] = useState(motion?.path?.smooth ?? true),
    [seconds, setSeconds] = useState(motion?.duration || 6),
    // Reshaping an existing route keeps its duration (and so its place in the
    // sequence); a new route follows the measured gait.
    [keepDuration, setKeepDuration] = useState(!!motion);
  const [error, setError] = useState(""),
    [id] = useState(motion?.id || uid);
  const [destination, setDestination] = useState("");
  const [backward, setBackward] = useState(motion?.path?.backward ?? false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [panning, setPanning] = useState(false);
  const [ghost, setGhost] = useState<[number, number] | null>(null);
  const svg = useRef<SVGSVGElement>(null),
    gesture = useRef<Gesture | null>(null),
    suppressClick = useRef(false),
    spaceHeld = useRef(false);
  const selectedIndex = waypoints.findIndex(
    (waypoint) => waypoint.id === selectedId,
  );
  const selected = selectedIndex > 0 ? selectedIndex : null;
  const nearby = scene.entities.filter(
    (e) =>
      e.id !== actor.id &&
      e.visible &&
      Math.hypot(
        e.position[0] - frame.position[0],
        e.position[2] - frame.position[2],
      ) < 20,
  );
  const fitMap = (route: Point[]): Bounds => {
    const visible = [...route, ...nearby.map((e) => e.position)];
    const planned = route.length > 1,
      padding = planned ? 1 : 2;
    const minX =
      Math.min(
        frame.position[0] - (planned ? 1 : 4),
        ...visible.map((p) => p[0]),
      ) - padding;
    const maxX =
      Math.max(
        frame.position[0] + (planned ? 1 : 4),
        ...visible.map((p) => p[0]),
      ) + padding;
    const minZ =
      Math.min(
        frame.position[2] - (planned ? 1 : 3),
        ...visible.map((p) => p[2]),
      ) - padding;
    const maxZ =
      Math.max(
        frame.position[2] + (planned ? 1 : 3),
        ...visible.map((p) => p[2]),
      ) + padding;
    const width = Math.max(maxX - minX, (maxZ - minZ) * 1.5);
    return {
      x: (minX + maxX - width) / 2,
      z: (minZ + maxZ - width / 1.5) / 2,
      width,
    };
  };
  const [bounds, setBounds] = useState(() => fitMap(points));
  // Map units per world metre; points and labels keep their screen size.
  const scale = MAP_WIDTH / bounds.width;
  const map = (p: Point): [number, number] => [
    (p[0] - bounds.x) * scale,
    (p[2] - bounds.z) * scale,
  ];
  const unmap = (u: number, v: number): Point => [
    bounds.x + u / scale,
    frame.position[1],
    bounds.z + v / scale,
  ];
  const zoomAt = (factor: number, u = MAP_WIDTH / 2, v = MAP_HEIGHT / 2) =>
    setBounds((old) => {
      const width = Math.max(1, Math.min(400, old.width / factor));
      // The world point under the cursor stays put.
      return {
        x: old.x + (u / MAP_WIDTH) * (old.width - width),
        z: old.z + (v / MAP_WIDTH) * (old.width - width),
        width,
      };
    });
  const gridStep =
    [0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 50].find((step) => step * scale >= 28) ??
    100;
  const gridSize = gridStep * scale;
  const [originU, originV] = map([0, frame.position[1], 0]);
  const gridLabel =
    gridStep >= 1 ? `${gridStep} m` : `${Math.round(gridStep * 100)} cm`;
  const labelBoxes: { x: number; y: number; width: number }[] = [];
  const labelOffsets = new Map(
    nearby.map((entity) => {
      const [x, y] = map(entity.position),
        width = entity.name.length * 6;
      const offset =
        [-18, 30, -34, 46, -50, 62].find(
          (dy) =>
            !labelBoxes.some(
              (box) =>
                Math.abs(x - box.x) < (width + box.width) / 2 + 4 &&
                Math.abs(y + dy - box.y) < 15,
            ),
        ) ?? 78;
      labelBoxes.push({ x, y: y + offset, width });
      return [entity.id, offset];
    }),
  );
  const path = useMemo(() => {
    const path: MotionPath = {
      points: points.map((p) => {
        const local = worldToPath(p, frame);
        local[1] = 0;
        return local;
      }),
      smooth,
      ...(backward && locomotion.kind !== "imported" ? { backward: true } : {}),
      ...(locomotion.kind === "imported" && locomotion.path?.sourceRange
        ? { sourceRange: { ...locomotion.path.sourceRange } }
        : {}),
      ...(locomotion.kind === "imported" &&
      locomotion.path?.strideScale !== undefined
        ? { strideScale: locomotion.path.strideScale }
        : {}),
      ...(endHeading === undefined ? {} : { endHeading }),
    };
    const reference = motion?.path;
    // Correspondence belongs to the original repaired geometry. Keep it on
    // unchanged saves; a new drawn/planned path must not inherit stale anchors.
    if (
      reference?.sourceProgress &&
      reference.smooth === smooth &&
      reference.points.length === path.points.length &&
      locomotion.sourceAssetId === motion?.sourceAssetId &&
      locomotion.animationName === motion?.animationName &&
      JSON.stringify(path.sourceRange) ===
        JSON.stringify(reference.sourceRange) &&
      path.strideScale === reference.strideScale &&
      path.points.every((p, i) =>
        p.every((n, axis) => Math.abs(n - reference.points[i][axis]) < 1e-8),
      )
    )
      path.sourceProgress = [...reference.sourceProgress];
    return path;
  }, [
    points,
    frame,
    smooth,
    endHeading,
    backward,
    motion,
    locomotion.sourceAssetId,
    locomotion.animationName,
    locomotion.kind,
    locomotion.path?.sourceRange,
    locomotion.path?.strideScale,
  ]);
  const compiled = useMemo(
    () => (points.length > 1 ? compilePath(path) : null),
    [path, points.length],
  );
  const length = (compiled?.length || 0) * frame.scale;
  // The same limits the saved route must meet, reported while drawing.
  const problem = useMemo(() => {
    const local = path.points;
    const label = (index: number) => (index ? `point ${index}` : "the start");
    for (let i = 1; i < local.length; i++)
      if (
        Math.hypot(
          local[i][0] - local[i - 1][0],
          local[i][2] - local[i - 1][2],
        ) < minimumGap
      )
        return `Point ${i} is too close to ${label(i - 1)}. Keep neighbouring points at least 5 cm apart.`;
    const far = local.findIndex(
      (p) => Math.abs(p[0]) > 50 || Math.abs(p[2]) > 50,
    );
    return far > 0
      ? `Point ${far} is more than 50 m from the start. Bring it closer.`
      : "";
  }, [path]);
  const naturalDuration =
    gait.status === "ready"
      ? length / routePace(locomotion, frame.scale, measuredCycle, length)
      : undefined;
  const pace =
    naturalDuration === undefined
      ? undefined
      : locomotion.kind === "imported"
        ? naturalDuration
        : Math.max(0.5, Math.min(60, Math.round(naturalDuration * 10) / 10));
  const duration = speechDuration ?? (keepDuration ? seconds : pace);
  const mapped = useMemo(
    () =>
      compiled?.samples.map((s) => map(pathToWorld(s.point, frame))) ?? null,
    // map() reads only bounds, so these are its real inputs.
    [compiled, frame, bounds],
  );
  const drawn = mapped?.map((p) => p.join(",")).join(" ") || "";
  // Sample indices where each numbered point sits, so a click on the route
  // knows which pair of points it falls between.
  const knots = useMemo(() => {
    const indices: number[] = [];
    if (!compiled) return indices;
    let next = 1;
    compiled.samples.forEach((sample, index) => {
      const target = path.points[next];
      if (
        target &&
        Math.hypot(sample.point[0] - target[0], sample.point[2] - target[2]) <
          1e-9
      ) {
        indices.push(index);
        next++;
      }
    });
    return indices;
  }, [compiled, path]);
  const arrows = useMemo(() => {
    if (!compiled || !mapped) return [];
    const every =
      [0.5, 1, 2, 5, 10, 20, 50].find((metres) => metres * scale >= 36) ?? 100;
    const marks: { x: number; y: number; angle: number }[] = [];
    let next = every;
    for (let i = 1; i < mapped.length; i++) {
      const travelled = compiled.samples[i].distance * frame.scale;
      if (travelled > length - 0.4) break;
      if (travelled < next) continue;
      const [ax, ay] = mapped[i - 1],
        [bx, by] = mapped[i];
      marks.push({
        x: bx,
        y: by,
        angle: (Math.atan2(by - ay, bx - ax) * 180) / Math.PI,
      });
      next += every;
    }
    return marks;
  }, [compiled, mapped, scale, length, frame.scale]);
  const arrival = endHeading ?? compiled?.samples.at(-1)?.heading;
  const toMap = (event: { clientX: number; clientY: number }) => {
    const rect = svg.current!.getBoundingClientRect();
    return {
      u: ((event.clientX - rect.left) / rect.width) * MAP_WIDTH,
      v: ((event.clientY - rect.top) / rect.height) * MAP_HEIGHT,
      // About eight screen pixels, whatever size the map is shown at.
      tolerance: (8 * MAP_WIDTH) / rect.width,
    };
  };
  const pointAt = (event: { clientX: number; clientY: number }): Point => {
    const { u, v } = toMap(event);
    return unmap(u, v);
  };
  const nearestOnPath = (u: number, v: number, tolerance: number) => {
    if (!mapped) return null;
    let best: { index: number; u: number; v: number; distance: number } | null =
      null;
    for (let j = 0; j + 1 < mapped.length; j++) {
      const [ax, ay] = mapped[j],
        [bx, by] = mapped[j + 1];
      const dx = bx - ax,
        dy = by - ay,
        span = dx * dx + dy * dy;
      const t = span
        ? Math.max(0, Math.min(1, ((u - ax) * dx + (v - ay) * dy) / span))
        : 0;
      const px = ax + dx * t,
        py = ay + dy * t,
        distance = Math.hypot(u - px, v - py);
      if (distance <= tolerance && (!best || distance < best.distance))
        best = { index: j, u: px, v: py, distance };
    }
    if (!best) return null;
    const passed = knots.filter((knot) => knot <= best.index).length;
    return { index: passed + 1, point: unmap(best.u, best.v) };
  };
  const tooClose = (point: Point, other: Point) =>
    Math.hypot(point[0] - other[0], point[2] - other[2]) <
    minimumGap * frame.scale;
  const full = () => {
    if (points.length < 32) return false;
    setError("Use up to 31 points after the start.");
    return true;
  };
  const add = (point: Point) => {
    if (full() || tooClose(point, points.at(-1)!)) return;
    const id = uid();
    editWaypoints((old) => [...old, { id, point }]);
    setSelectedId(id);
  };
  const insert = (index: number, point: Point) => {
    if (
      full() ||
      tooClose(point, points[index - 1]) ||
      tooClose(point, points[index])
    )
      return;
    const id = uid();
    editWaypoints((old) => [
      ...old.slice(0, index),
      { id, point },
      ...old.slice(index),
    ]);
    setSelectedId(id);
  };
  const move = (id: string, point: Point, coalesce: string) =>
    editWaypoints(
      (old) =>
        old.map((waypoint) =>
          waypoint.id === id ? { ...waypoint, point } : waypoint,
        ),
      coalesce,
    );
  const remove = (index: number) =>
    editWaypoints((old) => old.filter((_, i) => i !== index));
  const setAction = (
    index: number,
    action: Omit<PointAction, "pointIndex"> | undefined,
  ) =>
    editWaypoints((old) =>
      old.map((waypoint, i) =>
        i === index ? { ...waypoint, action } : waypoint,
      ),
    );
  const endGesture = () => {
    const current = gesture.current;
    gesture.current = null;
    if (current?.kind === "pan") {
      if (current.moved) suppressClick.current = true;
      setPanning(false);
    }
    dispatch({ type: "seal" });
  };
  const grab = (event: PointerEvent<SVGElement>, next: Gesture) => {
    event.stopPropagation();
    suppressClick.current = true;
    gesture.current = next;
    setGhost(null);
    svg.current!.setPointerCapture(event.pointerId);
  };
  useEffect(() => {
    const element = svg.current;
    if (!element) return;
    // React registers wheel listeners as passive, so zooming would also
    // scroll the dialog; a native listener can keep the page still.
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const delta =
        event.deltaMode === 1
          ? event.deltaY * 16
          : event.deltaMode === 2
            ? event.deltaY * 400
            : event.deltaY;
      zoomAt(
        Math.min(2, Math.max(0.5, Math.exp(-delta * 0.0015))),
        ((event.clientX - rect.left) / rect.width) * MAP_WIDTH,
        ((event.clientY - rect.top) / rect.height) * MAP_HEIGHT,
      );
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, []);
  useEffect(() => {
    // The app ignores keys while a dialog is open, so these are the only
    // shortcuts active here. Typing in a field keeps the field's own keys.
    const onKeyDown = (event: KeyboardEvent) => {
      const typing =
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement;
      if (typing) return;
      const key = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && (key === "z" || key === "y")) {
        event.preventDefault();
        if (key === "y" || event.shiftKey) redo();
        else undo();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === " ") {
        spaceHeld.current = true;
        const interactive =
          event.target instanceof HTMLElement &&
          event.target.closest("button, a, summary, [role=button]");
        if (!interactive) event.preventDefault();
        return;
      }
      if (selected === null) return;
      const id = waypoints[selected].id;
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        remove(selected);
        return;
      }
      const step = event.shiftKey ? 0.1 : 0.01;
      const nudge = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      }[event.key];
      if (!nudge) return;
      event.preventDefault();
      const point = waypoints[selected].point;
      move(
        id,
        [point[0] + nudge[0], point[1], point[2] + nudge[1]],
        `nudge:${id}`,
      );
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === " ") spaceHeld.current = false;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  });
  // Everything a save would write, so closing can tell real changes from a look.
  const fingerprint = JSON.stringify({
    points: waypoints.map((waypoint) => [waypoint.point, waypoint.action]),
    endHeading,
    smooth,
    backward,
    name,
    locomotionId,
    keepDuration,
    seconds,
  });
  const original = useRef(fingerprint);
  const dirty = fingerprint !== original.current;
  const requestClose = () => {
    if (!dirty) onClose();
    else setConfirming(true);
  };
  const submit = () => {
    try {
      if (gait.status !== "ready") {
        setError(
          gait.error || "Wait for the original gait to finish measuring.",
        );
        return;
      }
      if (problem) {
        setError(problem);
        return;
      }
      const parsed = motionSchema.safeParse({
        id,
        name: name.trim(),
        ...routeLocomotionFields(locomotion),
        duration,
        distance: 0,
        poses: [],
        path,
      });
      if (!parsed.success) {
        setError(parsed.error.issues[0].message);
        return;
      }
      if (invalidAction) {
        setError("Each point action needs a duration from 0.2 to 60 seconds.");
        return;
      }
      onSave(parsed.data, pointActions.length ? pointActions : undefined);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Check the route and try again.",
      );
    }
  };
  const [lastU, lastV] = map(points.at(-1)!);
  const arrivalDirection =
    arrival === undefined
      ? null
      : [Math.sin(arrival + frame.heading), Math.cos(arrival + frame.heading)];
  return (
    <Modal
      title={`Where should ${actor.name} go?`}
      wide
      onClose={requestClose}
      error={error}
      onDismissError={() => setError("")}
    >
      <div className="path-editor">
        <p className="muted">
          {speechDuration
            ? "This route plays during the line. Its speed follows the words."
            : motion
              ? "Shape this action’s route."
              : "This route starts after their current actions."}{" "}
          Click the map to add a point, click the route to insert one, and drag
          points to move them.
        </p>
        {onPlan && (
          <div className="route-destination">
            <label>
              Walk to an object
              <select
                aria-label="Route destination"
                value={destination}
                onChange={(event) => setDestination(event.target.value)}
              >
                <option value="">Choose a destination…</option>
                {scene.entities
                  .filter(
                    (e) => e.id !== actor.id && e.visible && !e.clips.length,
                  )
                  .map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
              </select>
            </label>
            <button
              className="secondary"
              disabled={!destination || gait.status !== "ready"}
              onClick={() => {
                try {
                  const planned = onPlan(
                    destination,
                    kind,
                    path.backward ? { ...locomotion, path } : locomotion,
                    measuredCycle,
                  );
                  const route = planned.path!.points.map((p) =>
                    pathToWorld(p, frame),
                  );
                  const unused = new Set(
                    waypoints.map((waypoint) => waypoint.id),
                  );
                  const replanned = route.map((point) => {
                    const previous = waypoints.find(
                      (waypoint) =>
                        unused.has(waypoint.id) &&
                        Math.hypot(
                          ...point.map((n, axis) => n - waypoint.point[axis]),
                        ) <
                          0.01 * frame.scale,
                    );
                    if (previous) unused.delete(previous.id);
                    return previous
                      ? { ...previous, point }
                      : { id: uid(), point };
                  });
                  const removed = waypoints.filter(
                    (waypoint) => unused.has(waypoint.id) && waypoint.action,
                  ).length;
                  edit(() => ({
                    waypoints: replanned,
                    endHeading: planned.path!.endHeading,
                  }));
                  setPlanNotice(
                    removed
                      ? `${removed} point action${removed === 1 ? " was" : "s were"} removed because those points are not on the new route. Unchanged points kept their actions.`
                      : "",
                  );
                  setBounds(fitMap(route));
                  setSmooth(planned.path!.smooth);
                  setBackward(planned.path!.backward ?? false);
                  setName(planned.name);
                  setKeepDuration(false);
                  setError("");
                } catch (error) {
                  setError(
                    error instanceof Error
                      ? error.message
                      : "Could not plan this route.",
                  );
                }
              }}
            >
              Plan a clear route
            </button>
          </div>
        )}
        {planNotice && (
          <p className="path-note" role="status">
            {planNotice}
          </p>
        )}
        <div className="path-map-heading">
          <span>YOUR SCENE · TOP VIEW</span>
          <span>
            {length.toFixed(1)} m · {points.length - 1} points · grid{" "}
            {gridLabel}
          </span>
        </div>
        <svg
          ref={svg}
          className={panning ? "path-map panning" : "path-map"}
          viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
          preserveAspectRatio="none"
          role="img"
          tabIndex={0}
          aria-label={`Route map for ${actor.name}`}
          onClick={(event) => {
            if (suppressClick.current) {
              suppressClick.current = false;
              return;
            }
            const { u, v, tolerance } = toMap(event);
            const hit = nearestOnPath(u, v, tolerance);
            if (hit) insert(hit.index, hit.point);
            else add(unmap(u, v));
          }}
          onPointerDown={(event) => {
            suppressClick.current = false;
            setGhost(null);
            if (event.button === 2) return;
            gesture.current = {
              kind: "pan",
              x: event.clientX,
              y: event.clientY,
              origin: bounds,
              moved: false,
            };
            svg.current!.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const current = gesture.current;
            if (!current) {
              const { u, v, tolerance } = toMap(event);
              const hit = nearestOnPath(u, v, tolerance);
              setGhost(hit ? map(hit.point) : null);
              return;
            }
            if (current.kind === "pan") {
              const dx = event.clientX - current.x,
                dy = event.clientY - current.y;
              if (!current.moved && Math.hypot(dx, dy) < 4) return;
              current.moved = true;
              setPanning(true);
              const rect = svg.current!.getBoundingClientRect();
              setBounds({
                x: current.origin.x - (dx / rect.width) * current.origin.width,
                z:
                  current.origin.z -
                  (dy / rect.height) * (current.origin.width / 1.5),
                width: current.origin.width,
              });
            } else if (current.kind === "point") {
              if (
                !current.moved &&
                Math.hypot(
                  event.clientX - current.x,
                  event.clientY - current.y,
                ) < 3
              )
                return;
              current.moved = true;
              move(current.id, pointAt(event), `drag:${current.id}`);
            } else {
              const to = pointAt(event),
                last = points.at(-1)!;
              const dx = to[0] - last[0],
                dz = to[2] - last[2];
              if (Math.hypot(dx, dz) < minimumGap) return;
              setEndHeading(
                wrap(Math.atan2(dx, dz) - frame.heading),
                "heading",
              );
            }
          }}
          onPointerUp={endGesture}
          onPointerCancel={endGesture}
          onPointerLeave={() => setGhost(null)}
        >
          <defs>
            <pattern
              id="path-grid"
              x={((originU % gridSize) + gridSize) % gridSize}
              y={((originV % gridSize) + gridSize) % gridSize}
              width={gridSize}
              height={gridSize}
              patternUnits="userSpaceOnUse"
            >
              <path
                d={`M ${gridSize} 0 L 0 0 0 ${gridSize}`}
                fill="none"
                stroke="#dfe5d7"
                strokeWidth=".7"
              />
            </pattern>
          </defs>
          <rect width={MAP_WIDTH} height={MAP_HEIGHT} fill="url(#path-grid)" />
          {footprints.map((box) => {
            const [x, y] = map([box.minX, frame.position[1], box.minZ]);
            const [right, bottom] = map([
              box.maxX,
              frame.position[1],
              box.maxZ,
            ]);
            return (
              <rect
                key={box.id}
                x={x}
                y={y}
                width={right - x}
                height={bottom - y}
                rx="2"
                fill="#cbd2c2"
                stroke="#9ca98c"
                opacity=".65"
                pointerEvents="none"
              />
            );
          })}
          {nearby.map((entity) => {
            const [x, y] = map(entity.position);
            const asset = allAssets(scene).find((a) => a.id === entity.assetId);
            return (
              <g
                key={entity.id}
                transform={`translate(${x} ${y})`}
                className="map-prop"
              >
                <circle
                  r={asset?.category === "characters" ? 8 : 12}
                  fill={entity.color}
                />
                <text y={labelOffsets.get(entity.id)} textAnchor="middle">
                  {entity.name}
                </text>
              </g>
            );
          })}
          <polyline
            points={drawn}
            fill="none"
            stroke="#6b8053"
            strokeWidth="4"
            strokeLinejoin="round"
            pointerEvents="none"
          />
          {arrows.map((arrow, index) => (
            <path
              key={index}
              className="path-arrow"
              d="M -6 -5 L 3 0 L -6 5"
              transform={`translate(${arrow.x} ${arrow.y}) rotate(${arrow.angle})`}
            />
          ))}
          {ghost && (
            <circle className="path-ghost" cx={ghost[0]} cy={ghost[1]} r="7" />
          )}
          {compiled && arrivalDirection && (
            <g
              className={
                endHeading === undefined
                  ? "path-heading natural"
                  : "path-heading"
              }
            >
              <line
                x1={lastU + arrivalDirection[0] * 16}
                y1={lastV + arrivalDirection[1] * 16}
                x2={lastU + arrivalDirection[0] * 40}
                y2={lastV + arrivalDirection[1] * 40}
              />
              <g
                transform={`translate(${lastU + arrivalDirection[0] * 46} ${lastV + arrivalDirection[1] * 46}) rotate(${(Math.atan2(arrivalDirection[1], arrivalDirection[0]) * 180) / Math.PI})`}
                role="button"
                aria-label="Facing on arrival"
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  grab(event, { kind: "heading" });
                }}
              >
                <circle className="path-heading-grip" r="9" />
                <path d="M -3 -4 L 3 0 L -3 4" />
              </g>
            </g>
          )}
          {points.map((point, i) => {
            const [x, y] = map(point);
            const classes = [i ? "path-point" : "path-start"];
            if (i && i === selected) classes.push("selected");
            return (
              <g
                key={waypoints[i].id}
                transform={`translate(${x} ${y})`}
                className={classes.join(" ")}
                onPointerDown={(event) => {
                  // Space lets the map pan from anywhere, points included.
                  if (spaceHeld.current || event.button !== 0) return;
                  if (!i) {
                    event.stopPropagation();
                    suppressClick.current = true;
                    return;
                  }
                  setSelectedId(waypoints[i].id);
                  grab(event, {
                    kind: "point",
                    id: waypoints[i].id,
                    x: event.clientX,
                    y: event.clientY,
                    moved: false,
                  });
                }}
              >
                {i === selected && <circle className="path-halo" r="19" />}
                <circle
                  r={i ? 12 : 15}
                  fill={
                    i && waypoints[i].action
                      ? "#d4e99b"
                      : i
                        ? "#f7faef"
                        : "#d4e99b"
                  }
                  stroke="#526743"
                  strokeWidth="2"
                />
                <text textAnchor="middle" dominantBaseline="central">
                  {i || <tspan>●</tspan>}
                </text>
                {!i && (
                  <text x="0" y="-24" textAnchor="middle">
                    START · {actor.name}
                  </text>
                )}
              </g>
            );
          })}
          {selected !== null && (
            <g
              className="path-remove"
              transform={`translate(${map(points[selected])[0] + 15} ${map(points[selected])[1] - 15})`}
              role="button"
              aria-label={`Remove point ${selected}`}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                remove(selected);
              }}
            >
              <circle r="8" />
              <path d="M -3 -3 L 3 3 M 3 -3 L -3 3" />
            </g>
          )}
        </svg>
        <p
          className={problem ? "path-hint path-warning" : "path-hint"}
          role={problem ? "alert" : undefined}
        >
          {problem ||
            (selected !== null
              ? `Point ${selected} is selected. Delete removes it; the arrow keys nudge it 1 cm, or 10 cm with Shift.`
              : "Scroll to zoom, drag the empty map to look around, and drag the arrow after the last point to choose the facing on arrival.")}
        </p>
        <div className="path-map-actions path-toolbar">
          <div className="row">
            <button
              className="text-button"
              onClick={() =>
                add([
                  points.at(-1)![0] + 1,
                  frame.position[1],
                  points.at(-1)![2],
                ])
              }
              disabled={points.length >= 32}
            >
              <Plus size={14} /> Add point
            </button>
            <button
              className="text-button"
              onClick={() => {
                editWaypoints(() => [
                  { id: uid(), point: [...frame.position] },
                ]);
                setPlanNotice("");
              }}
              disabled={points.length < 2}
            >
              <RotateCcw size={14} /> Start over
            </button>
          </div>
          <div className="row">
            <button
              className="icon-button"
              aria-label="Undo path edit"
              title="Undo (Ctrl+Z)"
              disabled={!history.past.length}
              onClick={undo}
            >
              <Undo2 size={15} />
            </button>
            <button
              className="icon-button"
              aria-label="Redo path edit"
              title="Redo (Ctrl+Shift+Z)"
              disabled={!history.future.length}
              onClick={redo}
            >
              <Redo2 size={15} />
            </button>
            <button
              className="icon-button"
              aria-label="Zoom out"
              onClick={() => zoomAt(1 / 1.5)}
            >
              <ZoomOut size={15} />
            </button>
            <button
              className="icon-button"
              aria-label="Zoom in"
              onClick={() => zoomAt(1.5)}
            >
              <ZoomIn size={15} />
            </button>
            <button
              className="text-button"
              onClick={() => setBounds(fitMap(points))}
            >
              <Maximize2 size={14} /> Fit
            </button>
          </div>
        </div>
        <div className="path-options">
          <label>
            Action name
            <input
              value={name}
              maxLength={100}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            Locomotion
            <select
              aria-label="Route locomotion"
              value={locomotionId}
              onChange={(event) => setLocomotionId(event.target.value)}
            >
              <optgroup label="Recorded and imported gaits">
                {locomotions
                  .filter((candidate) => candidate.kind === "imported")
                  .map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.name}
                      {candidate.path?.sourceRange
                        ? ` · source ${candidate.path.sourceRange.start}–${candidate.path.sourceRange.end}s`
                        : ""}
                      {candidate.sourceAssetId === actor.assetId
                        ? " · original character"
                        : candidate.sourceAssetId?.startsWith("cmu-capture-")
                          ? " · recorded"
                          : " · imported"}
                    </option>
                  ))}
              </optgroup>
            </select>
          </label>
          <label>
            {speechDuration
              ? "Timed to this line (seconds)"
              : pointActions.length
                ? "Movement time (seconds)"
                : "Duration (seconds)"}
            <input
              type="number"
              min=".2"
              max="60"
              step=".1"
              disabled={speechDuration !== undefined}
              aria-label="Route duration"
              placeholder={
                gait.status === "loading" ? "Measuring…" : "Unavailable"
              }
              value={duration ?? ""}
              onChange={(event) => {
                setKeepDuration(true);
                setSeconds(Number(event.target.value));
              }}
            />
          </label>
        </div>
        {speechDuration === undefined && (
          <div className="path-timing">
            <div role="group" aria-label="Route timing">
              <button
                className={keepDuration ? "active" : ""}
                aria-pressed={keepDuration}
                onClick={() => {
                  if (duration !== undefined) setSeconds(duration);
                  setKeepDuration(true);
                }}
              >
                Keep duration
              </button>
              <button
                className={keepDuration ? "" : "active"}
                aria-pressed={!keepDuration}
                disabled={gait.status !== "ready"}
                onClick={() => setKeepDuration(false)}
              >
                Keep natural pace
              </button>
            </div>
            <span className="muted">
              {keepDuration
                ? "Reshaping the route keeps this duration and changes the speed."
                : "Reshaping the route keeps the measured gait and changes the duration."}
            </span>
          </div>
        )}
        {locomotion.kind === "imported" && (
          <p className="path-note" role="note">
            Keeps the original animation and repeats it by distance along the
            route. The captured facing relative to travel is retained, including
            backward and sideways steps. Clips may not loop cleanly.
            {locomotion.path?.strideScale !== undefined &&
              ` ${path.sourceProgress ? "Average step length" : "Step length"}: ${Math.round(locomotion.path.strideScale * 100)}% of the captured gait.`}
            {locomotion.path?.sourceRange &&
              ` Selected source interval: ${locomotion.path.sourceRange.start}–${locomotion.path.sourceRange.end}s.`}
          </p>
        )}
        {gait.status === "loading" && (
          <p className="path-note" role="status">
            Measuring the original gait for this character… Natural pace will
            update when the source animation is ready.
          </p>
        )}
        {gait.status === "error" && (
          <div className="path-note" role="alert">
            <p>{gait.error}</p>
            {!locomotionCycle && (
              <button className="text-button" onClick={gait.retry}>
                Retry gait measurement
              </button>
            )}
          </div>
        )}
        {gait.status === "ready" && measuredCycle && (
          <p className="path-note" role="status">
            Measured natural pace:{" "}
            {routePace(locomotion, frame.scale, measuredCycle, length).toFixed(
              2,
            )}{" "}
            m/s
            {measuredCycle.warning ? ` · ${measuredCycle.warning}` : ""}
          </p>
        )}
        {speechDuration === undefined &&
          keepDuration &&
          duration !== undefined &&
          Number.isFinite(duration) &&
          duration > 0 &&
          length > 0 && (
            <p className="path-note" role="status">
              Keeping {duration.toFixed(1)} s for {length.toFixed(1)} m:{" "}
              {actor.name} moves at {(length / duration).toFixed(2)} m/s
              {naturalDuration
                ? `, against a natural ${(length / naturalDuration).toFixed(2)} m/s`
                : ""}
              .
            </p>
          )}
        {locomotion.kind === "imported" &&
          naturalDuration !== undefined &&
          duration !== undefined &&
          duration > 0 && (
            <p className="path-note" role="status">
              Source playback: {Number((naturalDuration / duration).toFixed(4))}
              ×.{" "}
              {keepDuration
                ? "Keeping the duration changes this rate as the route changes."
                : "Natural pace keeps the recording at its own speed."}
            </p>
          )}
        <div className="path-map-actions">
          <label className="path-smooth">
            <input
              type="checkbox"
              checked={smooth}
              onChange={(event) => setSmooth(event.target.checked)}
            />{" "}
            Smooth turns
          </label>
          {endHeading !== undefined && (
            <button
              className="text-button"
              onClick={() => setEndHeading(undefined)}
            >
              Use path direction on arrival
            </button>
          )}
        </div>
        {speechDuration === undefined ? (
          <section
            className="path-point-actions"
            aria-label="Actions at route points"
          >
            <h3>At each point</h3>
            <p className="muted small">
              Choose a separate action on arrival at any numbered point. Its
              time is added to movement time. Actions follow points when you
              move them; removing a point removes its action. Replanning keeps
              actions only at unchanged points.
            </p>
            {!points.slice(1).length && (
              <p className="muted small">
                Add a route point to choose its action.
              </p>
            )}
            {waypoints.slice(1).map((waypoint, index) => (
              <div className="path-point-action" key={waypoint.id}>
                <span className="path-point-number">{index + 1}</span>
                <label>
                  On arrival
                  <select
                    aria-label={`Point ${index + 1} action`}
                    value={waypoint.action?.motionId || ""}
                    onChange={(event) => {
                      const selected = pointActionMotions.find(
                        (candidate) => candidate.id === event.target.value,
                      );
                      setAction(
                        index + 1,
                        selected
                          ? {
                              motionId: selected.id,
                              duration:
                                waypoint.action?.duration ?? selected.duration,
                            }
                          : undefined,
                      );
                    }}
                  >
                    <option value="">Keep moving · no action</option>
                    {pointActionMotions.map((action) => (
                      <option key={action.id} value={action.id}>
                        {action.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Action seconds
                  <input
                    type="number"
                    min=".2"
                    max="60"
                    step=".1"
                    aria-label={`Point ${index + 1} action duration`}
                    disabled={!waypoint.action}
                    value={waypoint.action?.duration ?? ""}
                    onChange={(event) =>
                      waypoint.action &&
                      setAction(index + 1, {
                        ...waypoint.action,
                        duration: Number(event.target.value),
                      })
                    }
                  />
                </label>
              </div>
            ))}
            {pointActions.length > 0 && (
              <p className="path-note">
                {duration !== undefined && Number.isFinite(actionSeconds)
                  ? `${(duration + actionSeconds).toFixed(1)} seconds total · `
                  : ""}
                Saves movement and point actions as separate sequence clips for
                playback and export. After saving, edit each clip separately;
                this combined route is not kept as one editable action.
              </p>
            )}
          </section>
        ) : (
          <p className="path-note">
            Point actions are unavailable on a dialogue route: this route must
            stay timed to the spoken line.
          </p>
        )}
        <details className="path-coordinates">
          <summary>Fine-tune the points</summary>
          <p className="muted small">
            Across and along use the map’s directions. The starting point stays
            linked to the previous action.
          </p>
          {points.slice(1).map((point, i) => (
            <div className="path-coordinate" key={waypoints[i + 1].id}>
              <span>{i + 1}</span>
              {([0, 2] as const).map((axis) => (
                <label key={axis}>
                  {axis === 0 ? "Across" : "Along"}
                  <input
                    type="number"
                    step=".25"
                    aria-label={`Point ${i + 1} ${axis === 0 ? "across" : "along"}`}
                    value={Number(point[axis].toFixed(2))}
                    onFocus={() => setSelectedId(waypoints[i + 1].id)}
                    onChange={(event) => {
                      const next = [...point] as Point;
                      next[axis] = Number(event.target.value);
                      move(
                        waypoints[i + 1].id,
                        next,
                        `input:${waypoints[i + 1].id}:${axis}`,
                      );
                    }}
                  />
                </label>
              ))}
              <button
                className="icon-button"
                aria-label={`Remove point ${i + 1}`}
                onClick={() => remove(i + 1)}
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </details>
        <p className="path-note">
          Planned routes leave room around the objects and backdrop geometry
          shown here, and face the destination on arrival. Saving here keeps
          your chosen waypoints, including when editing an automatic AI route.
          Replan this saved path after moving furniture, and check moving
          objects before playback.
        </p>
        <div className="path-footer">
          {confirming ? (
            <div
              className="path-confirm"
              role="alertdialog"
              aria-label="Discard changes to this path?"
            >
              <span>Discard changes to this path?</span>
              <button
                className="secondary"
                autoFocus
                onClick={() => setConfirming(false)}
              >
                Keep editing
              </button>
              <button className="danger-button" onClick={onClose}>
                <Trash2 size={15} /> Discard
              </button>
            </div>
          ) : (
            <>
              <button className="secondary" onClick={requestClose}>
                Cancel
              </button>
              <button
                className="primary"
                disabled={
                  points.length < 2 ||
                  !name.trim() ||
                  gait.status !== "ready" ||
                  duration === undefined ||
                  !Number.isFinite(duration) ||
                  duration < 0.2 ||
                  duration > 60 ||
                  invalidAction ||
                  !!problem
                }
                onClick={submit}
              >
                <Footprints size={16} />{" "}
                {speechDuration
                  ? "Use for this line"
                  : motion
                    ? "Save path"
                    : "Add to sequence"}
              </button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
