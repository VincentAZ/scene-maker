"""Verify the browser's three-character library showcase in real Blender.
Pass the saved .blend and exported scene.json. No mocked engine or geometry.
"""
import bpy
import json
import math
import sys
from pathlib import Path
from mathutils import Vector

blend, definition = map(Path, sys.argv[sys.argv.index("--") + 1:])
scene = json.loads(definition.read_text())
bpy.ops.wm.open_mainfile(filepath=str(blend.resolve()))
actors = {actor["name"]: actor for actor in scene["entities"]}
assert set(actors) == {"Dr. Amara", "Harper", "Seraphine"}
roots = {name: bpy.data.objects["entity_" + actor["id"]] for name, actor in actors.items()}
rigs = {name: next(o for o in root.children_recursive if o.type == "ARMATURE") for name, root in roots.items()}
assert len([o for o in bpy.data.objects if o.type == "ARMATURE"]) == 3

def at(time):
    frame = time * 24
    bpy.context.scene.frame_set(int(frame), subframe=frame - int(frame))

def joint(name, bone):
    return rigs[name].matrix_world @ rigs[name].pose.bones[bone].matrix.translation

def skinned_points(name):
    points = []
    depsgraph = bpy.context.evaluated_depsgraph_get()
    for original in roots[name].children_recursive:
        if original.type != "MESH" or not any(m.type == "ARMATURE" for m in original.modifiers):
            continue
        evaluated = original.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh()
        points.extend(evaluated.matrix_world @ v.co for v in mesh.vertices)
        evaluated.to_mesh_clear()
    assert len(points) > 1000
    assert all(math.isfinite(c) for p in points for c in p)
    return points

at(0)
hips = {name: joint(name, "hips") for name in actors}
points = {name: skinned_points(name) for name in actors}
at(4)
travel_error = (joint("Dr. Amara", "hips") - hips["Dr. Amara"] - Vector((0, -2, 0))).length
assert travel_error < .001, travel_error
at(.5)
jump_height = joint("Seraphine", "hips").z - hips["Seraphine"].z
assert jump_height > .3, jump_height
at(.8)
deformation = {}
for name in actors:
    root_delta = joint(name, "hips") - hips[name]
    now = skinned_points(name)
    deformation[name] = max((a - b - root_delta).length for a, b in zip(now, points[name]))
    assert deformation[name] > .05, (name, deformation[name])
at(7)
held = {name: [rig.matrix_world @ bone.matrix for bone in rig.pose.bones] for name, rig in rigs.items()}
at(10)
hold_error = max(abs(a[i][j] - b[i][j]) for name, rig in rigs.items()
                 for a, b in zip(held[name], [rig.matrix_world @ bone.matrix for bone in rig.pose.bones])
                 for i in range(4) for j in range(4))
assert hold_error < .0001, hold_error
assert bpy.context.scene.render.fps == 24
print(json.dumps({"rigs": len(rigs), "travel_error_m": travel_error, "jump_height_m": jump_height,
                  "skin_deformation_m": deformation, "hold_matrix_error": hold_error,
                  "frame_end": bpy.context.scene.frame_end}, indent=2))
