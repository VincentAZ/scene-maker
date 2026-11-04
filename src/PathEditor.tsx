import { useMemo, useRef, useState, type PointerEvent } from "react";
import { Footprints, Plus, RotateCcw, Trash2 } from "lucide-react";
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
import { motionSource } from "../shared/motionLibrary";
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
  const [waypoints, setWaypoints] = useState<
    {
      id: string;
      point: Point;
      action?: Omit<PointAction, "pointIndex">;
    }[]
  >(() =>
    (
      motion?.path?.points.map((p) => pathToWorld(p, frame)) || [
        [...frame.position] as Point,
      ]
    ).map((point) => ({ id: uid(), point })),
  );
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
    [manualTime, setManualTime] = useState(!!motion);
  const [error, setError] = useState(""),
    [id] = useState(motion?.id || uid);
  const [destination, setDestination] = useState("");
  const [endHeading, setEndHeading] = useState(motion?.path?.endHeading);
  const [backward, setBackward] = useState(motion?.path?.backward ?? false);
  const svg = useRef<SVGSVGElement>(null),
    dragging = useRef<number | null>(null),
    suppressClick = useRef(false);
  const nearby = scene.entities.filter(
    (e) =>
      e.id !== actor.id &&
      e.visible &&
      Math.hypot(
        e.position[0] - frame.position[0],
        e.position[2] - frame.position[2],
      ) < 20,
  );
  const fitMap = (route: Point[]) => {
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
  const map = (p: Point) => [
    ((p[0] - bounds.x) / bounds.width) * 600,
    ((p[2] - bounds.z) / bounds.width) * 600,
  ];
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
  const duration = speechDuration ?? (manualTime ? seconds : pace);
  const drawn =
    compiled?.samples
      .map((s) => map(pathToWorld(s.point, frame)).join(","))
      .join(" ") || "";
  const pointAt = (
    event: PointerEvent<SVGSVGElement> | React.MouseEvent<SVGSVGElement>,
  ): Point => {
    const rect = svg.current!.getBoundingClientRect();
    return [
      bounds.x +
        Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) *
          bounds.width,
      frame.position[1],
      bounds.z +
        (Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) *
          bounds.width) /
          1.5,
    ];
  };
  const replace = (index: number, point: Point) =>
    setWaypoints((old) =>
      old.map((waypoint, i) =>
        i === index ? { ...waypoint, point } : waypoint,
      ),
    );
  const setAction = (
    index: number,
    action: Omit<PointAction, "pointIndex"> | undefined,
  ) =>
    setWaypoints((old) =>
      old.map((waypoint, i) =>
        i === index ? { ...waypoint, action } : waypoint,
      ),
    );
  const add = (point: Point) => {
    if (points.length >= 32) {
      setError("Use up to 31 points after the start.");
      return;
    }
    if (
      Math.hypot(point[0] - points.at(-1)![0], point[2] - points.at(-1)![2]) <
      0.05 * frame.scale
    )
      return;
    setWaypoints((old) => [...old, { id: uid(), point }]);
  };
  const submit = () => {
    try {
      if (gait.status !== "ready") {
        setError(
          gait.error || "Wait for the original gait to finish measuring.",
        );
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
  return (
    <Modal
      title={`Where should ${actor.name} go?`}
      wide
      onClose={onClose}
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
          Click the map to add points, or drag a numbered point.
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
                  setWaypoints(replanned);
                  setPlanNotice(
                    removed
                      ? `${removed} point action${removed === 1 ? " was" : "s were"} removed because those points are not on the new route. Unchanged points kept their actions.`
                      : "",
                  );
                  setBounds(fitMap(route));
                  setSmooth(planned.path!.smooth);
                  setBackward(planned.path!.backward ?? false);
                  setEndHeading(planned.path!.endHeading);
                  setName(planned.name);
                  setManualTime(false);
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
            {length.toFixed(1)} m · {points.length - 1} points
          </span>
        </div>
        <svg
          ref={svg}
          className="path-map"
          viewBox="0 0 600 400"
          preserveAspectRatio="none"
          role="img"
          aria-label={`Route map for ${actor.name}`}
          onClick={(event) => {
            if (suppressClick.current) {
              suppressClick.current = false;
              return;
            }
            add(pointAt(event));
          }}
          onPointerMove={(event) => {
            if (dragging.current !== null)
              replace(dragging.current, pointAt(event));
          }}
          onPointerUp={() => {
            dragging.current = null;
          }}
          onPointerCancel={() => {
            dragging.current = null;
          }}
        >
          <defs>
            <pattern
              id="path-grid"
              width={600 / bounds.width}
              height={600 / bounds.width}
              patternUnits="userSpaceOnUse"
            >
              <path
                d={`M ${600 / bounds.width} 0 L 0 0 0 ${600 / bounds.width}`}
                fill="none"
                stroke="#dfe5d7"
                strokeWidth=".7"
              />
            </pattern>
          </defs>
          <rect width="600" height="400" fill="url(#path-grid)" />
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
          {points.map((point, i) => {
            const [x, y] = map(point);
            return (
              <g
                key={waypoints[i].id}
                transform={`translate(${x} ${y})`}
                className={i ? "path-point" : "path-start"}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  suppressClick.current = true;
                  if (!i) return;
                  dragging.current = i;
                  svg.current!.setPointerCapture(event.pointerId);
                }}
              >
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
        </svg>
        <div className="path-map-actions">
          <button
            className="text-button"
            onClick={() =>
              add([points.at(-1)![0] + 1, frame.position[1], points.at(-1)![2]])
            }
            disabled={points.length >= 32}
          >
            <Plus size={14} /> Add point
          </button>
          <button
            className="text-button"
            onClick={() => {
              setWaypoints([{ id: uid(), point: [...frame.position] }]);
              setPlanNotice("");
            }}
            disabled={points.length < 2}
          >
            <RotateCcw size={14} /> Start over
          </button>
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
              <optgroup label="Recorded, stylized and imported gaits">
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
                        : candidate.sourceAssetId === motionSource.id
                          ? " · stylized"
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
                setManualTime(true);
                setSeconds(Number(event.target.value));
              }}
            />
          </label>
        </div>
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
        {locomotion.kind === "imported" &&
          naturalDuration !== undefined &&
          duration !== undefined &&
          duration > 0 && (
            <p className="path-note" role="status">
              Source playback: {Number((naturalDuration / duration).toFixed(4))}
              ×. Changing route duration changes this speed.
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
          {speechDuration === undefined && (
            <button
              className="text-button"
              disabled={gait.status !== "ready"}
              onClick={() => setManualTime(false)}
            >
              Use natural pace
            </button>
          )}
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
                    onChange={(event) => {
                      const next = [...point] as Point;
                      next[axis] = Number(event.target.value);
                      replace(i + 1, next);
                    }}
                  />
                </label>
              ))}
              <button
                className="icon-button"
                aria-label={`Remove point ${i + 1}`}
                onClick={() =>
                  setWaypoints((old) =>
                    old.filter((_, index) => index !== i + 1),
                  )
                }
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
          <button className="secondary" onClick={onClose}>
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
              invalidAction
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
        </div>
      </div>
    </Modal>
  );
}
