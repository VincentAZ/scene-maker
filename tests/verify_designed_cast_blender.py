"""Verify the actual browser-created Cleo/Rook production export in Blender.
Pass scene.blend and scene.json after using engine/blender_import.py.
"""
import bpy
import json
import sys
from pathlib import Path

blend, definition = map(Path, sys.argv[sys.argv.index("--") + 1:])
scene = json.loads(definition.read_text())
bpy.ops.wm.open_mainfile(filepath=str(blend.resolve()))
actors = {actor["name"]: actor for actor in scene["entities"]}
assert set(actors) == {"Cleo", "Rook"}
roots = {name: bpy.data.objects["entity_" + actor["id"]] for name, actor in actors.items()}
rigs = {name: next(obj for obj in root.children_recursive if obj.type == "ARMATURE") for name, root in roots.items()}
assert len([obj for obj in bpy.data.objects if obj.type == "ARMATURE"]) == 2
wearables = [obj for obj in roots["Cleo"].children_recursive if obj.type == "MESH" and obj.name.startswith("wearable_")]
assert len(wearables) == 8

def at(time):
    frame = time * 24
    bpy.context.scene.frame_set(int(frame), subframe=frame - int(frame))

def points(obj, inverse=None):
    evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = evaluated.to_mesh()
    result = [evaluated.matrix_world @ vertex.co for vertex in mesh.vertices]
    evaluated.to_mesh_clear()
    return [inverse @ point for point in result] if inverse else result

def attached_points(obj):
    bone = rigs["Cleo"].pose.bones["head" if "glasses" in obj.name else "spine"]
    return points(obj, (rigs["Cleo"].matrix_world @ bone.matrix).inverted())

def body_points(name):
    return [point for obj in roots[name].children_recursive if obj.type == "MESH" and not obj.name.startswith("wearable_") and any(m.type == "ARMATURE" for m in obj.modifiers) for point in points(obj)]

at(0)
start = {obj.name: attached_points(obj) for obj in wearables}
body = {name: body_points(name) for name in actors}
hips = {name: rig.matrix_world @ rig.pose.bones["hips"].matrix.translation for name, rig in rigs.items()}
attachment_error = 0
for time in [.5, .8, 2.8, 4, 6, 0]:
    at(time)
    attachment_error = max(attachment_error, max((a - b).length for obj in wearables for a, b in zip(start[obj.name], attached_points(obj))))
assert attachment_error < .0001, attachment_error
at(.5)
jump = (rigs["Rook"].matrix_world @ rigs["Rook"].pose.bones["hips"].matrix.translation).z - hips["Rook"].z
assert jump > .3, jump
at(.8)
deformation = {}
for name, rig in rigs.items():
    delta = rig.matrix_world @ rig.pose.bones["hips"].matrix.translation - hips[name]
    deformation[name] = max((a - b - delta).length for a, b in zip(body_points(name), body[name]))
    assert deformation[name] > .05
assert bpy.context.scene.render.fps == 24
print(json.dumps({"rigs": len(rigs), "wearable_meshes": len(wearables), "attachment_error_m": attachment_error, "jump_height_m": jump, "skin_deformation_m": deformation, "frame_end": bpy.context.scene.frame_end}, indent=2))
