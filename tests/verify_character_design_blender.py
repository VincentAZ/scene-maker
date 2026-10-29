"""Independently inspect an actual generated character against its starting GLB.
Usage: blender -b --python tests/verify_character_design_blender.py -- asset.json
Run from the repository root. No mocked engine or geometry.
"""
import bpy
import hashlib
import json
import sys
from pathlib import Path
from mathutils.kdtree import KDTree

asset = json.loads(Path(sys.argv[sys.argv.index("--") + 1]).read_text())
source = Path("public/library/quaternius") / (asset["design"]["baseId"].removeprefix("quaternius-") + ".glb")
original_hash = hashlib.sha256(source.read_bytes()).hexdigest()

def load(file):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(file.resolve()))
    rigs = [obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"]
    assert len(rigs) == 1
    bpy.context.view_layer.update()
    return rigs[0]

def body_signature():
    signatures = []
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH" or obj.name.startswith("wearable_") or not any(m.type == "ARMATURE" for m in obj.modifiers):
            continue
        for vertex in obj.data.vertices:
            weights = {obj.vertex_groups[g.group].name: g.weight for g in vertex.groups if g.weight > .00001}
            signatures.append((obj.matrix_world @ vertex.co, weights))
    return signatures

source_rig = load(source)
source_bones = {bone.name: source_rig.matrix_world @ bone.matrix_local for bone in source_rig.data.bones}
source_body = body_signature()
rig = load(Path(".data" + asset["url"]))
assert set(bone.name for bone in rig.data.bones) == set(source_bones)
bind_error = max(abs((rig.matrix_world @ bone.matrix_local)[i][j] - source_bones[bone.name][i][j])
                 for bone in rig.data.bones for i in range(4) for j in range(4))
assert bind_error < 1e-4, bind_error
generated_body = body_signature()
# GLB round trips may split material seams and introduce float rounding.
# Match both directions by position, then require identical skin influence.
body_error = 0
weight_error = 0
for first, second in [(source_body, generated_body), (generated_body, source_body)]:
    tree = KDTree(len(second))
    for i, (point, _) in enumerate(second): tree.insert(point, i)
    tree.balance()
    for point, weights in first:
        candidates = tree.find_range(point, 1e-4)
        assert candidates, "Body geometry moved"
        distance, error = min((distance, max(abs(weights.get(name, 0) - second[index][1].get(name, 0)) for name in set(weights) | set(second[index][1]))) for _, index, distance in candidates)
        body_error = max(body_error, distance)
        weight_error = max(weight_error, error)
assert weight_error < 1e-5, weight_error

wearables = [obj for obj in bpy.context.scene.objects if obj.type == "MESH" and obj.name.startswith("wearable_")]
assert len(wearables) == (5 if asset["design"]["glasses"] else 0) + (3 if asset["design"]["backpack"] else 0)
def coordinates(obj):
    bone = "head" if "glasses" in obj.name else "spine"
    assert any(m.type == "ARMATURE" and m.object == rig for m in obj.modifiers)
    assert all(len(v.groups) == 1 and obj.vertex_groups[v.groups[0].group].name == bone and abs(v.groups[0].weight - 1) < 1e-6 for v in obj.data.vertices)
    evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = evaluated.to_mesh()
    inverse = (rig.matrix_world @ rig.pose.bones[bone].matrix).inverted()
    points = [inverse @ evaluated.matrix_world @ v.co for v in mesh.vertices]
    evaluated.to_mesh_clear()
    return points

before = {obj.name: coordinates(obj) for obj in wearables}
for name, rotation in [("head", (.2, .35, -.3)), ("spine", (.5, .15, -.2))]:
    rig.pose.bones[name].rotation_mode = "XYZ"
    rig.pose.bones[name].rotation_euler = rotation
bpy.context.view_layer.update()
error = max(((a - b).length for obj in wearables for a, b in zip(before[obj.name], coordinates(obj))), default=0)
assert error < 1e-5, error
def linear(hex_color):
    return [c / 12.92 if c <= .04045 else ((c + .055) / 1.055) ** 2.4 for c in [int(hex_color[i:i+2], 16) / 255 for i in (1, 3, 5)]]
palette = [("Skin", asset["skin"]), ("Hair", asset["design"]["hairColor"]), ("Wearable accent", asset["design"]["accentColor"])]
if asset["design"]["baseId"] == "quaternius-casual-female":
    palette += [("Shirt", asset["color"]), ("Pants", asset["design"]["accentColor"])]
for name, color in palette:
    material = bpy.data.materials.get(name)
    if material:
        actual = material.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value[:3]
        assert max(abs(a - b) for a, b in zip(actual, linear(color))) < 1e-5, (name, actual)
assert hashlib.sha256(source.read_bytes()).hexdigest() == original_hash
assert Path(".data" + asset["thumbnail"]).read_bytes()[:8] == bytes([137, 80, 78, 71, 13, 10, 26, 10])
print(json.dumps({"name": asset["name"], "rig_bones": len(source_bones), "source_body_vertices": len(source_body), "generated_body_vertices": len(generated_body), "body_error_m": body_error, "skin_weight_error": weight_error, "bind_matrix_error": bind_error, "wearable_meshes": len(wearables), "attachment_error_m": error, "source_sha256": original_hash}, indent=2))
