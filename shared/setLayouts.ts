import type { Asset } from "./scene";

const prop = (
  assetId: string,
  x: number,
  y: number,
  z: number,
  rotation = 0,
  scale = 1,
) => ({
  assetId: "furniture-" + assetId,
  position: [x, y, z] as [number, number, number],
  rotation,
  scale,
});
export const setLayouts = [
  {
    id: "set-living-room",
    name: "Cozy living room",
    description:
      "A place for a quiet conversation, with a sofa, reading chair, and warm details.",
    props: [
      prop("lounge-sofa", 0, 0, -2),
      prop("table-coffee", 0, 0, -0.65),
      prop("lounge-chair", -2.2, 0, -0.8, Math.PI / 2),
      prop("rug-rectangle", 0, 0.005, -0.7, 0, 1.35),
      prop("lamp-round-floor", -1.65, 0, -2.4),
      prop("bookcase-open", 3.2, 0, -2.9),
      prop("potted-plant", -3.5, 0, -2.7),
      prop("books", 0.25, 0.46, -0.65),
      prop("side-table", 1.75, 0, -1.9),
      prop("plant-small2", 1.75, 0.76882, -1.9),
    ],
  },
  {
    id: "set-kitchen",
    name: "Open kitchen",
    description:
      "A working kitchen with appliances, counters, and a small breakfast table.",
    props: [
      prop("kitchen-cabinet", -2.58, 0, -2.8),
      prop("kitchen-cabinet-drawer", -1.72, 0, -2.8),
      prop("kitchen-sink", -0.86, 0, -2.8),
      prop("kitchen-stove", 0, 0, -2.8),
      prop("kitchen-fridge", 1, 0, -2.9),
      prop("kitchen-cabinet-upper", -2.58, 1.5, -3.05),
      prop("kitchen-cabinet-upper", -1.72, 1.5, -3.05),
      prop("kitchen-coffee-machine", -2.58, 0.9, -2.7),
      prop("kitchen-blender", -1.72, 0.9, -2.7),
      prop("table-round", 2.9, 0, -0.65),
      prop("chair-rounded", 2.9, 0, 0.5, Math.PI),
      prop("chair-rounded", 2.9, 0, -1.8),
      prop("trashcan", -3.6, 0, -2.8),
    ],
  },
  {
    id: "set-workspace",
    name: "Shared workspace",
    description:
      "Two workstations, storage, and an open space for the cast to meet.",
    props: [
      prop("desk", -2, 0, -2),
      prop("desk", 1.7, 0, -2),
      prop("chair-desk", -2, 0, -0.9, Math.PI),
      prop("chair-desk", 1.7, 0, -0.9, Math.PI),
      prop("computer-screen", -2, 0.769, -2.2),
      prop("computer-keyboard", -2, 0.769, -1.8),
      prop("computer-mouse", -1.5, 0.769, -1.8),
      prop("laptop", 1.7, 0.769, -2),
      prop("lamp-square-table", 2.2, 0.769, -2.1),
      prop("bookcase-closed-wide", -4, 0, -2.8),
      prop("potted-plant", 3.3, 0, -2.8),
      prop("coat-rack-standing", 4, 0, 0),
    ],
  },
  {
    id: "set-bedroom",
    name: "Bedroom at dawn",
    description:
      "A restful bedroom with bedside lights, a reading spot, and soft furnishings.",
    props: [
      prop("bed-double", 1.4, 0, -1.8),
      prop("cabinet-bed-drawer", -0.1, 0, -2.6),
      prop("cabinet-bed-drawer", 2.9, 0, -2.6),
      prop("lamp-round-table", -0.1, 0.5264, -2.6),
      prop("lamp-round-table", 2.9, 0.5264, -2.6),
      prop("rug-rounded", 1.4, 0.005, -0.1, 0, 1.3),
      prop("lounge-chair-relax", -2.4, 0, -1.7, 0.4),
      prop("bookcase-open-low", -3.7, 0, -3),
      prop("potted-plant", 3.9, 0, -2.8),
      prop("bear", -2.9, 0, -0.45, 0, 0.5),
    ],
  },
  {
    id: "set-packing-room",
    name: "Packing room",
    description:
      "A small warehouse work area with cartons, shelving, a packing desk, and a ladder.",
    props: [
      prop("desk", 0, 0, -2.6),
      prop("cardboard-box-open", -0.3, 0.769, -2.6),
      prop("books", 0.45, 0.769, -2.6),
      prop("bookcase-open", -3.6, 0, -2.9),
      prop("bookcase-open", -2.7, 0, -2.9),
      prop("cardboard-box-closed", 2.5, 0, -2.9),
      prop("cardboard-box-closed", 3, 0, -2.9),
      prop("cardboard-box-closed", 2.75, 0.562, -2.9),
      prop("cardboard-box-open", 2.8, 0, -1.4),
      prop("lamp-square-floor", -1.4, 0, -2.7),
      {
        assetId: "crate",
        position: [-3.5, 0, -1.1] as [number, number, number],
        rotation: 0,
        scale: 1,
      },
      {
        assetId: "ladder",
        position: [4, 0, -2.5] as [number, number, number],
        rotation: 0,
        scale: 1,
      },
    ],
  },
];
export const setAssets: Asset[] = setLayouts.map((layout) => ({
  id: layout.id,
  name: layout.name,
  category: "environments",
  style: "room",
  color: "#b7c49c",
  skin: "#bf8866",
  body: "mannequin",
  description: `${layout.description} ${layout.props.length} editable props.`,
}));
export const setLayout = (id: string) =>
  setLayouts.find((layout) => layout.id === id);
