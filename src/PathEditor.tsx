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
  type PathFrame,
} from "../shared/path";
import type { Point } from "../shared/ladder";

type Props = {
  scene: Scene;
  actor: Entity;
  frame: PathFrame;
  motion?: Motion;
  onSave: (motion: Motion) => void;
  onClose: () => void;
};
export function PathEditor({
  scene,
  actor,
  frame,
  motion,
  onSave,
  onClose,
}: Props) {
  const [points, setPoints] = useState<Point[]>(
    () =>
      motion?.path?.points.map((p) => pathToWorld(p, frame)) || [
        [...frame.position],
      ],
  );
  const [name, setName] = useState(motion?.name || `${actor.name}'s route`),
    [kind, setKind] = useState<"walk" | "run">(
      motion?.kind === "run" ? "run" : "walk",
    );
  const [smooth, setSmooth] = useState(motion?.path?.smooth ?? true),
    [seconds, setSeconds] = useState(motion?.duration || 6),
    [manualTime, setManualTime] = useState(!!motion);
  const [error, setError] = useState(""),
    [id] = useState(motion?.id || uid);
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
  const [bounds] = useState(() => {
    const visible = [...points, ...nearby.map((e) => e.position)];
    const minX =
      Math.min(frame.position[0] - 4, ...visible.map((p) => p[0])) - 2;
    const maxX =
      Math.max(frame.position[0] + 4, ...visible.map((p) => p[0])) + 2;
    const minZ =
      Math.min(frame.position[2] - 3, ...visible.map((p) => p[2])) - 2;
    const maxZ =
      Math.max(frame.position[2] + 3, ...visible.map((p) => p[2])) + 2;
    const width = Math.max(maxX - minX, (maxZ - minZ) * 1.5);
    return {
      x: (minX + maxX - width) / 2,
      z: (minZ + maxZ - width / 1.5) / 2,
      width,
    };
  });
  const map = (p: Point) => [
    ((p[0] - bounds.x) / bounds.width) * 600,
    ((p[2] - bounds.z) / bounds.width) * 600,
  ];
  const path = useMemo(
    () => ({
      points: points.map((p) => {
        const local = worldToPath(p, frame);
        local[1] = 0;
        return local;
      }),
      smooth,
    }),
    [points, frame, smooth],
  );
  const compiled = useMemo(
    () => (points.length > 1 ? compilePath(path) : null),
    [path, points.length],
  );
  const length = (compiled?.length || 0) * frame.scale;
  const pace = Math.max(
    0.5,
    Math.min(60, Math.round((length / (kind === "run" ? 2.6 : 1.1)) * 10) / 10),
  );
  const duration = manualTime ? seconds : pace;
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
    setPoints((old) => old.map((p, i) => (i === index ? point : p)));
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
    setPoints((old) => [...old, point]);
  };
  const submit = () => {
    try {
      const parsed = motionSchema.safeParse({
        id,
        name: name.trim(),
        kind,
        duration,
        distance: 0,
        poses: [],
        path,
      });
      if (!parsed.success) {
        setError(parsed.error.issues[0].message);
        return;
      }
      onSave(parsed.data);
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
          {motion
            ? "Shape this action’s route."
            : "This route starts after their current actions."}{" "}
          Click the map to add points, or drag a numbered point.
        </p>
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
                <text y="-18" textAnchor="middle">
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
                key={i}
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
                  fill={i ? "#f7faef" : "#d4e99b"}
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
            onClick={() => setPoints([[...frame.position]])}
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
            Movement
            <select
              value={kind}
              onChange={(event) =>
                setKind(event.target.value as "walk" | "run")
              }
            >
              <option value="walk">Walk</option>
              <option value="run">Run</option>
            </select>
          </label>
          <label>
            Duration (seconds)
            <input
              type="number"
              min=".2"
              max="60"
              step=".1"
              value={duration}
              onChange={(event) => {
                setManualTime(true);
                setSeconds(Number(event.target.value));
              }}
            />
          </label>
        </div>
        <div className="path-map-actions">
          <label className="path-smooth">
            <input
              type="checkbox"
              checked={smooth}
              onChange={(event) => setSmooth(event.target.checked)}
            />{" "}
            Smooth turns
          </label>
          <button className="text-button" onClick={() => setManualTime(false)}>
            Use natural pace
          </button>
        </div>
        <details className="path-coordinates">
          <summary>Fine-tune the points</summary>
          <p className="muted small">
            Across and along use the map’s directions. The starting point stays
            linked to the previous action.
          </p>
          {points.slice(1).map((point, i) => (
            <div className="path-coordinate" key={i}>
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
                  setPoints((old) => old.filter((_, index) => index !== i + 1))
                }
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </details>
        <p className="path-note">
          The route guides movement. Leave room around props; paths do not avoid
          obstacles automatically.
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
              !Number.isFinite(duration) ||
              duration < 0.2 ||
              duration > 60
            }
            onClick={submit}
          >
            <Footprints size={16} /> {motion ? "Save path" : "Add to sequence"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
