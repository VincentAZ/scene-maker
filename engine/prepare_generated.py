"""Clean an AI-generated GLB (Meshy, Tripo, ...) into a Scene Maker prop or character.

blender --background --factory-startup --python engine/prepare_generated.py -- spec.json input.glb output.glb output.fbx

The GLB is re-exported for the studio and the FBX (mesh only, textures embedded,
Y-up) is what gets uploaded to Mixamo for rigging. Only bpy is used.

Coordinates: Blender is Z-up, so "height" here is Blender Z and glTF depth (Z) is
Blender Y. Both exporters convert back to Y-up, and STATS dimensions are reported
in glTF order [x, y(height), z(depth)].
"""
import bmesh
import bpy
import json
import sys
from math import pi, radians
from pathlib import Path
from mathutils import Matrix, Vector


def fail(message):
    print("ERROR " + message, file=sys.stderr)
    sys.exit(1)


arguments = sys.argv[sys.argv.index("--") + 1:]
if len(arguments) != 4:
    fail("usage: prepare_generated.py -- spec.json input.glb output.glb output.fbx")
spec_path, input_path, output_glb, output_fbx = arguments
spec = json.loads(Path(spec_path).read_text())
category = spec.get("category", "props")
if category not in ("characters", "props"):
    fail("spec.category must be 'characters' or 'props'")
is_character = category == "characters"
target_height = float(spec.get("height", 1.75))
target_size = float(spec.get("maxSize", 1.0))
face_limit = int(spec.get("faceLimit", 30000 if is_character else 15000))
texture_size = int(spec.get("textureSize", 2048))
if (is_character and target_height <= 0) or (not is_character and target_size <= 0) or face_limit <= 0 or texture_size <= 0:
    fail("spec sizes and limits must be positive")

bpy.ops.wm.read_factory_settings(use_empty=True)
if not Path(input_path).is_file():
    fail("input GLB not found: " + input_path)
try:
    bpy.ops.import_scene.gltf(filepath=input_path)
except RuntimeError as error:
    # Blender's importer raises on malformed files (and on scenes without nodes).
    fail("could not import %s: %s" % (input_path, str(error).strip().splitlines()[-1]))
bpy.context.view_layer.update()

meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH" and len(obj.data.polygons) > 0]
if not meshes:
    fail("no mesh geometry found in " + input_path)

# Unparent meshes while keeping their world placement, then drop everything else
# (empties, cameras, lights, armatures): the generated model is expected to be unrigged.
for obj in meshes:
    world = obj.matrix_world.copy()
    obj.parent = None
    obj.matrix_world = world
for obj in list(bpy.context.scene.objects):
    if obj not in meshes:
        bpy.data.objects.remove(obj, do_unlink=True)
bpy.context.view_layer.update()

# Shape keys and modifiers would block or distort the join; a generated model needs neither.
for obj in meshes:
    if obj.data.shape_keys:
        obj.shape_key_clear()
    obj.modifiers.clear()
    obj.hide_set(False)
    obj.hide_viewport = False

bpy.ops.object.select_all(action="DESELECT")
for obj in meshes:
    obj.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1:
    bpy.ops.object.join()
model = bpy.context.view_layer.objects.active
model.name = "Model"
bpy.ops.object.select_all(action="DESELECT")
model.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
mesh = model.data

# The importer stores custom split normals; they are stale after cleanup and decimation.
if mesh.has_custom_normals:
    bpy.ops.mesh.customdata_custom_splitnormals_clear()


def clean(mesh, merge_distance):
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=merge_distance)
    bmesh.ops.delete(bm, geom=[edge for edge in bm.edges if not edge.link_faces], context="EDGES")
    bmesh.ops.delete(bm, geom=[vert for vert in bm.verts if not vert.link_edges], context="VERTS")
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()


clean(mesh, 1e-4)
if len(mesh.polygons) == 0:
    fail("mesh has no faces left after cleanup")

# Decimate (collapse keeps UVs) until the face budget is met; collapse output is
# approximate, so iterate a few times with a slightly tighter ratio each pass.
for _ in range(4):
    faces = len(mesh.polygons)
    if faces <= face_limit:
        break
    modifier = model.modifiers.new("Decimate", "DECIMATE")
    modifier.decimate_type = "COLLAPSE"
    modifier.ratio = max(0.001, min(1.0, face_limit / faces * 0.98))
    modifier.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    clean(mesh, 1e-6)
if len(mesh.polygons) > face_limit:
    fail("could not decimate below %d faces (have %d)" % (face_limit, len(mesh.polygons)))

# Consistent outward normals, smooth shading with hard edges where the surface breaks.
bm = bmesh.new()
bm.from_mesh(mesh)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
for face in bm.faces:
    face.smooth = True
sharp_angle = radians(35)
for edge in bm.edges:
    if len(edge.link_faces) == 2:
        edge.smooth = edge.calc_face_angle(0.0) <= sharp_angle
bm.to_mesh(mesh)
bm.free()
mesh.update()


def bounds():
    coordinates = [vertex.co for vertex in mesh.vertices]
    low = Vector((min(c.x for c in coordinates), min(c.y for c in coordinates), min(c.z for c in coordinates)))
    high = Vector((max(c.x for c in coordinates), max(c.y for c in coordinates), max(c.z for c in coordinates)))
    return low, high


low, high = bounds()
size = high - low
# Characters should face the viewer (glTF +Z == Blender -Y). A character seen from the
# front is wider (X) than deep (Blender Y); if the depth wins, turn it a quarter turn.
if is_character and size.y > size.x * 1.05:
    # The importer leaves objects in QUATERNION rotation mode, so rotate through the matrix.
    model.matrix_world = Matrix.Rotation(pi / 2, 4, "Z") @ model.matrix_world
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    low, high = bounds()
    size = high - low
current = size.z if is_character else max(size.x, size.y, size.z)
if current <= 1e-9:
    fail("mesh has no measurable size")
factor = (target_height if is_character else target_size) / current
model.scale = (factor, factor, factor)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
low, high = bounds()
model.location = (-(low.x + high.x) / 2, -(low.y + high.y) / 2, -low.z)
bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
low, high = bounds()
size = high - low

# Shrink oversized textures. The FBX exporter embeds packed bytes, so re-pack after scaling.
images = [image for image in bpy.data.images if image.users and image.size[0] > 0 and image.size[1] > 0]
for image in images:
    width, height = image.size
    largest = max(width, height)
    if largest > texture_size:
        ratio = texture_size / largest
        image.scale(max(1, round(width * ratio)), max(1, round(height * ratio)))
        image.pack()
    if not image.filepath:
        # Embedded glTF images have no path; the FBX exporter wants a file name to label them.
        extension = ".jpg" if image.file_format == "JPEG" else ".png"
        image.filepath_raw = "//" + bpy.path.clean_name(image.name) + extension

bpy.context.view_layer.update()
bpy.ops.object.select_all(action="DESELECT")
model.select_set(True)
bpy.context.view_layer.objects.active = model
Path(output_glb).parent.mkdir(parents=True, exist_ok=True)
Path(output_fbx).parent.mkdir(parents=True, exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=output_glb, export_format="GLB", export_animations=False, export_apply=True,
    export_yup=True, export_image_format="AUTO", export_skins=False, export_morph=False,
)
bpy.ops.export_scene.fbx(
    filepath=output_fbx, use_selection=False, object_types={"MESH"}, bake_anim=False,
    apply_scale_options="FBX_SCALE_ALL", axis_forward="-Z", axis_up="Y", global_scale=1.0,
    apply_unit_scale=True, path_mode="COPY", embed_textures=True, add_leaf_bones=False,
    mesh_smooth_type="OFF", use_mesh_modifiers=True,
)
for path in (output_glb, output_fbx):
    if not Path(path).is_file() or Path(path).stat().st_size == 0:
        fail("export did not produce " + path)

print("STATS " + json.dumps({
    "faces": len(mesh.polygons),
    "vertices": len(mesh.vertices),
    "dimensions": [round(size.x, 5), round(size.z, 5), round(size.y, 5)],
    "images": len(images),
}))
