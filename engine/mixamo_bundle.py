"""Merge Mixamo FBX downloads for one character into a single GLB with every animation.

blender --background --factory-startup --python engine/mixamo_bundle.py -- output.glb first.fbx [more.fbx ...]

The first FBX must be a "With Skin" download (skinned mesh + armature, optionally
one animation). Each further FBX carries one animation on the same Mixamo skeleton
(bone names like mixamorig:Hips) and may or may not include the skin. Every
animation is renamed after its file (Walking.fbx -> "Walking") and pushed onto an
NLA track of the first armature, which the glTF exporter ('ACTIONS' mode) writes as
one glTF animation per single-strip track. Object scales are left untouched: the
Mixamo armature usually imports at a uniform 0.01, which the studio accepts.
"""
import bpy
import json
import sys
from pathlib import Path


def fail(message):
    print("ERROR " + message, file=sys.stderr)
    sys.exit(1)


arguments = sys.argv[sys.argv.index("--") + 1:]
if len(arguments) < 2:
    fail("usage: mixamo_bundle.py -- output.glb first.fbx [more.fbx ...]")
output_path, first_path, *extra_paths = arguments
for path in [first_path] + extra_paths:
    if not Path(path).is_file():
        fail("FBX not found: " + path)


def import_fbx(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=path, use_anim=True, ignore_leaf_bones=False, automatic_bone_orientation=False)
    bpy.context.view_layer.update()
    return [obj for obj in bpy.data.objects if obj not in before]


def armature_actions(rig):
    """Actions driving this armature: the active one plus any already on NLA strips."""
    actions = []
    data = rig.animation_data
    if data is None:
        return actions
    if data.action is not None:
        actions.append((data.action, getattr(data, "action_slot", None)))
    for track in data.nla_tracks:
        for strip in track.strips:
            if strip.action is not None and strip.action not in [a for a, _ in actions]:
                actions.append((strip.action, getattr(strip, "action_slot", None)))
    return actions


def unique_name(base, taken):
    name, index = base, 1
    while name in taken:
        index += 1
        name = "%s %d" % (base, index)
    return name


bpy.ops.wm.read_factory_settings(use_empty=True)
imported = import_fbx(first_path)
rigs = [obj for obj in imported if obj.type == "ARMATURE"]
meshes = [obj for obj in imported if obj.type == "MESH"]
if not rigs:
    fail("the first FBX has no armature: " + first_path)
if not meshes:
    fail("the first FBX has no mesh (download it 'With Skin'): " + first_path)
if len(rigs) > 1:
    fail("the first FBX contains %d armatures; expected one" % len(rigs))
rig = rigs[0]
if not any(bone.name.startswith("mixamorig") for bone in rig.data.bones):
    print("WARNING no mixamorig bones found in " + first_path, file=sys.stderr)
rig_bones = {bone.name for bone in rig.data.bones}
skinned = [obj for obj in meshes if any(m.type == "ARMATURE" and m.object == rig for m in obj.modifiers)]
if not skinned:
    fail("the first FBX mesh is not skinned to its armature: " + first_path)

track_names = []


def push_to_track(action, slot, name):
    """Give the first armature a single-strip NLA track named `name` playing `action`."""
    if rig.animation_data is None:
        rig.animation_data_create()
    action.name = name
    action.use_fake_user = False
    track = rig.animation_data.nla_tracks.new()
    track.name = name
    start = int(round(action.frame_range[0]))
    strip = track.strips.new(name, start, action)
    strip.name = name
    if hasattr(strip, "action_slot"):
        # Blender 4.4+ slotted actions: the strip must point at the slot holding the bone curves.
        if slot is not None and slot in list(action.slots):
            strip.action_slot = slot
        elif strip.action_slot is None and len(action.slots) > 0:
            strip.action_slot = action.slots[0]
    track_names.append(name)


# The first file's own animation (Mixamo embeds one even on "T-Pose") becomes a track too.
first_name = Path(first_path).stem
for action, slot in armature_actions(rig):
    push_to_track(action, slot, unique_name(first_name, track_names))
if rig.animation_data is not None:
    rig.animation_data.action = None

for path in extra_paths:
    base = Path(path).stem
    objects = import_fbx(path)
    extra_rigs = [obj for obj in objects if obj.type == "ARMATURE"]
    if not extra_rigs:
        fail("no armature in " + path)
    actions = []
    for extra in extra_rigs:
        missing = {bone.name for bone in extra.data.bones} - rig_bones
        if missing:
            print("WARNING %s has %d bones unknown to the first skeleton (e.g. %s)" % (
                base, len(missing), sorted(missing)[0]), file=sys.stderr)
        actions.extend(armature_actions(extra))
        if extra.animation_data is not None:
            # Detach so deleting the object cannot drop the action's last user.
            extra.animation_data.action = None
    if not actions:
        fail("no animation found in " + path)
    for action, slot in actions:
        push_to_track(action, slot, unique_name(base, track_names))
    for obj in objects:
        data, collection = obj.data, {"MESH": bpy.data.meshes, "ARMATURE": bpy.data.armatures}.get(obj.type)
        bpy.data.objects.remove(obj, do_unlink=True)
        if data is not None and collection is not None and data.users == 0:
            collection.remove(data)
    bpy.context.view_layer.update()

bpy.context.scene.frame_set(0)
bpy.ops.object.select_all(action="DESELECT")
Path(output_path).parent.mkdir(parents=True, exist_ok=True)
# 'ACTIONS' writes one glTF animation (named after the action) per non-muted single-strip
# NLA track, plus the active action; we cleared the active action so tracks are the source.
bpy.ops.export_scene.gltf(
    filepath=output_path, export_format="GLB", export_animations=True,
    export_animation_mode="ACTIONS", export_image_format="AUTO", export_yup=True,
    export_skins=True, export_def_bones=False, export_frame_range=True,
    export_force_sampling=True, export_optimize_animation_size=False, export_apply=False,
)
if not Path(output_path).is_file() or Path(output_path).stat().st_size == 0:
    fail("export did not produce " + output_path)

print("STATS " + json.dumps({
    "animations": track_names,
    "bones": len(rig.data.bones),
    "meshes": len([obj for obj in bpy.context.scene.objects if obj.type == "MESH"]),
}))
