"""Customize a trusted bundled humanoid using validated design data.
The server supplies paths. No prompt or downloaded code is executed.
"""
import bpy
import json
import sys
from pathlib import Path
from math import pi
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).parent))
from character_preview import render_character_preview
from normalize_bind_scale import normalize_bind_scale

spec_path, output_path = sys.argv[sys.argv.index("--") + 1:]
spec = json.loads(Path(spec_path).read_text())
design = spec["design"]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=spec["templatePath"])
rigs = [obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"]
assert len(rigs) == 1, "The starting look must contain exactly one character rig."
rig = rigs[0]
bpy.context.view_layer.update()
body = [obj for obj in bpy.context.scene.objects if obj.type == "MESH" and any(m.type == "ARMATURE" for m in obj.modifiers)]

def linear_color(hex_color):
    values = [int(hex_color[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(value / 12.92 if value <= .04045 else ((value + .055) / 1.055) ** 2.4 for value in values) + (1,)

def paint(material, color):
    material.diffuse_color = linear_color(color)
    material.use_nodes = True
    material.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = linear_color(color)

base = design["baseId"]
if "doctor" in base: outfit, accent = {"Main"}, {"Black"}
elif "chef" in base: outfit, accent = {"Clothes", "Hat"}, {"Band"}
elif "worker" in base: outfit, accent = {"Vest"}, {"Hat"}
elif "suit" in base: outfit, accent = {"Black"}, {"Shirt"}
elif "cowboy" in base: outfit, accent = {"Jacket"}, {"Scarf"}
elif "pirate" in base: outfit, accent = {"Clothes"}, {"Red"}
elif "knight" in base: outfit, accent = {"Armor"}, {"Red"}
elif "kimono" in base: outfit, accent = {"Clothes"}, {"Band"}
elif any(name in base for name in ("witch", "wizard", "elf")): outfit, accent = {"Clothes"}, {"Hat"}
else: outfit, accent = {"Shirt"}, {"Pants"}
materials = {material for obj in body for material in obj.data.materials if material}
assert any(material.name in outfit for material in materials), "The starting look has no editable outfit."
for mat in materials:
    if mat.name == "Skin": paint(mat, spec["skin"])
    elif mat.name in ("Hair", "Moustache"): paint(mat, design["hairColor"])
    elif mat.name in outfit: paint(mat, spec["color"])
    elif mat.name in accent: paint(mat, design["accentColor"])
wearable_material = bpy.data.materials.new("Wearable accent")
paint(wearable_material, design["accentColor"])
wearable_material.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = .7

def bounds(points):
    assert points, "The starting look does not have the required fitting points."
    return [Vector(tuple(fn(point[i] for point in points) for i in range(3))) for fn in (min, max)]

def weighted_points(names):
    result = []
    for obj in body:
        groups = {group.index for group in obj.vertex_groups if group.name in names}
        result.extend(obj.matrix_world @ v.co for v in obj.data.vertices if sum(g.weight for g in v.groups if g.group in groups) > .5)
    return result

def attach(obj, bone, name):
    obj.name = name
    world = obj.matrix_world.copy()
    obj.parent = rig
    obj.matrix_world = world
    group = obj.vertex_groups.new(name=bone)
    group.add(list(range(len(obj.data.vertices))), 1, "REPLACE")
    obj.modifiers.new("Character skin", "ARMATURE").object = rig
    obj.data.materials.append(wearable_material)

def tube(points, radius, bone, name, closed=False):
    curve = bpy.data.curves.new(name, "CURVE")
    curve.dimensions = "3D"
    curve.bevel_depth = radius
    curve.bevel_resolution = 3
    spline = curve.splines.new("POLY")
    spline.points.add(len(points) - 1)
    for point, value in zip(spline.points, points): point.co = (*value, 1)
    spline.use_cyclic_u = closed
    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.convert(target="MESH")
    attach(bpy.context.object, bone, name)

if design["glasses"]:
    face = []
    for obj in body:
        material_ids = {i for i, mat in enumerate(obj.data.materials) if mat and mat.name == "Face"}
        indices = {i for polygon in obj.data.polygons if polygon.material_index in material_ids for i in polygon.vertices}
        face.extend(obj.matrix_world @ obj.data.vertices[i].co for i in indices)
    low, high = bounds(face)
    width = high.x - low.x
    middle, front = (low + high) / 2, low.y - width * .045
    rx, rz, radius = width * .23, (high.z - low.z) * .7, width * .025
    for side in (-1, 1):
        bpy.ops.mesh.primitive_torus_add(major_radius=1, minor_radius=radius / rx, major_segments=32, minor_segments=8,
                                       location=(middle.x + side * width * .28, front, middle.z), rotation=(pi / 2, 0, 0))
        obj = bpy.context.object
        obj.scale = (rx, rz, rx)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        attach(obj, "head", "wearable_glasses_" + str(side))
        tube([(middle.x + side * width * .51, front, middle.z), (middle.x + side * width * .65, front + width * .3, middle.z),
              (middle.x + side * width * .65, front + width * .65, middle.z - width * .07)], radius * .7, "head", "wearable_glasses_temple_" + str(side))
    tube([(middle.x - width * .05, front, middle.z), (middle.x + width * .05, front, middle.z)], radius, "head", "wearable_glasses_bridge")

if design["backpack"]:
    low, high = bounds(weighted_points({"hips", "pelvisHelper", "spine", "Torso"}))
    center = (low + high) / 2
    width, height = (high.x - low.x) * .65, (high.z - low.z) * .72
    depth = max(width, height) * .28
    back = high.y + depth * .4
    bpy.ops.mesh.primitive_cube_add(size=1, location=(center.x, back, center.z))
    obj = bpy.context.object
    obj.scale = (width, depth, height)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bevel = obj.modifiers.new("Soft bag edges", "BEVEL")
    bevel.width, bevel.segments = depth * .15, 3
    bpy.ops.object.modifier_apply(modifier=bevel.name)
    attach(obj, "spine", "wearable_backpack_bag")
    for side in (-1, 1):
        x = center.x + side * width * .38
        tube([(x, back, center.z - height * .35), (x, low.y - .03, center.z - height * .25),
              (x, low.y - .03, high.z), (x, back, high.z), (x, back, center.z - height * .35)],
             width * .045, "spine", "wearable_backpack_strap_" + str(side), True)

bpy.context.view_layer.update()
bpy.ops.export_scene.gltf(filepath=output_path, export_format="GLB", export_skins=True, export_animations=False, use_visible=True)
normalize_bind_scale(output_path)
render_character_preview(spec["previewPath"], rig)
print("SCENE_MAKER_CHARACTER", output_path)
