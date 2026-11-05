"""Blender: --background --factory-startup --disable-autoexec --python-exit-code 1
--python scripts/content/blender/blender_studio_export.py -- <character.blend> <work dir> <out.glb> [options.json]

Turn a Blender Studio character (a CloudRig film rig, studio.blender.org)
into the skinned, self-contained GLB the studio library expects:

- only the body, hair and clothing meshes the artists left visible, with their
  modelling modifiers (mirror, mask, solidify, lattices...) baked at the rest
  pose and subdivision at level 0, skinned to the character's one armature;
- the deform skeleton only (export_def_bones), re-parented into an anatomical
  chain (CloudRig hangs its deform bones from stretch controls, not from each
  other) and renamed to the Rigify DEF names the studio recognises;
- materials baked to 2K JPEG images (colour, roughness, normal where the
  shader has one) because film shaders use custom node groups no glTF viewer
  can read; a material that is already Principled + image textures keeps its
  images, shrunk to 2K;
- no animations, no shape keys, at most four weights per vertex.

The .blend is untrusted: it is opened with its scripts disabled and nothing
inside it ever runs. Progress lines are printed for the build log.
"""
import json
import math
import os
import re
import sys

import bpy
import numpy as np
from mathutils import Vector, kdtree
from mathutils.bvhtree import BVHTree

args = sys.argv[sys.argv.index("--") + 1:]
source, work, destination = args[:3]
options = json.loads(args[3]) if len(args) > 3 else {}
BAKE_SIZE = int(options.get("bakeSize", 2048))
BAKE_SAMPLES = 8
JPEG_QUALITY = 90
# Visible objects the library must not carry, by name (regular expressions).
SKIP = [re.compile(p, re.I) for p in options.get("skip", [])]
# Groomed hair (Blender's curves) becomes this many flat strips in all, split
# between the grooms by their strand counts, each strip sampled at this many
# points along its strand.
HAIR_STRANDS = int(options.get("hairStrands", 8000))
HAIR_POINTS = 6
# Viewport stand-ins for film-only hair or eyes, and film-only groom emitters.
STAND_IN = re.compile(r"viewport|proxy|preview|helper|deformer|cage|_anim$", re.I)
EMITTER = re.compile(r"groom|scalp|emitter", re.I)


def log(*parts):
    print("studio:", *parts, flush=True)


bpy.ops.wm.open_mainfile(filepath=source, load_ui=False, use_scripts=False)
scene = bpy.context.scene
view_layer = bpy.context.view_layer
if bpy.context.object and bpy.context.object.mode != "OBJECT":
    bpy.ops.object.mode_set(mode="OBJECT")


def select_only(objects):
    for o in view_layer.objects:
        o.select_set(o in objects)
    view_layer.objects.active = objects[0] if objects else None


def gpu_bake():
    """Cycles on the GPU when one is there: the bakes are then seconds."""
    prefs = bpy.context.preferences.addons["cycles"].preferences
    for backend in ("OPTIX", "CUDA", "HIP", "METAL", "ONEAPI"):
        try:
            prefs.compute_device_type = backend
        except TypeError:
            continue
        prefs.get_devices()
        if any(d.type == backend for d in prefs.devices):
            for d in prefs.devices:
                d.use = d.type == backend
            scene.cycles.device = "GPU"
            return backend
    scene.cycles.device = "CPU"
    return "CPU"


# ------------------------------------------------------- the rig and its meshes
def armature_users(rig):
    return [o for o in bpy.data.objects if o.type == "MESH"
            and any(m.type == "ARMATURE" and m.object == rig for m in o.modifiers)]


rigs = [o for o in bpy.data.objects if o.type == "ARMATURE"]
if not rigs:
    raise SystemExit("ERROR no armature in the file")
rig = max(rigs, key=lambda r: (len(armature_users(r)), sum(b.use_deform for b in r.data.bones)))
for other in rigs:
    other.data.pose_position = "REST"
    # Drivers only serve the animators' controls; renamed bones would make
    # them complain on every evaluation.
    other.animation_data_clear()
log("rig", rig.name, "deform bones", sum(b.use_deform for b in rig.data.bones))


def object_ancestors(obj):
    chain = []
    parent = obj.parent
    while parent is not None:
        chain.append(parent)
        parent = parent.parent
    return chain


SHAPED_BY = ("CURVE", "SHRINKWRAP", "SURFACE_DEFORM", "MESH_DEFORM", "LATTICE")


def belongs_to_rig(obj, seen=()):
    """Skinned, hooked or constrained to the rig, hanging from it, or shaped
    by something that is: a mouth line bent along a hooked guide curve, an
    eye white projected onto the head."""
    if obj is None or obj in seen:
        return False
    if any(m.type in ("ARMATURE", "HOOK") and m.object == rig for m in obj.modifiers):
        return True
    for c in obj.constraints:
        if getattr(c, "target", None) == rig or any(t.target == rig for t in getattr(c, "targets", [])):
            return True
    if rig in object_ancestors(obj):
        return True
    return any(belongs_to_rig(getattr(m, "object", None) or getattr(m, "target", None), (*seen, obj))
               for m in obj.modifiers if m.type in SHAPED_BY)


def renderable(obj):
    if obj.hide_render or all(c.hide_render for c in obj.users_collection):
        return False

    def excluded(layer):
        if layer.collection in obj.users_collection:
            return layer.exclude
        return any(excluded(child) for child in layer.children)

    return not excluded(view_layer.layer_collection)


def exportable(obj):
    """What the film shows: renderable meshes, plus the viewport stand-ins
    for things only a film renderer can draw (particle hair), minus the
    emitters and helpers behind them."""
    if obj.type == "MESH":
        if not len(obj.data.polygons):
            return False
    # The Settlers draw eyes, lashes and mouths with filled curves; a curve
    # without a material is a guide or a rig helper.
    elif obj.type != "CURVE" or not obj.data.splines or not any(s.material for s in obj.material_slots):
        return False
    if not belongs_to_rig(obj):
        return False
    if any(p.search(obj.name) for p in SKIP):
        return False
    viewport, render = obj.visible_get(), renderable(obj)
    if render and not viewport and (obj.particle_systems or EMITTER.search(obj.name)):
        return False
    if viewport and not render and STAND_IN.search(obj.name) and not re.search(r"hair", obj.name, re.I):
        return False
    return viewport or render


# Let the file's drivers settle first: they pick the outfit (Rain's scarf
# stays off) and hide detail parts in the viewport only (Einar's arm hoses,
# which renders still show).
view_layer.update()
meshes = [o for o in scene.objects if exportable(o)]
if not meshes:
    raise SystemExit("ERROR no visible mesh is skinned to " + rig.name)
log("meshes", ", ".join(o.name for o in meshes))


def control_weights(obj):
    """Rig bones an unskinned object follows, with their weights: hooks, a
    bone parent, an Armature constraint's targets, a Child Of or Copy
    Transforms constraint, on the object or the nearest object it hangs
    from."""
    for o in [obj, *object_ancestors(obj)]:
        pairs = [(m.subtarget, 1.0) for m in o.modifiers if m.type == "HOOK" and m.object == rig and m.subtarget]
        if o.parent == rig and o.parent_type == "BONE" and o.parent_bone:
            pairs.append((o.parent_bone, 1.0))
        for c in o.constraints:
            if c.type == "ARMATURE":
                pairs += [(t.subtarget, t.weight) for t in c.targets if t.target == rig and t.subtarget and t.weight > 0]
            elif getattr(c, "target", None) == rig and getattr(c, "subtarget", ""):
                pairs.append((c.subtarget, 1.0))
        if pairs:
            return pairs
    return []


def deform_target(obj):
    """The skinned mesh a part is glued to by a Surface or Mesh Deform, or
    projected onto by a Shrinkwrap."""
    return next((m.target for m in obj.modifiers
                 if m.type in ("SURFACE_DEFORM", "MESH_DEFORM", "SHRINKWRAP") and m.target and m.target.type == "MESH"),
                None)


# How each unskinned part followed the rig in the film, read before the
# modifiers go and the parts are re-parented to the armature.
controls = {obj: control_weights(obj) for obj in meshes}
original_parent = {obj: obj.parent for obj in meshes}
surface_of = {obj: deform_target(obj) for obj in meshes}
centres = {}
blank = bpy.data.materials.new("studio-blank")
blank.use_nodes = True


# ------------------------------------------------------------- groomed hair
def strand_samples(obj, depsgraph, keep):
    """Every step-th strand of an evaluated groom as (points, root radius) in
    world space, resampled to HAIR_POINTS points."""
    evaluated = obj.evaluated_get(depsgraph)
    data = evaluated.data
    if not hasattr(data, "curve_offset_data") or not len(data.curves):
        return [], None
    positions = np.empty(len(data.points) * 3, np.float32)
    data.position_data.foreach_get("vector", positions)
    positions = positions.reshape(-1, 3)
    offsets = np.empty(len(data.curve_offset_data), np.int32)
    data.curve_offset_data.foreach_get("value", offsets)
    radius = None
    attribute = data.attributes.get("radius")
    if attribute is not None and attribute.domain == "POINT":
        radius = np.empty(len(attribute.data), np.float32)
        attribute.data.foreach_get("value", radius)
    matrix = np.array(evaluated.matrix_world, dtype=np.float32)
    world = positions @ matrix[:3, :3].T + matrix[:3, 3]
    strands = []
    step = max(1, len(data.curves) // max(1, keep))
    for j in range(0, len(data.curves), step):
        start, end = int(offsets[j]), int(offsets[j + 1])
        if end - start < 2:
            continue
        index = np.linspace(start, end - 1, HAIR_POINTS).round().astype(int)
        strands.append((world[index], float(radius[start]) if radius is not None else 0.001))
    surface = obj.data.surface
    return strands, surface


grooms = [o for o in scene.objects if o.type == "CURVES" and o.visible_get() and belongs_to_rig(o)
          and len(o.data.curves) and not any(p.search(o.name) for p in SKIP)]
hair = []
if grooms:
    total = sum(len(o.data.curves) for o in grooms)
    depsgraph = bpy.context.evaluated_depsgraph_get()
    for obj in grooms:
        strands, surface = strand_samples(obj, depsgraph, round(HAIR_STRANDS * len(obj.data.curves) / total))
        if strands and surface is not None and surface.type == "MESH":
            hair.append((obj, strands, surface))
            log("groom", obj.name, len(strands), "of", len(obj.data.curves), "strands")
        else:
            log("left out", obj.name, "(groom without a surface)")

# Film-only parts live in hidden collections or are disabled in the viewport;
# the depsgraph only evaluates what it can see, so everything kept moves into
# one visible collection first.
export_collection = bpy.data.collections.new("studio-export")
scene.collection.children.link(export_collection)
for obj in [rig, *meshes]:
    for collection in obj.users_collection:
        collection.objects.unlink(obj)
    export_collection.objects.link(obj)
    obj.hide_viewport = obj.hide_render = False
    obj.hide_set(False)

# Rest pose everywhere, no shape key mix: the evaluated meshes below are then
# the neutral body with every modelling modifier baked in.
scene.frame_set(scene.frame_start)
for obj in meshes:
    # Film files drive detail parts' viewport visibility (Einar's jacket
    # pockets, his arm's hoses); the drivers would hide them again on every
    # update, and a hidden part neither evaluates nor exports.
    obj.animation_data_clear()
    if obj.data.users > 1:
        obj.data = obj.data.copy()
    if obj.data.shape_keys:
        for key in obj.data.shape_keys.key_blocks:
            key.value = 0.0
        obj.show_only_shape_key = False
    for m in obj.modifiers:
        if m.type == "ARMATURE":
            m.show_viewport = False
        elif m.type in ("SUBSURF", "MULTIRES"):
            m.levels = 0
            m.show_viewport = m.type == "SUBSURF"
        elif m.type in ("CORRECTIVE_SMOOTH", "SMOOTH", "LAPLACIANSMOOTH", "PARTICLE_SYSTEM", "DISPLACE"):
            m.show_viewport = False
view_layer.update()
depsgraph = bpy.context.evaluated_depsgraph_get()
kept = []
for obj in meshes:
    evaluated = obj.evaluated_get(depsgraph)
    mesh = bpy.data.meshes.new_from_object(evaluated, preserve_all_data_layers=True, depsgraph=depsgraph)
    if not len(mesh.polygons):
        # A guide curve, or a part the film masks away in this outfit.
        log("left out", obj.name, "(no faces at rest)")
        bpy.data.meshes.remove(mesh)
        continue
    mesh.name = "EXPORT-" + obj.name
    world = evaluated.matrix_world.copy()
    if obj.type == "CURVE":
        # The curve's shape becomes a mesh object of its own, which keeps
        # the name and what moved the curve in the film; the curve is left
        # behind with the rig's other helpers.
        curve, name = obj, obj.name
        curve.name = name + "-curve"
        # Slots may hold the materials on the object rather than the curve.
        mesh.materials.clear()
        for slot in curve.material_slots:
            mesh.materials.append(slot.material)
        obj = bpy.data.objects.new(name, mesh)
        export_collection.objects.link(obj)
        for table in (controls, original_parent, surface_of):
            table[obj] = table.pop(curve)
        # A filled curve faces the way it winds, so a mirrored eye or mouth
        # line can face into the head; it should face out of the surface it
        # was projected onto.
        surface = surface_of.get(obj)
        if surface is not None:
            inside = surface.matrix_world @ (sum((Vector(c) for c in surface.bound_box), Vector()) / 8)
            facing = world.to_3x3() @ sum((p.normal * p.area for p in mesh.polygons), Vector())
            middle = world @ (sum((v.co for v in mesh.vertices), Vector()) / len(mesh.vertices))
            if facing.dot(middle - inside) < 0:
                mesh.flip_normals()
    centres[obj] = world @ (sum((v.co for v in mesh.vertices), Vector()) / len(mesh.vertices))
    obj.modifiers.clear()
    obj.constraints.clear()
    obj.data = mesh
    obj.parent = rig
    obj.parent_type = "OBJECT"
    obj.matrix_parent_inverse.identity()
    obj.matrix_world = world
    obj.hide_render = obj.hide_viewport = False
    obj.hide_set(False)
    obj.modifiers.new("Armature", "ARMATURE").object = rig
    kept.append(obj)
meshes = kept


def pixels(image):
    data = np.empty(image.size[0] * image.size[1] * 4, dtype=np.float32)
    image.pixels.foreach_get(data)
    return data.reshape(image.size[1], image.size[0], 4)


def save(name, data, non_color, alpha=False):
    """Write a pixel array next to the GLB and load it back as a plain image
    file, which the exporter embeds as is (a JPEG stays a JPEG)."""
    h, w = data.shape[:2]
    image = bpy.data.images.new("tmp-" + name, w, h, alpha=alpha)
    if non_color:
        image.colorspace_settings.name = "Non-Color"
    image.pixels.foreach_set(np.ascontiguousarray(data, dtype=np.float32).ravel())
    path = os.path.join(work, name + (".png" if alpha else ".jpg"))
    image.file_format = "PNG" if alpha else "JPEG"
    image.save(filepath=path, quality=JPEG_QUALITY)
    bpy.data.images.remove(image)
    loaded = bpy.data.images.load(path)
    if non_color:
        loaded.colorspace_settings.name = "Non-Color"
    return loaded



def hair_palette(material):
    """The groom shader's colour ramp (dark roots to grey or blond tips), or a
    plain dark brown, as 256 linear colours."""
    ramp = next((n for n in tree_nodes(material.node_tree) if n.bl_idname == "ShaderNodeValToRGB"
                 and any(l.to_socket.name == "Base Color" for l in n.outputs["Color"].links)), None)
    if ramp is None:
        return np.array([[0.09, 0.05, 0.03, 1.0]] * 256, np.float32)
    return np.array([ramp.color_ramp.evaluate(t) for t in np.linspace(0.05, 0.95, 256)], np.float32)


def tree_nodes(tree, seen=None):
    seen = seen if seen is not None else set()
    for node in tree.nodes:
        yield node
        if node.bl_idname == "ShaderNodeGroup" and node.node_tree and node.node_tree not in seen:
            seen.add(node.node_tree)
            yield from tree_nodes(node.node_tree, seen)


def strip_mesh(name, strands, centre):
    """Flat strips along the strands, facing out from the head and tapering
    to the tip; u picks a palette colour per strand, v runs root to tip."""
    verts, faces, uvs = [], [], []
    for j, (points, radius) in enumerate(strands):
        width = min(0.004, max(0.0015, radius * 6))
        directions = np.diff(points, axis=0)
        directions = np.vstack([directions, directions[-1:]])
        u = (j * 0.6180339887) % 1.0
        base = len(verts)
        for i, point in enumerate(points):
            d = directions[i] / (np.linalg.norm(directions[i]) + 1e-9)
            r = point - centre
            side = np.cross(d, r / (np.linalg.norm(r) + 1e-9))
            side = side / (np.linalg.norm(side) + 1e-9) * width * (1 - i / (len(points) - 1)) ** 0.7 / 2
            verts += [tuple(point - side), tuple(point + side)]
            uvs += [(u, i / (len(points) - 1))] * 2
        for i in range(len(points) - 1):
            faces.append((base + 2 * i, base + 2 * i + 1, base + 2 * i + 3, base + 2 * i + 2))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    layer = mesh.uv_layers.new(name="UVMap")
    layer.data.foreach_set("uv", np.array([uvs[i] for poly in mesh.polygons for i in poly.vertices], np.float32).ravel())
    mesh.validate()
    return mesh


for groom, strands, surface in hair:
    bounds = [surface.matrix_world @ Vector(corner) for corner in surface.bound_box]
    centre = np.array(sum(bounds, Vector()) / 8, np.float32)
    obj = bpy.data.objects.new("HAIR-" + groom.name, strip_mesh("HAIR-" + groom.name, strands, centre))
    export_collection.objects.link(obj)
    obj.parent = rig
    material = bpy.data.materials.new("hair-" + groom.name)
    material.use_nodes = True
    material.use_backface_culling = False
    nodes, links = material.node_tree.nodes, material.node_tree.links
    bsdf = nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = 0.6
    bsdf.inputs["IOR"].default_value = 1.5
    palette = nodes.new("ShaderNodeTexImage")
    palette.image = save("studio-" + re.sub(r"[^A-Za-z0-9]+", "-", groom.name).lower() + "-palette",
                         np.repeat(hair_palette(groom.material_slots[0].material if groom.material_slots and groom.material_slots[0].material else blank)[None, :, :], 4, axis=0), False)
    links.new(palette.outputs["Color"], bsdf.inputs["Base Color"])
    obj.data.materials.append(material)
    # The strips take the scalp's weights, so they follow the head and face.
    surface_of[obj] = surface
    controls[obj] = []
    original_parent[obj] = None
    meshes.append(obj)
    bpy.data.objects.remove(groom)


# ------------------------------------------------------------- the skeleton
def weight_bones():
    """Deform bones some kept vertex is weighted to."""
    names = set()
    for obj in meshes:
        groups = {g.index: g.name for g in obj.vertex_groups}
        for v in obj.data.vertices:
            for g in v.groups:
                if g.weight > 1e-4 and g.group in groups:
                    names.add(groups[g.group])
    return {n for n in names if n in rig.data.bones and rig.data.bones[n].use_deform}


weighted = weight_bones()
SIDES = re.compile(r"^(.*?)[._-]([LR])$", re.I)


def split_side(name):
    """("Upperarm1", "L") for "DEF-Upperarm1.L"."""
    stem = re.sub(r"^DEF[-_]", "", name)
    m = SIDES.match(stem)
    return (m.group(1), m.group(2).upper()) if m else (stem, "")


def stem_key(stem):
    return re.sub(r"[\s_.-]", "", stem).lower()


def numbered(name):
    """("Spine", 2, "") for "DEF-Spine2", ("Index", 1, "L") for "DEF-Index1.L"."""
    stem, side = split_side(name)
    m = re.match(r"^(.*?)[_.]?(\d+)$", stem)
    return (m.group(1), int(m.group(2)), side) if m else None


# A role's bone, by name: "DEF-Upperarm1.L", "DEF-Knee_1.R", "DEF-Spine"...
ROLE_NAMES = {
    "hips": "pelvis|hips", "spine": "spine", "neck": "neck", "head": "head",
    "shoulder": "clavicle|shoulder|collar", "upper_arm": "upperarm|arm|humerus",
    "forearm": "forearm|lowerarm|elbow", "hand": "hand|wrist",
    "thigh": "thigh|upperleg|upleg", "shin": "shin|knee|calf|lowerleg|leg",
    "foot": "foot|ankle", "toe": "toe|toes", "eye": "eye|eyeball",
}
ROLE_PATTERNS = {role: rf"^({names})(1|01)?$" for role, names in ROLE_NAMES.items()}
SIDED = {"shoulder", "upper_arm", "forearm", "hand", "thigh", "shin", "foot", "toe", "eye"}
ROLE_TOKENS = {
    "hips": ["pelvis", "hips"], "spine": ["spine", "ribcage", "chest"], "shoulder": ["clavicle", "shoulder"],
    "upper_arm": ["upperarm"], "forearm": ["forearm", "elbow"], "hand": ["hand", "wrist"],
    "shin": ["shin", "knee", "calf"], "foot": ["foot", "ankle"],
}
RIGIFY_TORSO = {
    "hips": "DEF-spine", "spine": "DEF-spine.001", "chest": "DEF-spine.002",
    "upper_chest": "DEF-spine.003", "neck": "DEF-spine.004", "upper_neck": "DEF-spine.005",
    "head": "DEF-spine.006",
}


def name_words(stem):
    """["glasses", "handle"] for "Glasses_Handle", ["upper", "arm", "1"] for
    "UpperArm1"."""
    spaced = re.sub(r"(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Za-z])(?=\d)", " ", stem)
    return [w.lower() for w in re.split(r"[\s_.-]+", spaced) if w]


def mentions(stem, token):
    """Whether whole words of a name spell a token: "UpperArm" mentions
    "upperarm", while "Glasses_Handle" does not mention "hand"."""
    words = name_words(stem)
    return any("".join(words[i:j]) == token for i in range(len(words)) for j in range(i + 1, len(words) + 1))


def role_slot_for(name):
    """The role slot a bone or control name mentions: "upper_arm.L" for
    "FK-UpperArm.L", "forearm.R" for "DEF-COR-Forearm_Top.R"."""
    stem, side = split_side(name)
    key = stem_key(stem)
    for role in ROLE_PATTERNS:
        tokens = ROLE_TOKENS.get(role, [role])
        if role == "eye" and re.search(r"brow|lash|lid|dot", key):
            continue
        if any(mentions(stem, t) for t in tokens) and (side or role not in SIDED):
            return f"{role}.{side}" if role in SIDED else role
    return None


select_only([rig])
bpy.ops.object.mode_set(mode="EDIT")
ebones = rig.data.edit_bones
deform = [b for b in ebones if b.use_deform]
for b in deform:
    b.use_connect = False

# CloudRig hangs each deform bone from a stretch control, and the controls
# mirror the character's anatomy through ORG-, STR-, FK-... bones that keep
# the anatomical name. Read by those names, a finger's control chain leads to
# its carpal bone and a sleeve's to the forearm, where the first deform bone
# up the chain would be the shoulder the whole arm rig hangs from. The
# lookup uses the names the file gives, before any renaming.
CONTROL_PREFIX = re.compile(r"^(?:[A-Z]{1,6}[-_])+")
by_stem = {}
families = {}
for b in deform:
    by_stem.setdefault(CONTROL_PREFIX.sub("", b.name), b)
    parts = numbered(b.name)
    if parts:
        families.setdefault((parts[0], parts[2]), []).append((parts[1], b))


def deform_named(name, bone):
    """The deform bone a control's name stands for: DEF-<stem>, or the end
    of the numbered chain DEF-<stem>1, 2... (the link before `bone` when
    `bone` is in that chain)."""
    stem = CONTROL_PREFIX.sub("", name)
    found = by_stem.get(stem)
    if found is not None:
        return None if found == bone else found
    chain = sorted(families.get(split_side(stem), []), key=lambda pair: pair[0])
    mine = [n for n, b in chain if b == bone]
    if mine:
        chain = [(n, b) for n, b in chain if n < mine[0]]
    return chain[-1][1] if chain else None


def ancestors(bone):
    p = bone.parent
    while p is not None:
        yield p
        p = p.parent


def anatomical_parent(bone):
    for p in ancestors(bone):
        candidate = p if p.use_deform else deform_named(p.name, bone)
        if candidate is not None and candidate != bone and bone not in ancestors(candidate):
            return candidate
    return None

# Role bones by name; of several candidates the one carrying weight wins.
roles = {}
for b in deform:
    stem, side = split_side(b.name)
    key = stem_key(stem)
    for role, pattern in ROLE_PATTERNS.items():
        if (role in SIDED) != bool(side) or not re.match(pattern, key):
            continue
        slot = f"{role}.{side}" if side else role
        current = roles.get(slot)
        if current is None or (b.name in weighted and current.name not in weighted):
            roles[slot] = b


def chain_from(first):
    """A numbered deform chain, DEF-Spine1 > DEF-Spine2 > ..., as a list."""
    parts = numbered(first.name)
    if not parts:
        return [first]
    prefix, n, side = parts
    chain = [first]
    while True:
        n += 1
        nxt = [b for b in deform if numbered(b.name) == (prefix, n, side)]
        if not nxt:
            return chain
        chain.append(nxt[0])


chains ={slot: chain_from(b) for slot, b in roles.items()}
placed = set()


def rename(bone, name):
    if name in ebones and ebones[name] != bone:
        ebones[name].name = name + ".old"
    bone.name = name
    placed.add(bone)


# The torso, bottom to top: CloudRig names its torso bones Pelvis, Spine(1-3),
# RibCage, Chest, Neck, Head in one layout or another, chained to each other
# in older files and hung from controls in newer ones, so their height orders
# them. Rigify counts the chain from the hips.
TORSO = ["pelvis|hips", "spine", "ribcage", "chest|upperchest", "neck", "head"]


def torso_rank(bone):
    key = stem_key(split_side(bone.name)[0])
    return next((i for i, names in enumerate(TORSO) if re.match(rf"^({names})\d*$", key)), None)


if "head" not in roles:
    raise SystemExit(f"ERROR no head bone in {rig.name}: {sorted(roles)}")
head = roles["head"]
# Further head segments (Phileas's Head2, the top of a tall head) belong to
# the head, not to the spine the arms hang from.
torso = sorted((b for b in deform if torso_rank(b) is not None and torso_rank(b) < len(TORSO) - 1
                and not split_side(b.name)[1] and b != head),
               key=lambda b: (round(b.head.z, 2), torso_rank(b), b.name))
torso.append(head)
if len(torso) < 2:
    raise SystemExit(f"ERROR no torso chain in {rig.name}: {sorted(roles)}")
hips = torso[0]
necks = [b for b in torso[1:-1] if torso_rank(b) == 4]
spines = [b for b in torso[1:-1] if b not in necks]
for lower, upper in zip(torso, torso[1:]):
    upper.parent = lower
hips.parent = None
rename(hips, RIGIFY_TORSO["hips"])
labels = {1: ["spine"], 2: ["spine", "upper_chest"]}.get(len(spines), ["spine", "chest", "upper_chest"])
for b, label in zip(spines, labels):
    rename(b, RIGIFY_TORSO[label])
for b, label in zip(necks, ["neck", "upper_neck"]):
    rename(b, RIGIFY_TORSO[label])
rename(head, RIGIFY_TORSO["head"])
chest = spines[-1] if spines else hips
if not necks and chest != hips:
    # A character drawn without a neck (Phil, Gabby, Lunte) gets a joint at
    # the base of the head that carries no skin, so a captured neck turns
    # the head there instead of being reported as lost.
    neck = ebones.new("neck")
    rename(neck, RIGIFY_TORSO["neck"])
    neck.use_deform = True
    neck.head = head.head.lerp(chest.head, 0.3)
    neck.tail = head.head
    neck.align_roll(head.z_axis)
    neck.parent = chest
    head.parent = neck
    necks = [neck]
    torso.insert(-1, neck)
# Chain bones past the names above (a fourth spine) keep their names.
placed.update(torso)
roles["hips"] = hips
chains["hips"] = [hips]
chains["spine"] = spines or [hips]
chains["neck"] = necks or [chest]

# Limbs: each segment chain hangs from the end of the previous role's chain.
PREVIOUS = {"upper_arm": "shoulder", "forearm": "upper_arm", "hand": "forearm",
            "shin": "thigh", "foot": "shin", "toe": "foot"}
for side in ("L", "R"):
    for part in ("shoulder", "upper_arm", "forearm", "hand", "thigh", "shin", "foot", "toe"):
        slot = f"{part}.{side}"
        if slot not in roles:
            if part not in ("shoulder", "toe"):
                log("missing", slot)
            continue
        if part == "shoulder":
            parent = chest
        elif part == "thigh":
            parent = hips
        else:
            previous = chains.get(f"{PREVIOUS[part]}.{side}")
            parent = previous[-1] if previous else (chest if part in ("upper_arm", "forearm", "hand") else hips)
        segments = chains[slot]
        segments[0].parent = parent
        for lower, upper in zip(segments, segments[1:]):
            upper.parent = lower
        for i, segment in enumerate(segments):
            rename(segment, f"DEF-{part}.{side}" + (f".{i:03d}" if i else ""))
    if f"eye.{side}" in roles:
        roles[f"eye.{side}"].parent = head
        rename(roles[f"eye.{side}"], f"DEF-eye.{side}")


# Everything else (fingers, face, hair, correctives): numbered chains link
# up, Index1 > Index2; the base of each hangs from its anatomical parent or,
# failing that, from the role bone its name mentions on the same side, else
# from the nearest body role bone.
def role_by_name(bone):
    slot = role_slot_for(bone.name)
    return chains[slot][0] if chains.get(slot) else None


# Hosts for bones and parts nothing else places. Not the neck: the neck
# folds what hangs from it into itself, and a stray lip bone belongs to the
# head.
body_roles = [b for slot, b in roles.items() if not slot.startswith("eye") and slot != "neck"]


def segment_distance(point, head, tail):
    """How far a point lies from a bone's head-to-tail segment."""
    axis = tail - head
    t = max(0.0, min(1.0, (point - head).dot(axis) / max(axis.length_squared, 1e-12)))
    return (point - (head + axis * t)).length


def nearest_role(bone):
    return min(body_roles, key=lambda r: segment_distance(bone.head, r.head, r.tail))


for b in [b for b in deform if b not in placed]:
    parts = numbered(b.name)
    previous = [c for c in deform if parts and parts[1] > 1 and numbered(c.name) == (parts[0], parts[1] - 1, parts[2])]
    if previous and b not in ancestors(previous[0]):
        b.parent = previous[0]
        continue
    ancestor = anatomical_parent(b)
    b.parent = ancestor if ancestor is not None else (role_by_name(b) or nearest_role(b))
# Blender refuses a parent that would close a loop, and the exporter would
# make a bone still hanging from a control a root of its own that never
# moves; such a bone joins the body.
for b in deform:
    if b != hips and (b.parent is None or not b.parent.use_deform):
        b.parent = role_by_name(b) or nearest_role(b)


role_names = {slot: chains[slot][0].name if slot in chains else b.name for slot, b in roles.items()}
# Edit bones die with edit mode; the pruning below works by name.
placed_names = {b.name for b in placed}
chain_names = {slot: [b.name for b in chain] for slot, chain in chains.items()}
stem_names = {stem: b.name for stem, b in by_stem.items()}
family_names = {key: [b.name for _, b in sorted(members, key=lambda pair: pair[0])] for key, members in families.items()}
bpy.ops.object.mode_set(mode="OBJECT")
log("roles", json.dumps(role_names, sort_keys=True))


# Parts that were not skinned follow what moved them in the film: the deform
# bones behind the controls they were hooked, parented or constrained to
# (teeth, a prosthetic arm's plates); the skinned mesh a Surface Deform glued
# them to or the mesh they were parented to (pockets, buttons, bolts), whose
# nearest weights they take; or, failing all that, the nearest body bone.
def deform_for(control):
    """The deform bone behind a control: the one its own name stands for,
    the role its name mentions, else the first one its control chain
    leads to by name or by deforming."""
    stem = CONTROL_PREFIX.sub("", control)
    if stem in stem_names:
        return stem_names[stem]
    slot = role_slot_for(control)
    if slot in role_names:
        return role_names[slot]
    bone = rig.data.bones.get(control)
    while bone is not None:
        if bone.use_deform:
            return bone.name
        stem = CONTROL_PREFIX.sub("", bone.name)
        if stem in stem_names:
            return stem_names[stem]
        if family_names.get(split_side(stem)):
            return family_names[split_side(stem)][-1]
        bone = bone.parent
    return None


def deform_groups(obj):
    return {g.index: g.name for g in obj.vertex_groups if g.name in rig.data.bones and rig.data.bones[g.name].use_deform}


def has_weights(obj):
    if obj.type != "MESH":
        return False
    groups = deform_groups(obj)
    return any(g.group in groups and g.weight > 1e-4 for v in obj.data.vertices for g in v.groups)


def bind(obj, pairs):
    total = sum(w for _, w in pairs)
    for name, weight in pairs:
        group = obj.vertex_groups.get(name) or obj.vertex_groups.new(name=name)
        group.add(range(len(obj.data.vertices)), weight / total, "ADD")


def transfer_weights(obj, source):
    """Nearest-face weights from a skinned mesh, frozen into the part."""
    if source.name not in export_collection.objects:
        export_collection.objects.link(source)
    source.animation_data_clear()
    source.hide_viewport = source.hide_render = False
    source.hide_set(False)
    for group in source.vertex_groups:
        if group.name not in obj.vertex_groups:
            obj.vertex_groups.new(name=group.name)
    transfer = obj.modifiers.new("Weights", "DATA_TRANSFER")
    transfer.object = source
    transfer.use_vert_data = True
    transfer.data_types_verts = {"VGROUP_WEIGHTS"}
    transfer.vert_mapping = "POLYINTERP_NEAREST"
    transfer.layers_vgroup_select_src = "ALL"
    transfer.layers_vgroup_select_dst = "NAME"
    view_layer.update()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    obj.data = bpy.data.meshes.new_from_object(obj.evaluated_get(depsgraph), preserve_all_data_layers=True, depsgraph=depsgraph)
    obj.modifiers.clear()
    obj.modifiers.new("Armature", "ARMATURE").object = rig


surface_trees = {}


def touching_surface(obj, centre, reach=0.03):
    """The skinned mesh whose surface comes within `reach` of a point. The
    exported meshes are their rest shapes already, so their own data is
    what the surface looks like."""
    best, distance = None, reach
    for other in meshes:
        if other == obj or not has_weights(other):
            continue
        if other not in surface_trees:
            surface_trees[other] = BVHTree.FromPolygons(
                [other.matrix_world @ v.co for v in other.data.vertices],
                [tuple(p.vertices) for p in other.data.polygons])
        location, _, _, gap = surface_trees[other].find_nearest(centre, distance)
        if location is not None and gap < distance:
            best, distance = other, gap
    return best


def skin(obj, seen=()):
    if has_weights(obj):
        return True
    if obj in seen or obj.type != "MESH" or not len(obj.data.vertices):
        return False
    seen = (*seen, obj)
    pairs = [(deform_for(c), w) for c, w in (controls[obj] if obj in controls else control_weights(obj))]
    pairs = [(name, w) for name, w in pairs if name]
    if pairs:
        bind(obj, pairs)
        log("skinned", obj.name, "to", ", ".join(sorted({n for n, _ in pairs})))
        return True
    for source in (surface_of.get(obj, deform_target(obj)), original_parent.get(obj, obj.parent)):
        if source is not None and source != obj and skin(source, seen):
            transfer_weights(obj, source)
            # A helper can pass on nothing a deform bone carries.
            if has_weights(obj):
                log("skinned", obj.name, "like", source.name)
                return True
    centre = centres.get(obj) or obj.matrix_world @ (sum((v.co for v in obj.data.vertices), Vector()) / len(obj.data.vertices))
    if centre.length < 0.05:
        # Nothing places it: a leftover at the scene origin, between the feet.
        return False
    # A part resting on clothing or skin (a satchel's button) moves with it.
    host = touching_surface(obj, centre)
    if host is not None:
        transfer_weights(obj, host)
        if has_weights(obj):
            log("skinned", obj.name, "like", host.name, "(touching)")
            return True
    nearest = min((rig.data.bones[n] for slot, n in role_names.items() if not slot.startswith("eye") and slot != "neck"),
                  key=lambda b: segment_distance(centre, rig.matrix_world @ b.head_local,
                                                 rig.matrix_world @ b.tail_local)).name
    bind(obj, [(nearest, 1.0)])
    log("skinned", obj.name, "to", nearest, "(nearest)")
    return True


unplaced = [obj for obj in meshes if not skin(obj)]
for obj in unplaced:
    log("left out", obj.name, "(nothing moves it; it sits at the scene origin)")
    meshes.remove(obj)
    bpy.data.objects.remove(obj)


def fill_unweighted(obj):
    """Vertices no deform bone carries take the weights of the nearest one
    that is carried; the exporter would pin them to a still "neutral" bone
    (half a set of teeth left behind as the head turns)."""
    groups = deform_groups(obj)
    carried, loose = [], []
    for v in obj.data.vertices:
        (carried if any(g.group in groups and g.weight > 1e-4 for g in v.groups) else loose).append(v)
    if not loose or not carried:
        return
    tree = kdtree.KDTree(len(carried))
    for i, v in enumerate(carried):
        tree.insert(v.co, i)
    tree.balance()
    for v in loose:
        source = carried[tree.find(v.co)[1]]
        for g in source.groups:
            if g.group in groups:
                obj.vertex_groups[g.group].add([v.index], g.weight, "REPLACE")
    log("filled", obj.name, len(loose), "unweighted vertices")


for obj in meshes:
    fill_unweighted(obj)


def carrying_bone(obj):
    """The deform bone that carries most of a part's vertices."""
    groups = deform_groups(obj)
    tally = {}
    for v in obj.data.vertices:
        best = max((g for g in v.groups if g.group in groups), key=lambda g: g.weight, default=None)
        if best is not None:
            tally[groups[best.group]] = tally.get(groups[best.group], 0) + 1
    return max(tally, key=tally.get) if tally else None


# Some parts reach their place only through the film's pose (helpers that
# carry Einar's pockets, zip and arm hoses into position); at rest they
# lie in a heap by the feet, far from the upper-body bone that carries
# them. Whatever truly sits that low (boots, knee pads) hangs from a leg.
# A whole body or a pair of arms is mostly carried by many bones, so only
# the low parts are judged.
corners = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
floor = min(c.z for c in corners)
tall = max(c.z for c in corners) - floor
out_of_place = []
for obj in meshes:
    name = carrying_bone(obj)
    if name is None:
        continue
    middle = obj.matrix_world @ (sum((v.co for v in obj.data.vertices), Vector()) / len(obj.data.vertices))
    bone = rig.data.bones[name]
    gap = segment_distance(middle, rig.matrix_world @ bone.head_local, rig.matrix_world @ bone.tail_local) / tall
    if gap > 0.3 and middle.z - floor < tall / 3:
        out_of_place.append(obj)
for obj in out_of_place:
    log("left out", obj.name, "(only the film's pose puts it in place)")
    meshes.remove(obj)
    bpy.data.objects.remove(obj)


# Deform bones that carry no weight and hold none that does are dropped.
weighted = weight_bones()
select_only([rig])
bpy.ops.object.mode_set(mode="EDIT")
ebones = rig.data.edit_bones


def keeps(bone):
    return bone.name in weighted or bone.name in placed_names or any(keeps(c) for c in bone.children if c.use_deform)


for b in [b for b in ebones if b.use_deform]:
    if not keeps(b):
        ebones.remove(b)

# The studio drives one rigid bone per limb segment, and composes a
# capture's wrist into the hand only when the forearm holds nothing else, so
# CloudRig's second limb segments and corrective bones fold their weights
# into the limb bone they hang from; the neck likewise keeps only the head.
SEGMENT = re.compile(r"^DEF-(upper_arm|forearm|thigh|shin)\.[LR]\.\d{3}$")
folds = []


def fold_into(bone, target):
    for child in bone.children:
        if not child.use_deform or (child.name in placed_names and not SEGMENT.match(child.name)):
            continue
        folds.append((child.name, target.name))
        fold_into(child, target)


for slot, names in chain_names.items():
    if slot.partition(".")[0] in ("shoulder", "upper_arm", "forearm", "thigh", "shin", "neck"):
        fold_into(ebones[names[0]], ebones[names[0]])
bpy.ops.object.mode_set(mode="OBJECT")
for obj in meshes:
    for name, target in folds:
        lower = obj.vertex_groups.get(name)
        if lower is None:
            continue
        upper = obj.vertex_groups.get(target) or obj.vertex_groups.new(name=target)
        for v in obj.data.vertices:
            weight = sum(g.weight for g in v.groups if g.group == lower.index)
            if weight > 0:
                upper.add([v.index], weight, "ADD")
        obj.vertex_groups.remove(lower)
if folds:
    select_only([rig])
    bpy.ops.object.mode_set(mode="EDIT")
    for name, _ in folds:
        rig.data.edit_bones.remove(rig.data.edit_bones[name])
    bpy.ops.object.mode_set(mode="OBJECT")
    log("folded", len(folds), "bones into their limbs")
log("joints", sum(b.use_deform for b in rig.data.bones))


# ----------------------------------------------------------------- materials
def surface_node(mat):
    out = mat.node_tree.get_output_node("CYCLES") or mat.node_tree.get_output_node("ALL")
    link = out.inputs["Surface"].links[0] if out and out.inputs["Surface"].links else None
    return link.from_node if link else None


def is_simple(mat):
    """Principled fed by plain image textures: the exporter reads it as is."""
    allowed = {"ShaderNodeBsdfPrincipled", "ShaderNodeTexImage", "ShaderNodeNormalMap",
               "ShaderNodeOutputMaterial", "NodeFrame", "NodeReroute"}
    nodes = list(mat.node_tree.nodes)
    if any(n.bl_idname not in allowed for n in nodes):
        return False
    bsdf = surface_node(mat)
    if not bsdf or bsdf.bl_idname != "ShaderNodeBsdfPrincipled":
        return False
    return all(n.image and n.image.source == "FILE" for n in nodes if n.bl_idname == "ShaderNodeTexImage")


def shader_leaves(node, seen=None):
    """The shaders a Mix/Add shader tree ends in."""
    seen = seen if seen is not None else set()
    if node is None or node in seen:
        return set()
    seen.add(node)
    if node.bl_idname in ("ShaderNodeAddShader", "ShaderNodeMixShader"):
        return set().union(*(shader_leaves(l.from_node, seen)
                             for i in node.inputs if i.type == "SHADER" for l in i.links))
    return {node}


def clear_shader(node):
    if node.bl_idname == "ShaderNodeBsdfPrincipled":
        transmission = node.inputs.get("Transmission Weight") or node.inputs.get("Transmission")
        return transmission is not None and not transmission.links and transmission.default_value >= 0.5
    return node.bl_idname in ("ShaderNodeBsdfRefraction", "ShaderNodeBsdfGlass", "ShaderNodeBsdfTransparent",
                              "ShaderNodeBsdfAnisotropic", "ShaderNodeBsdfGlossy")


def sees_through(mat):
    """A refractive or glass shell (a cornea) only ray tracing can draw. A
    material with no shader at all renders black, like a film's lashes."""
    leaves = shader_leaves(surface_node(mat))
    return bool(leaves) and all(clear_shader(n) for n in leaves)


def translucent(mat):
    """Cut-outs and fades: a transparent shader, or a Principled alpha below one."""
    for node in tree_nodes(mat.node_tree):
        if node.bl_idname in ("ShaderNodeBsdfTransparent", "ShaderNodeHoldout"):
            return True
        if node.bl_idname == "ShaderNodeBsdfPrincipled":
            alpha = node.inputs["Alpha"]
            if alpha.links or alpha.default_value < 0.999:
                return True
    return False


def has_normal_detail(mat):
    return any(n.bl_idname in ("ShaderNodeNormalMap", "ShaderNodeBump") for n in tree_nodes(mat.node_tree))


ADDITIVE = {"ADD", "SCREEN", "LIGHTEN", "DODGE", "LINEAR_LIGHT", "SOFT_LIGHT", "OVERLAY"}


def adds_light(node, seen=None):
    """Whether a value flows into an additive mix (a highlight or rim laid
    over the colour) rather than one that shades the colour."""
    seen = seen if seen is not None else set()
    for output in node.outputs:
        for link in output.links:
            nxt = link.to_node
            if nxt in seen:
                continue
            seen.add(nxt)
            if nxt.bl_idname in ("ShaderNodeMix", "ShaderNodeMixRGB") and nxt.blend_type in ADDITIVE:
                return True
            if adds_light(nxt, seen):
                return True
    return False


def albedo_view():
    """Cycles' colour pass leaves out what a film shader draws as metal,
    skin scattering, transmission or a coat, so those surfaces would bake
    black (a gold chain, an earring, lips); EEVEE's Shader to RGB toon
    lighting reads as black in Cycles too. For the bakes every Principled
    surface turns plain diffuse, and each toon light reads as fully lit,
    or as nothing when it adds a highlight or rim on top. A bake looks at
    each point along its normal, so a shader that follows the view (a
    painted pupil's parallax) is shown the character from the front, as
    the characters face -Y."""
    trees = [m.node_tree for m in bpy.data.materials if m.use_nodes and m.node_tree]
    trees += [g for g in bpy.data.node_groups if g.bl_idname == "ShaderNodeTree"]
    for tree in trees:
        for node in list(tree.nodes):
            if node.bl_idname == "ShaderNodeBsdfPrincipled":
                for name in ("Metallic", "Subsurface Weight", "Transmission Weight", "Coat Weight", "Sheen Weight"):
                    socket = node.inputs.get(name)
                    if socket is None:
                        continue
                    for link in list(socket.links):
                        tree.links.remove(link)
                    socket.default_value = 0.0
            elif node.bl_idname == "ShaderNodeNewGeometry" and node.outputs["Incoming"].links:
                front = tree.nodes.new("ShaderNodeCombineXYZ")
                front.inputs["Y"].default_value = -1.0
                sockets = [link.to_socket for link in node.outputs["Incoming"].links]
                for link in list(node.outputs["Incoming"].links):
                    tree.links.remove(link)
                for socket in sockets:
                    tree.links.new(front.outputs[0], socket)
            elif node.bl_idname == "ShaderNodeShaderToRGB":
                level = 0.0 if adds_light(node) else 1.0
                constant = tree.nodes.new("ShaderNodeRGB")
                constant.outputs[0].default_value = (level, level, level, 1.0)
                opaque = tree.nodes.new("ShaderNodeValue")
                opaque.outputs[0].default_value = 1.0
                for output, replacement in ((node.outputs["Color"], constant.outputs[0]),
                                            (node.outputs["Alpha"], opaque.outputs[0])):
                    sockets = [link.to_socket for link in output.links]
                    for link in list(output.links):
                        tree.links.remove(link)
                    for socket in sockets:
                        tree.links.new(replacement, socket)


EYE = re.compile(r"(^|[^a-z])eye(s|ball)?([^a-z]|$)(?!.*(brow|lash|lid|dot))", re.I)

for obj in meshes:
    if not obj.material_slots:
        obj.data.materials.append(blank)
    for slot in obj.material_slots:
        if slot.material is None or not slot.material.use_nodes:
            slot.material = blank
for obj in list(meshes):
    if all(sees_through(s.material) for s in obj.material_slots):
        reason = "see-through shader"
    elif len(obj.data.polygons) <= 8 and all(translucent(s.material) for s in obj.material_slots):
        reason = "shader card"
    else:
        continue
    log("left out", obj.name, f"({reason})")
    meshes.remove(obj)
    bpy.data.objects.remove(obj)


# --- UV layer choice and UDIM tiles -------------------------------------
def uv_quality(obj, layer):
    """(overlap ratio, coverage) of a UV layer on a coarse grid: a bake needs
    the layer whose islands do not overlap."""
    n = 128
    counts = np.zeros(n * n, dtype=np.int32)
    uv = np.empty(len(obj.data.loops) * 2, dtype=np.float32)
    layer.data.foreach_get("uv", uv)
    uv = uv.reshape(-1, 2)
    for poly in obj.data.polygons:
        pts = uv[poly.loop_start:poly.loop_start + poly.loop_total]
        pts = pts - np.floor(pts.mean(axis=0))
        lo = np.clip(np.floor(pts.min(axis=0) * n), 0, n - 1).astype(int)
        hi = np.clip(np.ceil(pts.max(axis=0) * n), 1, n).astype(int)
        cells = np.unique(np.arange(lo[1], hi[1])[:, None] * n + np.arange(lo[0], hi[0])[None, :])
        counts[cells] += 1
    covered = np.count_nonzero(counts)
    return (np.count_nonzero(counts > 1) / max(1, covered), covered)


def choose_uv(obj):
    usable = [l for l in obj.data.uv_layers if uv_area(obj, l) >= 1e-8] or list(obj.data.uv_layers)
    scored = {l.name: uv_quality(obj, l) for l in usable}
    return min(usable, key=lambda l: (round(scored[l.name][0], 2), -scored[l.name][1]))


def uv_area(obj, layer):
    uv = np.empty(len(obj.data.loops) * 2, dtype=np.float32)
    layer.data.foreach_get("uv", uv)
    uv = uv.reshape(-1, 2)
    area = 0.0
    for poly in obj.data.polygons:
        x, y = uv[poly.loop_start:poly.loop_start + poly.loop_total].T
        area += abs(float(np.dot(x, np.roll(y, 1)) - np.dot(y, np.roll(x, 1)))) / 2
    return area


# A curve turned mesh, or a card, can carry UVs collapsed onto a line, which
# no bake can fill: such a part bakes into a fresh unwrap, while its shader
# keeps reading textures through the flat layer.
reads = {}
for obj in meshes:
    flat = [l.name for l in obj.data.uv_layers if uv_area(obj, l) < 1e-8]
    if obj.data.uv_layers and len(flat) < len(obj.data.uv_layers):
        continue
    if flat:
        reads[obj] = next((l.name for l in obj.data.uv_layers if l.active_render), flat[0])
        obj.data.uv_layers.active = obj.data.uv_layers.new(name="unwrapped")
    select_only([obj])
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.02)
    bpy.ops.object.mode_set(mode="OBJECT")
    log("unwrapped", obj.name)


def mesh_area(obj):
    s = obj.matrix_world.to_scale()
    return sum(p.area for p in obj.data.polygons) * abs(s.x * s.y)


def bake_size(area):
    return BAKE_SIZE if area >= 0.25 else BAKE_SIZE // 2 if area >= 0.02 else BAKE_SIZE // 4


class Target:
    """One baked material: a copy of the source with its own bake image node,
    and the baked image of every pass."""

    def __init__(self, material, tile, size):
        self.material, self.tile, self.size = material, tile, size
        self.copy = material.copy()
        self.copy.name = f"{material.name}@{tile[0]}{tile[1]}"
        self.node = self.copy.node_tree.nodes.new("ShaderNodeTexImage")
        self.images = {}
        self.result = None

    def bake_into(self, name, non_color):
        # Roughness and normal detail reads fine at half the colour's size.
        size = self.size if not non_color else max(256, self.size // 2)
        image = bpy.data.images.new(f"bake-{self.copy.name}-{name}", size, size, alpha=True)
        if non_color:
            image.colorspace_settings.name = "Non-Color"
        self.images[name] = image
        self.node.image = image
        self.copy.node_tree.nodes.active = self.node


targets = {}
bake_objects = []
for obj in meshes:
    if all(is_simple(s.material) for s in obj.material_slots):
        continue
    bake_objects.append(obj)
    layer = choose_uv(obj)
    layer_name = layer.name
    read_name = reads.get(obj, layer_name)
    size = bake_size(mesh_area(obj))
    uv = np.empty(len(obj.data.loops) * 2, dtype=np.float32)
    layer.data.foreach_get("uv", uv)
    uv = uv.reshape(-1, 2)
    # Every face moves into 0-1 on a new layer; the bake reads the source
    # textures through the original one. Faces on other tiles of a UDIM
    # material get a material of their own, while a repeating texture reads
    # the same on every tile, so its faces share one bake (a fringe with UVs
    # spread over hundreds of tiles would otherwise bake hundreds of images).
    originals = [s.material for s in obj.material_slots]
    udim = [any(n.bl_idname == "ShaderNodeTexImage" and n.image and n.image.source == "TILED"
                for n in tree_nodes(m.node_tree)) for m in originals]
    wrapped = uv.copy()
    combos = []
    index = np.empty(len(obj.data.polygons), dtype=np.int32)
    obj.data.polygons.foreach_get("material_index", index)
    index = np.minimum(index, len(obj.material_slots) - 1)
    new_index = index.copy()
    for poly in obj.data.polygons:
        span = slice(poly.loop_start, poly.loop_start + poly.loop_total)
        tile = tuple(int(t) for t in np.floor(uv[span].mean(axis=0)))
        wrapped[span] = uv[span] - tile
        slot = int(index[poly.index])
        combo = (slot, tile if udim[slot] else (0, 0))
        if combo not in combos:
            combos.append(combo)
        new_index[poly.index] = combos.index(combo)
    for i, (slot, tile) in enumerate(combos):
        key = (originals[slot].name, tile)
        if key not in targets:
            targets[key] = Target(originals[slot], tile, size)
        targets[key].size = max(targets[key].size, size)
        if i < len(obj.material_slots):
            obj.material_slots[i].material = targets[key].copy
        else:
            obj.data.materials.append(targets[key].copy)
    obj.data.polygons.foreach_set("material_index", new_index)
    # Layer references go stale as layers come and go: work by name.
    for name in [l.name for l in obj.data.uv_layers if l.name not in (layer_name, read_name)]:
        obj.data.uv_layers.remove(obj.data.uv_layers[name])
    obj.data.uv_layers.new(name="baked").data.foreach_set("uv", wrapped.ravel())
    obj.data.uv_layers[read_name].active_render = True

if targets:
    albedo_view()
    log("baking", len(targets), "materials on", gpu_bake())
    scene.render.engine = "CYCLES"
    scene.cycles.samples = BAKE_SAMPLES
    scene.cycles.use_denoising = False
    bake = scene.render.bake
    bake.margin = 8
    bake.margin_type = "EXTEND"
    bake.use_selected_to_active = False
    bake.target = "IMAGE_TEXTURES"
    bake.use_clear = True
    bake.use_pass_direct = bake.use_pass_indirect = False
    bake.use_pass_color = True
    bake.normal_space = "TANGENT"
    select_only(bake_objects)
    for name, kind, non_color in [("color", "DIFFUSE", False), ("emit", "EMIT", False),
                                  ("rough", "ROUGHNESS", True), ("normal", "NORMAL", True)]:
        for target in targets.values():
            target.bake_into(name, non_color)
        bpy.ops.object.bake(type=kind, pass_filter={"COLOR"} if kind == "DIFFUSE" else set(), uv_layer="baked")
        log("baked", name)
    for obj in bake_objects:
        for name in [l.name for l in obj.data.uv_layers if l.name != "baked"]:
            obj.data.uv_layers.remove(obj.data.uv_layers[name])
        obj.data.uv_layers["baked"].active = True
        obj.data.uv_layers["baked"].active_render = True


def rebuilt(target):
    material = bpy.data.materials.new(target.material.name)
    material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    nodes.clear()
    out = nodes.new("ShaderNodeOutputMaterial")
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    links.new(bsdf.outputs[0], out.inputs["Surface"])
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["IOR"].default_value = 1.5
    stem = re.sub(r"[^A-Za-z0-9]+", "-", target.copy.name).strip("-").lower()
    # Film shaders are lit by diffuse colour or, for toon looks, by emission.
    color = pixels(target.images["color"])
    emit = pixels(target.images["emit"])
    rgb = np.clip(color[:, :, :3] + emit[:, :, :3], 0, 1)
    cut_out = translucent(target.material)
    rgba = np.dstack([rgb, np.minimum(color[:, :, 3], 1) if cut_out else np.ones(rgb.shape[:2], np.float32)])
    tex = nodes.new("ShaderNodeTexImage")
    tex.image = save(stem + "-color", rgba, False, alpha=cut_out)
    links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    if cut_out:
        links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
    # Skin, cloth and hair never read as polished in a rasteriser; eyeballs
    # keep a wet gloss since their refractive cornea shell is left out.
    rough = pixels(target.images["rough"])[:, :, 0]
    rough = np.minimum(rough, 0.25) if EYE.search(target.material.name) else np.maximum(rough, 0.35)
    if rough.std() < 0.02:
        bsdf.inputs["Roughness"].default_value = float(rough.mean())
    else:
        # glTF packs roughness in G and metallic in B of one image; wiring
        # both from it lets the exporter embed the JPEG unchanged.
        packed = np.dstack([np.ones_like(rough), rough, np.zeros_like(rough), np.ones_like(rough)])
        rtex = nodes.new("ShaderNodeTexImage")
        rtex.image = save(stem + "-rough", packed, True)
        separate = nodes.new("ShaderNodeSeparateColor")
        links.new(rtex.outputs["Color"], separate.inputs["Color"])
        links.new(separate.outputs["Green"], bsdf.inputs["Roughness"])
        links.new(separate.outputs["Blue"], bsdf.inputs["Metallic"])
    if has_normal_detail(target.material):
        normal = pixels(target.images["normal"])
        if np.abs(normal[:, :, :3] - [0.5, 0.5, 1.0]).max() > 0.08:
            ntex = nodes.new("ShaderNodeTexImage")
            ntex.image = save(stem + "-normal", normal, True)
            nmap = nodes.new("ShaderNodeNormalMap")
            links.new(ntex.outputs["Color"], nmap.inputs["Color"])
            links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    return material


for target in targets.values():
    target.result = rebuilt(target)
for obj in bake_objects:
    for slot in obj.material_slots:
        for target in targets.values():
            if slot.material == target.copy:
                slot.material = target.result

# Materials the exporter can read keep their images, shrunk to the bake size
# (half of it for roughness and normal detail).
for obj in meshes:
    if obj in bake_objects:
        continue
    for slot in obj.material_slots:
        for node in slot.material.node_tree.nodes:
            image = node.image if node.bl_idname == "ShaderNodeTexImage" else None
            if image is None or image.name.startswith("studio-"):
                continue
            targets_detail = any(l.to_node.bl_idname == "ShaderNodeNormalMap"
                                 or l.to_socket.name in ("Roughness", "Metallic", "Specular IOR Level")
                                 for l in node.outputs["Color"].links)
            limit = BAKE_SIZE // 2 if targets_detail else BAKE_SIZE
            if max(image.size) > limit:
                image.scale(min(limit, image.size[0]), min(limit, image.size[1]))
            data = pixels(image)
            non_color = image.colorspace_settings.name == "Non-Color"
            has_alpha = bool(node.outputs["Alpha"].links) and bool((data[:, :, 3] < 0.99).any())
            node.image = save("studio-" + re.sub(r"[^A-Za-z0-9]+", "-", image.name).lower(), data, non_color, has_alpha)

# ------------------------------------------------------------------ export
for obj in list(scene.objects):
    if obj != rig and obj not in meshes:
        bpy.data.objects.remove(obj)
rig.data.pose_position = "REST"
rig.hide_viewport = rig.hide_render = False
rig.hide_set(False)
select_only([rig, *meshes])
bpy.ops.export_scene.gltf(
    filepath=destination, export_format="GLB", use_visible=False,
    export_apply=False, export_def_bones=True, export_rest_position_armature=True,
    export_skins=True, export_all_influences=False, export_influence_nb=4,
    export_morph=False, export_animations=False, export_image_format="AUTO",
    export_jpeg_quality=JPEG_QUALITY, export_extras=False, export_cameras=False,
    export_lights=False, export_yup=True, export_texcoords=True, export_normals=True,
    export_tangents=False, export_materials="EXPORT", export_vertex_color="NONE",
    export_unused_images=False, export_leaf_bone=False,
)
# Every part meant for the library must be in the file: an exporter that
# skips some would otherwise pass unnoticed.
with open(destination, "rb") as glb:
    head = glb.read(20)
    gltf = json.loads(glb.read(int.from_bytes(head[12:16], "little")))
exported = sum(1 for node in gltf.get("nodes", []) if "mesh" in node)
if exported != len(meshes):
    raise SystemExit(f"ERROR exported {exported} of {len(meshes)} parts")
log("exported", destination, "meshes", len(meshes), "baked", len(targets))
