import { memo, useEffect, useRef, useState, type PointerEvent } from "react";
import { Footprints, MessageCircle, Plus } from "lucide-react";
import type { Command, Entity, Motion } from "../shared/scene";
import {
  DRAG_THRESHOLD,
  SNAP_PIXELS,
  clipStarts,
  dragEnd,
  formatRate,
  formatSeconds,
  pixelsToSeconds,
  snapMarkers,
  sourceEndMarker,
  stretchRate,
  trimStart,
} from "./timelineGeometry";

type Clip = Entity["clips"][number];
export type RetimeCommand = Extract<Command, { type: "retimeClip" }>;
export type TimelineTrackProps = {
  entity: Entity;
  index: number;
  total: number;
  /** Every character row, so Shift can snap to the others' cues. */
  cast: Entity[];
  motions: Map<string, Motion>;
  dialogueClips: Set<string>;
  selected: boolean;
  selectedClipId: string | null;
  /** Read when a drag needs it, so the row needn't re-render every frame. */
  playhead: { readonly current: number };
  /** False while a dialog or an action preview owns the keyboard. */
  shortcuts: boolean;
  onSelect: (entityId: string, clipId: string | null) => void;
  onAdd: (entityId: string) => void;
  onEditStart: () => void;
  onRetime: (command: RetimeCommand, edgeTime: number) => void;
  onEditPath: (entityId: string, clipId: string) => void;
  onRemoveClip: (entityId: string, clipId: string) => void;
  onDeselectClip: () => void;
};
type Edge = "start" | "end";
type Gesture = {
  pointerId: number;
  edge: Edge;
  clip: Clip;
  start: number;
  x: number;
  handle: HTMLElement;
  /** Set for a standalone recorded take, which can trim and stretch. */
  sourceDuration?: number;
  active: boolean;
};
type Preview = {
  clipId: string;
  duration: number;
  /** Seconds the clip's start moved while trimming into the recording. */
  shift: number;
  label: string;
  edgeFraction: number;
  edgeTime: number;
  command: RetimeCommand;
  changed: boolean;
};

const clipName = (clip: Clip, motions: Map<string, Motion>) =>
  clip.routeWait ? "Wait for clear route" : motions.get(clip.motionId)?.name;

/** The handle gesture: preview locally, commit once on release, so a drag is
 * one undo step. Window listeners cancel on Escape and when focus leaves. */
function clipDragging(options: {
  props: () => TimelineTrackProps;
  track: () => HTMLElement | null;
  onPreview: (preview: Preview | null) => void;
}) {
  let gesture: Gesture | null = null,
    preview: Preview | null = null,
    suppressClickUntil = 0;
  const show = (next: Preview | null) => {
    preview = next;
    options.onPreview(next);
  };
  const escape = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || !gesture) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    finish(false);
  };
  const blur = () => finish(false);
  const finish = (commit: boolean) => {
    const g = gesture;
    if (!g) return;
    gesture = null;
    window.removeEventListener("keydown", escape, true);
    window.removeEventListener("blur", blur);
    if (g.handle.hasPointerCapture(g.pointerId))
      g.handle.releasePointerCapture(g.pointerId);
    const result = preview;
    show(null);
    if (!g.active) return;
    // The click ending a drag must not reselect, nor its double-click open a path.
    suppressClickUntil = performance.now() + 500;
    if (commit && result?.changed)
      options.props().onRetime(result.command, result.edgeTime);
  };
  const down = (e: PointerEvent<HTMLElement>, clip: Clip, edge: Edge) => {
    if (e.button !== 0 || gesture) return;
    const { entity, motions } = options.props();
    const index = entity.clips.findIndex((c) => c.id === clip.id);
    if (index < 0) return;
    e.preventDefault();
    e.stopPropagation();
    const motion = motions.get(clip.motionId);
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    gesture = {
      pointerId: e.pointerId,
      edge,
      clip,
      start: clipStarts(entity.clips)[index],
      x: e.clientX,
      handle,
      sourceDuration:
        motion?.kind === "imported" && !motion.path
          ? motion.duration
          : undefined,
      active: false,
    };
    window.addEventListener("keydown", escape, true);
    window.addEventListener("blur", blur);
  };
  const move = (e: PointerEvent<HTMLElement>) => {
    const g = gesture;
    if (!g || e.pointerId !== g.pointerId) return;
    if (!g.active) {
      if (Math.abs(e.clientX - g.x) < DRAG_THRESHOLD) return;
      g.active = true;
      options.props().onEditStart();
    }
    e.preventDefault();
    const props = options.props();
    const width = options.track()?.getBoundingClientRect().width ?? 0;
    if (!width) return;
    const deltaSeconds = pixelsToSeconds(e.clientX - g.x, props.total, width);
    const tolerance = pixelsToSeconds(SNAP_PIXELS, props.total, width);
    const markers = snapMarkers({
      cast: props.cast,
      entityId: props.entity.id,
      total: props.total,
      playhead: props.playhead.current,
    });
    const { clip, start, sourceDuration } = g;
    const command = (changes: Partial<RetimeCommand>): RetimeCommand => ({
      type: "retimeClip",
      id: props.entity.id,
      clipId: clip.id,
      ...changes,
    });
    if (g.edge === "start") {
      const trim = trimStart({
        clip,
        start,
        sourceDuration: sourceDuration!,
        deltaSeconds,
        shift: e.shiftKey,
        markers,
        tolerance,
      });
      show({
        clipId: clip.id,
        duration: trim.duration,
        shift: trim.shift,
        label: [
          formatSeconds(trim.duration),
          `starts ${formatSeconds(trim.sourceStart)} into the recording`,
          trim.snapped && `snapped to ${trim.snapped}`,
        ]
          .filter(Boolean)
          .join(" · "),
        edgeFraction: (start + trim.shift) / props.total,
        edgeTime: start,
        command: command({
          duration: trim.duration,
          sourceStart: trim.sourceStart,
        }),
        changed: trim.shift !== 0,
      });
      return;
    }
    if (sourceDuration !== undefined)
      markers.push(sourceEndMarker(clip, start, sourceDuration));
    const { duration, snapped } = dragEnd({
      clip,
      start,
      deltaSeconds,
      shift: e.shiftKey,
      markers,
      tolerance,
    });
    // Alt stretches a take so its current frames fill the new length.
    const rate =
      e.altKey && sourceDuration !== undefined
        ? stretchRate(clip, sourceDuration, duration)
        : undefined;
    show({
      clipId: clip.id,
      duration,
      shift: 0,
      label: [
        formatSeconds(duration),
        rate !== undefined && formatRate(rate),
        snapped && `snapped to ${snapped}`,
      ]
        .filter(Boolean)
        .join(" · "),
      edgeFraction: (start + duration) / props.total,
      edgeTime: start + duration,
      command: command({
        duration,
        ...(rate !== undefined ? { playbackRate: rate } : {}),
      }),
      changed:
        duration !== clip.duration ||
        (rate !== undefined && rate !== clip.playbackRate),
    });
  };
  const up = (e: PointerEvent<HTMLElement>) => {
    if (gesture?.pointerId !== e.pointerId) return;
    if (gesture.active) move(e);
    finish(true);
  };
  const cancel = (e: PointerEvent<HTMLElement>) => {
    if (gesture?.pointerId === e.pointerId) finish(false);
  };
  return {
    down,
    move,
    up,
    cancel,
    dispose: () => finish(false),
    suppressClick: () => performance.now() < suppressClickUntil,
  };
}

/** One character's row of the sequence. Memoized: the playhead re-renders
 * App every frame, and the rows only change with the scene or selection. */
export const TimelineTrack = memo(function TimelineTrack(
  props: TimelineTrackProps,
) {
  const {
    entity,
    index,
    total,
    motions,
    dialogueClips,
    selected,
    selectedClipId,
    shortcuts,
  } = props;
  const latest = useRef(props);
  latest.current = props;
  const track = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const drag = useRef<ReturnType<typeof clipDragging> | null>(null);
  if (!drag.current)
    drag.current = clipDragging({
      props: () => latest.current,
      track: () => track.current,
      onPreview: setPreview,
    });
  useEffect(() => () => drag.current!.dispose(), []);
  // The row owning the selected clip answers Delete, Backspace and Escape, so
  // the shortcut lives next to the chip it acts on.
  useEffect(() => {
    if (
      !shortcuts ||
      !selectedClipId ||
      !entity.clips.some((c) => c.id === selectedClipId)
    )
      return;
    const key = (e: KeyboardEvent) => {
      const target = e.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      )
        return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        latest.current.onRemoveClip(entity.id, selectedClipId);
      } else if (e.key === "Escape") latest.current.onDeselectClip();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [shortcuts, selectedClipId, entity]);
  const gestures = drag.current;
  const handle = (clip: Clip, edge: Edge) => (
    <span
      className={`clip-handle ${edge}`}
      aria-hidden="true"
      onPointerDown={(e) => gestures.down(e, clip, edge)}
      onPointerMove={gestures.move}
      onPointerUp={gestures.up}
      onPointerCancel={gestures.cancel}
      onLostPointerCapture={gestures.cancel}
    />
  );
  return (
    <div className={`track ${selected ? "selected" : ""}`}>
      <button
        className="track-character"
        onClick={() => props.onSelect(entity.id, null)}
      >
        <span style={{ background: entity.color }}>{entity.name[0]}</span>
        {entity.name}
      </button>
      <div className="track-clips" ref={track}>
        {entity.clips.map((c) => {
          const motion = motions.get(c.motionId);
          const live = preview?.clipId === c.id ? preview : undefined;
          const path = !!motion?.path && !c.routeWait;
          const take = motion?.kind === "imported" && !motion.path;
          const hints = c.routeWait
            ? ""
            : ` · Drag an edge to change its length${path ? " · Double-click to edit the path" : ""}`;
          const activate = () => {
            if (gestures.suppressClick()) return;
            props.onSelect(entity.id, c.id);
          };
          return (
            <div
              key={c.id}
              role="button"
              tabIndex={0}
              className={`clip clip-${index % 3}${selectedClipId === c.id ? " selected" : ""}${live ? " dragging" : ""}`}
              style={{
                width: `${((live?.duration ?? c.duration) / total) * 100}%`,
                ...(live?.shift
                  ? { marginLeft: `${(live.shift / total) * 100}%` }
                  : {}),
              }}
              onClick={activate}
              onDoubleClick={() => {
                if (gestures.suppressClick()) return;
                if (path) props.onEditPath(entity.id, c.id);
                else props.onSelect(entity.id, c.id);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  activate();
                }
              }}
              title={`${clipName(c, motions)} · ${Number(c.duration.toFixed(1))}s${!c.routeWait && c.playbackRate !== undefined ? ` · ${Number(c.playbackRate.toFixed(4))}×${c.legacyFit ? " (legacy fit)" : ""}` : ""}${hints}`}
            >
              {take && !c.routeWait && handle(c, "start")}
              {dialogueClips.has(`${entity.id}:${c.id}`) ? (
                <MessageCircle size={12} />
              ) : (
                <Footprints size={12} />
              )}
              {clipName(c, motions)}
              {!c.routeWait && handle(c, "end")}
            </div>
          );
        })}
        <button
          className="add-clip"
          aria-label={`Add action to ${entity.name}`}
          onClick={() => props.onAdd(entity.id)}
        >
          <Plus size={13} />
        </button>
        {preview && (
          <span
            className="clip-drag-label"
            style={{
              left: `${Math.min(1, Math.max(0, preview.edgeFraction)) * 100}%`,
            }}
          >
            {preview.label}
          </span>
        )}
      </div>
    </div>
  );
});
