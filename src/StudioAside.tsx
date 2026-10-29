import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Code2,
  PanelRightClose,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import { PanelResize } from "./PanelResize";

const panels = [
  { id: "assistant", label: "Assistant", icon: Sparkles },
  { id: "details", label: "Details", icon: SlidersHorizontal },
  { id: "code", label: "Code", icon: Code2 },
] as const;
type Panel = (typeof panels)[number]["id"];
const storageKey = "scene-maker-panel-widths-v1";

function readWidths(): Record<Panel, number> {
  const widths = { assistant: 350, details: 350, code: 420 };
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || "{}");
    for (const { id } of panels)
      if (typeof saved[id] === "number" && Number.isFinite(saved[id]))
        widths[id] = Math.max(290, Math.min(640, saved[id]));
  } catch {
    // Panels also resize when browser storage is unavailable.
  }
  return widths;
}

export function StudioAside({
  open,
  active,
  onSelect,
  onCollapse,
  children,
}: {
  open: boolean;
  active: Panel;
  onSelect: (panel: Panel) => void;
  onCollapse: () => void;
  children: ReactNode;
}) {
  const [widths, setWidths] = useState(readWidths);
  const activeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(widths));
    } catch {
      // Keep the current width for this session.
    }
  }, [widths]);
  const label = panels.find((panel) => panel.id === active)!.label;
  return (
    <aside
      className={`right-panel flexible-panel ${open ? "expanded" : "collapsed"}`}
      aria-label="Studio tools"
      style={{ width: open ? widths[active] : undefined }}
    >
      {open && (
        <PanelResize
          label={`Resize ${label} panel`}
          controls="studio-panel-content"
          width={widths[active]}
          max={640}
          onWidth={(width) =>
            setWidths((current) => ({ ...current, [active]: width }))
          }
        />
      )}
      <nav className="right-tabs" aria-label="Studio panels">
        {panels.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            ref={id === active ? activeButton : undefined}
            className={active === id ? "active" : ""}
            onClick={() => onSelect(id)}
            aria-expanded={open && active === id}
            aria-controls="studio-panel-content"
            title={open ? label : `Open ${label} panel`}
          >
            <Icon size={15} /> <span>{label}</span>
          </button>
        ))}
        {open && (
          <button
            className="panel-collapse"
            onClick={() => {
              onCollapse();
              activeButton.current?.focus();
            }}
            aria-label={`Collapse ${label} panel`}
            title="Collapse panel"
            aria-controls="studio-panel-content"
            aria-expanded={true}
          >
            <PanelRightClose size={17} />
          </button>
        )}
      </nav>
      <div
        id="studio-panel-content"
        className="right-panel-content"
        hidden={!open}
      >
        {children}
      </div>
    </aside>
  );
}
