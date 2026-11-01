import { useEffect, useState } from "react";
import type { Asset } from "../shared/scene";
import {
  bodyJointRoles,
  detailJointRoles,
  rigMappingSchema,
  type RigMapping,
} from "../shared/rigMapping";
import { loadImportedAsset } from "./importedAsset";
import { rigBoneInventory } from "./rigMapping";
import { disposeObject } from "./world";

export function RigMappingEditor({
  asset,
  onSave,
}: {
  asset: Asset;
  onSave: (mapping: RigMapping) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>Animation rig mapping</summary>
      {open && <MappingForm key={asset.id} asset={asset} onSave={onSave} />}
    </details>
  );
}
function MappingForm({
  asset,
  onSave,
}: {
  asset: Asset;
  onSave: (mapping: RigMapping) => void;
}) {
  const [draft, setDraft] = useState<RigMapping>(asset.rigMapping || {});
  const [bones, setBones] =
    useState<{ path: number[]; label: string; automatic?: string }[]>();
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [customRole, setCustomRole] = useState("");
  const [extras, setExtras] = useState<string[]>([]);
  useEffect(() => {
    setDraft(asset.rigMapping || {});
  }, [asset.rigMapping]);
  useEffect(() => {
    let cancelled = false;
    loadImportedAsset({ ...asset, rigMapping: undefined }).then(
      (group) => {
        try {
          if (cancelled) return;
          const root = group.userData.mixer.getRoot();
          const mapped = Object.entries(group.userData.bones);
          setBones(
            rigBoneInventory(root).map(({ bone, path, label }) => ({
              path,
              label,
              automatic: mapped.find(([, value]) => value === bone)?.[0],
            })),
          );
        } finally {
          disposeObject(group);
        }
      },
      (problem) => {
        if (!cancelled) setError(String(problem));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [asset.id, asset.url]);
  const row = (role: string) => (
    <label key={role} style={{ display: "block", marginBottom: 8 }}>
      {role.replace(/([A-Z])/g, " $1")}
      <select
        aria-label={`Map ${role}`}
        style={{ width: "100%" }}
        value={
          draft[role] === undefined
            ? "auto"
            : draft[role] === null
              ? "none"
              : draft[role].join("/")
        }
        onChange={(event) => {
          const value = event.target.value;
          setDraft((previous) => {
            const next = { ...previous };
            if (value === "auto") delete next[role];
            else
              next[role] =
                value === "none"
                  ? null
                  : value === ""
                    ? []
                    : value.split("/").map(Number);
            return next;
          });
          setError("");
          setSaved(false);
        }}
      >
        <option value="auto">
          Automatic
          {bones
            ? bones.find((bone) => bone.automatic === role)
              ? ` — ${bones.find((bone) => bone.automatic === role)!.label}`
              : " — not recognized"
            : ""}
        </option>
        <option value="none">Not mapped</option>
        {bones?.map((bone) => (
          <option key={bone.path.join("/")} value={bone.path.join("/")}>
            {bone.label} [{bone.path.join("/")}]
          </option>
        ))}
      </select>
    </label>
  );
  const standard = [...bodyJointRoles, ...detailJointRoles];
  const custom = [...new Set([...Object.keys(draft), ...extras])].filter(
    (role) => !standard.includes(role),
  );
  return (
    <div>
      <p className="muted small">
        Match your character’s joints to anatomical roles. Use the same roles on
        a motion source and its receiving character. Changes apply to this asset
        throughout this scene.
      </p>
      {bones &&
        bodyJointRoles.some(
          (role) =>
            draft[role] === undefined &&
            !bones.some((bone) => bone.automatic === role),
        ) && (
          <p className="muted small" role="note">
            Some body roles were not recognized from this skeleton’s joint
            names. Choose their joints below; unmapped body roles cannot receive
            or supply motion.
          </p>
        )}
      {!bones ? (
        !error && <p role="status">Reading skeleton…</p>
      ) : (
        <>
          {bodyJointRoles.map(row)}
          <details>
            <summary>Torso, shoulders, toes and fingers</summary>
            {detailJointRoles.map(row)}
          </details>
          <details>
            <summary>Additional joints</summary>
            <p className="muted small">
              For a twist, facial or other joint, give it the same role name on
              both rigs.
            </p>
            {custom.map(row)}
            <input
              aria-label="Additional joint role"
              value={customRole}
              onChange={(event) => setCustomRole(event.target.value)}
              placeholder="For example: leftForearmTwist"
            />
            <button
              type="button"
              onClick={() => {
                const role = customRole.trim();
                if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(role)) {
                  setError(
                    "Use a role beginning with a letter, followed by letters, numbers or underscores.",
                  );
                  return;
                }
                if (
                  [...standard, ...custom].some(
                    (name) => name.toLowerCase() === role.toLowerCase(),
                  )
                ) {
                  setError("That role already exists.");
                  return;
                }
                setExtras((previous) => [...previous, role]);
                setCustomRole("");
                setError("");
              }}
            >
              Add joint role
            </button>
          </details>
          <button
            type="button"
            onClick={() => {
              const result = rigMappingSchema.safeParse(draft);
              if (!result.success) {
                setError(result.error.issues[0].message);
                return;
              }
              onSave(result.data);
              setError("");
              setSaved(true);
            }}
          >
            Apply rig mapping
          </button>
          <button
            type="button"
            onClick={() => {
              setDraft({});
              setError("");
              setSaved(false);
            }}
          >
            Reset draft to automatic
          </button>
        </>
      )}
      {error && <p role="alert">{error}</p>}
      {saved && <p role="status">Rig mapping applied to this scene.</p>}
    </div>
  );
}
