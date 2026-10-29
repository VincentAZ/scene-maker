"""Convert the verified Kenney Furniture Pack OBJ sources to local GLBs/previews.
blender -b --factory-startup --disable-autoexec --threads 4 --python-exit-code 1
  --python scripts/prepare-furniture-library.py -- <source-directory> [source-name]
"""
import bpy
import json
import sys
import hashlib
import shutil
import math
from pathlib import Path
from mathutils import Vector, Matrix

args = sys.argv[sys.argv.index("--") + 1:]
source_dir = Path(args[0])
out = Path("public/library/furniture")
out.mkdir(parents=True, exist_ok=True)
catalogue = json.loads(Path("shared/furniture-catalogue.json").read_text())
manifest = []
for collection, entries in catalogue.items():
    for source, name in entries:
        if len(args) > 1 and source != args[1]: continue
        slug = "".join("-" + c.lower() if c.isupper() else c for c in source)
        file = source_dir / "Models" / (source + ".obj")
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.wm.obj_import(filepath=str(file.resolve()), forward_axis="NEGATIVE_Z", up_axis="Y")
        meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
        points = [o.matrix_world @ v.co for o in meshes for v in o.data.vertices]
        low = Vector(tuple(min(p[i] for p in points) for i in range(3)))
        high = Vector(tuple(max(p[i] for p in points) for i in range(3)))
        origin = Vector(((low.x + high.x) / 2, (low.y + high.y) / 2, low.z))
        colored = set()
        for obj in meshes:
            obj.data.transform(Matrix.Rotation(math.pi, 4, "Z") @ Matrix.Scale(.2, 4) @ Matrix.Translation(-origin) @ obj.matrix_world)
            obj.matrix_world = Matrix.Identity(4)
            for mat in obj.data.materials:
                if mat and mat.use_nodes and mat not in colored:
                    colored.add(mat)
                    rgba = tuple(mat.diffuse_color)
                    linear = tuple(c / 12.92 if c <= .04045 else ((c + .055) / 1.055) ** 2.4 for c in rgba[:3]) + (rgba[3],)
                    mat.diffuse_color = linear
                    mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = linear
                    mat.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = .8
        bpy.context.view_layer.update()
        bpy.ops.export_scene.gltf(filepath=str((out / (slug + ".glb")).resolve()), export_format="GLB", export_animations=False)
        size = (high - low) * .2
        center = Vector((0, 0, size.z / 2))
        extent = max(size.length, .1)
        bpy.ops.object.camera_add(location=center + Vector((1.4, -2, 1.3)) * extent)
        camera = bpy.context.object
        camera.rotation_euler = (center - camera.location).to_track_quat("-Z", "Y").to_euler()
        camera.data.type = "ORTHO"
        camera.data.ortho_scale = extent * 1.12
        scene = bpy.context.scene
        scene.camera = camera
        for offset, energy in [((2, -3, 4), 500), ((-3, -1, 2), 250), ((1, 2, 3), 350)]:
            bpy.ops.object.light_add(type="AREA", location=center + Vector(offset) * extent)
            light = bpy.context.object
            light.data.energy = energy * extent * extent
            light.data.size = extent * 3
            light.rotation_euler = (center - light.location).to_track_quat("-Z", "Y").to_euler()
        scene.world = bpy.data.worlds.new("Preview light")
        scene.world.use_nodes = True
        scene.world.node_tree.nodes["Background"].inputs[0].default_value = (.8, .85, .9, 1)
        scene.world.node_tree.nodes["Background"].inputs[1].default_value = .4
        scene.render.engine = "CYCLES"
        scene.cycles.samples = 12
        scene.cycles.use_denoising = True
        scene.render.film_transparent = True
        scene.render.resolution_x = scene.render.resolution_y = 320
        scene.render.resolution_percentage = 100
        scene.view_settings.view_transform = "AgX"
        scene.render.image_settings.file_format = "PNG"
        scene.render.image_settings.color_mode = "RGBA"
        scene.render.filepath = str((out / (slug + ".png")).resolve())
        bpy.ops.render.render(write_still=True)
        manifest.append({"source": source, "name": name, "collection": collection,
                         "source_sha256": hashlib.sha256(file.read_bytes()).hexdigest(),
                         "file": slug + ".glb", "dimensions_m": [round(size.x, 5), round(size.z, 5), round(size.y, 5)]})
shutil.copyfile(source_dir / "License.txt", out / "LICENSE.txt")
if len(args) == 1:
    Path("docs/furniture-sources.json").write_text(json.dumps({"source_url": "https://opengameart.org/content/furniture-kit",
        "download_url": "https://opengameart.org/sites/default/files/kenney_furniturePack.zip",
        "archive_sha256": hashlib.sha256((source_dir / "source.zip").read_bytes()).hexdigest(),
        "scale": .2, "forward_rotation_degrees": 180, "models": manifest}, indent=2) + "\n")
print("SCENE_MAKER_FURNITURE", len(manifest))
