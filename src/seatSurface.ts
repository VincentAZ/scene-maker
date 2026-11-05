import * as T from "three";
import type { SeatProfile } from "../shared/seating";

/** Finds a model's sitting surface the way the content build measures the
 * library's chairs (scripts/content/props.mjs seat_surface): seen from above
 * on a 1 cm grid, the largest smooth, near-level patch between knee and table
 * height, with neighbouring cushions at the same height joined in. Measured
 * in the model's own frame, so the result is the asset's seat metadata. */
export function measureSeatSurface(
  object: T.Object3D,
  slope = 0.85,
): SeatProfile | undefined {
  object.updateMatrixWorld(true);
  const bounds = new T.Box3().setFromObject(object, true);
  if (bounds.isEmpty()) return;
  const step = 0.01;
  const columns = Math.ceil((bounds.max.x - bounds.min.x) / step) + 1;
  const rows = Math.ceil((bounds.max.z - bounds.min.z) / step) + 1;
  // The highest surface over each cell, and whether it is level enough.
  const top = new Float32Array(columns * rows).fill(-Infinity);
  const level = new Uint8Array(columns * rows);
  const a = new T.Vector3(),
    b = new T.Vector3(),
    c = new T.Vector3(),
    edge = new T.Vector3(),
    normal = new T.Vector3();
  object.traverse((node) => {
    const mesh = node as T.Mesh;
    if (!mesh.isMesh) return;
    const position = mesh.geometry.getAttribute("position");
    if (!position) return;
    const index = mesh.geometry.getIndex();
    const count = index ? index.count : position.count;
    const corner = (i: number, out: T.Vector3) =>
      mesh.localToWorld(mesh.getVertexPosition(index ? index.getX(i) : i, out));
    for (let i = 0; i + 2 < count; i += 3) {
      corner(i, a);
      corner(i + 1, b);
      corner(i + 2, c);
      normal.copy(b).sub(a).cross(edge.copy(c).sub(a));
      const length = normal.length();
      if (length < 1e-12) continue;
      const flat = Math.abs(normal.y / length) >= slope ? 1 : 0;
      const d = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
      if (Math.abs(d) < 1e-12) continue;
      const c0 = Math.max(
          0,
          Math.floor((Math.min(a.x, b.x, c.x) - bounds.min.x) / step),
        ),
        c1 = Math.min(
          columns - 1,
          Math.ceil((Math.max(a.x, b.x, c.x) - bounds.min.x) / step),
        ),
        r0 = Math.max(
          0,
          Math.floor((Math.min(a.z, b.z, c.z) - bounds.min.z) / step),
        ),
        r1 = Math.min(
          rows - 1,
          Math.ceil((Math.max(a.z, b.z, c.z) - bounds.min.z) / step),
        );
      for (let r = r0; r <= r1; r++) {
        const z = bounds.min.z + r * step;
        for (let col = c0; col <= c1; col++) {
          const x = bounds.min.x + col * step;
          const l0 = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / d;
          const l1 = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / d;
          const l2 = 1 - l0 - l1;
          if (l0 < -1e-6 || l1 < -1e-6 || l2 < -1e-6) continue;
          const y = l0 * a.y + l1 * b.y + l2 * c.y;
          const cell = r * columns + col;
          if (y > top[cell]) {
            top[cell] = y;
            level[cell] = flat;
          }
        }
      }
    }
  });
  // Smooth patches: level cells at sitting height, joined across steps of
  // less than 1.2 cm.
  const seen = new Uint8Array(columns * rows);
  const patches: { cells: number[]; area: number; height: number }[] = [];
  for (let start = 0; start < top.length; start++) {
    if (seen[start] || !level[start] || top[start] < 0.25 || top[start] > 0.9)
      continue;
    const cells = [start];
    seen[start] = 1;
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i],
        col = cell % columns,
        row = (cell - col) / columns;
      for (const [dc, dr] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nc = col + dc,
          nr = row + dr;
        if (nc < 0 || nc >= columns || nr < 0 || nr >= rows) continue;
        const next = nr * columns + nc;
        if (
          !seen[next] &&
          level[next] &&
          top[next] >= 0.25 &&
          top[next] <= 0.9 &&
          Math.abs(top[next] - top[cell]) < 0.012
        ) {
          seen[next] = 1;
          cells.push(next);
        }
      }
    }
    const area = cells.length * step * step;
    if (area >= 0.03)
      patches.push({
        cells,
        area,
        height: percentile(
          cells.map((i) => top[i]),
          0.5,
        ),
      });
  }
  if (!patches.length) return;
  const largest = patches.reduce((best, patch) =>
    patch.area > best.area ? patch : best,
  );
  const seat = [...largest.cells];
  for (const patch of patches)
    if (
      patch !== largest &&
      Math.abs(patch.height - largest.height) < 0.06 &&
      patch.area >= 0.25 * largest.area
    )
      seat.push(...patch.cells);
  const xs = seat.map((cell) => bounds.min.x + (cell % columns) * step),
    zs = seat.map((cell) => bounds.min.z + Math.floor(cell / columns) * step);
  const x0 = percentile(xs, 0.02),
    x1 = percentile(xs, 0.98),
    z0 = percentile(zs, 0.02),
    z1 = percentile(zs, 0.98);
  const cx = (x0 + x1) / 2;
  let cz = (z0 + z1) / 2;
  const near = seat.filter(
    (cell, i) => Math.hypot(xs[i] - cx, zs[i] - cz) < 0.1,
  );
  let height = percentile(
    (near.length ? near : seat).map((cell) => top[cell]),
    0.5,
  );
  // Exactly the surface under the centre; on a slatted seat, the nearest slat.
  const column = Math.round((cx - bounds.min.x) / step);
  for (const offset of [
    0,
    ...[1, 2, 3, 4, 5, 6, 7, 8].flatMap((k) => [k, -k]),
  ]) {
    const row = Math.round((cz + offset * 0.005 - bounds.min.z) / step);
    if (row < 0 || row >= rows) continue;
    const under = top[row * columns + column];
    if (Number.isFinite(under) && Math.abs(under - height) < 0.04) {
      cz += offset * 0.005;
      height = under;
      break;
    }
  }
  // A level patch under 20 cm either way (an armrest, a perch) is no seat;
  // 20 cm is also the least the seat metadata accepts.
  const width = x1 - x0 + step,
    depth = z1 - z0 + step;
  if (width < 0.2 || depth < 0.2) return;
  return { position: [cx, height, cz], width, depth };
}

function percentile(values: number[], q: number) {
  const sorted = [...values].sort((m, n) => m - n);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}
