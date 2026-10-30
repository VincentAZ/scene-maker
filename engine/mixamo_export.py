"""Export the mesh of a GLB as a single Mixamo-ready FBX (no armature).

Usage: blender --background --factory-startup --disable-autoexec --python-exit-code 1 \
  --python engine/mixamo_export.py -- input.glb output.fbx
Mixamo's auto-rigger wants one unrigged, Y-up mesh with embedded textures.
"""
import json
import sys

import bpy

source, destination = sys.argv[sys.argv.index("--") + 1 :]
bpy.ops.wm.read_factory_settings(use_empty=True)
try:
    bpy.ops.import_scene.gltf(filepath=source)
except Exception as error:  # noqa: BLE001
    print("ERROR could not read the model: %s" % error)
    sys.exit(1)

meshes = [o for o in bpy.data.objects if o.type == "MESH"]
if not meshes:
    print("ERROR no mesh geometry found")
    sys.exit(1)

# Freeze the rest pose into the mesh, then drop armatures and helpers.
for obj in meshes:
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    matrix = obj.matrix_world.copy()
    obj.parent = None
    obj.matrix_world = matrix
    obj.shape_key_clear() if obj.data.shape_keys else None
    for modifier in list(obj.modifiers):
        try:
            bpy.ops.object.modifier_apply(modifier=modifier.name)
        except RuntimeError:
            obj.modifiers.remove(modifier)
    obj.vertex_groups.clear()
for obj in list(bpy.data.objects):
    if obj.type != "MESH":
        bpy.data.objects.remove(obj, do_unlink=True)

bpy.ops.object.select_all(action="DESELECT")
for obj in meshes:
    obj.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1:
    bpy.ops.object.join()
body = bpy.context.view_layer.objects.active
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

for image in bpy.data.images:
    if image.users and not image.packed_file:
        try:
            image.pack()
        except RuntimeError:
            pass
    if image.users and not image.filepath_raw:
        image.filepath_raw = "//%s.png" % (image.name or "texture")

bpy.ops.export_scene.fbx(
    filepath=destination,
    use_selection=False,
    apply_scale_options="FBX_SCALE_ALL",
    object_types={"MESH"},
    bake_anim=False,
    path_mode="COPY",
    embed_textures=True,
    axis_forward="-Z",
    axis_up="Y",
)
dims = body.dimensions
print(
    "STATS "
    + json.dumps(
        {
            "faces": len(body.data.polygons),
            "vertices": len(body.data.vertices),
            "dimensions": [dims.x, dims.z, dims.y],
        }
    )
)
