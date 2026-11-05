# Converts one downloaded scene into a Scene Maker set, headless in Blender:
#   blender --background --factory-startup --disable-autoexec \
#           --python-exit-code 1 --python blender_set.py -- job.json
# The job names the source (.blend, FBX, OBJ or a Mitsuba XML scene), the GLB,
# thumbnail and measurement to write, and per-set options. Steps: open the
# source, make linked and instanced geometry real, apply modifiers, drop hair
# and particles, turn every material into a Principled BSDF with image or
# constant inputs (baking the procedural ones to textures), find the floor and
# the open floor around it, choose a home camera, move the origin to a spawn
# point on open floor with the camera toward +Z (glTF), export the GLB with
# embedded JPEG textures of at most 2048 px, and render the thumbnail.
import json
import math
import os
import re
import sys
import time
import traceback
import xml.etree.ElementTree as ET

import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

job = json.load(open(sys.argv[sys.argv.index("--") + 1]))
sys.path.insert(0, job["lib"])
from blender_thumbnail import render_thumbnail  # noqa: E402

started = time.time()
messages = []


def say(message):
    messages.append(message)
    print("SET " + message, flush=True)


def gl(v):
    """Blender (x, y, z) to glTF (x, z, -y)."""
    return [float(v[0]), float(v[2]), float(-v[1])]


SHELL_NAMES = re.compile(
    r"(wall|ceiling|roof|floor|ground|terrain|plafond|\bmur|\bsol\b|parquet|"
    r"skirting|cornice|facade|building|shell|\broom|\bsky|backdrop|pavement|"
    r"sidewalk|street|road|curb|plaza|pared|suelo|techo|piso|boden|wand|decke)",
    re.I,
)


# ---------------------------------------------------------------- loading
def context_objects(objects):
    """Operators need a selection; background mode has no window to click."""
    return bpy.context.temp_override(
        selected_objects=objects,
        selected_editable_objects=objects,
        active_object=objects[0] if objects else None,
        object=objects[0] if objects else None,
    )


def open_blend(path):
    bpy.ops.wm.open_mainfile(filepath=path, load_ui=False)
    scene = bpy.data.scenes.get(job.get("scene") or "") or bpy.context.scene
    if bpy.context.window and bpy.context.window.scene is not scene:
        bpy.context.window.scene = scene
    if bpy.data.libraries:
        say("making %d linked libraries local" % len(bpy.data.libraries))
        with context_objects(list(scene.objects)):
            bpy.ops.object.make_local(type="ALL")
    return scene


def fresh_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    return bpy.context.scene


def open_fbx(path):
    scene = fresh_scene()
    bpy.ops.import_scene.fbx(
        filepath=path, use_custom_normals=True, use_image_search=True, use_anim=False
    )
    return scene


GLASS_NAMES = re.compile(r"(glass|window|crystal|cristal|vitre|verre|wine|bottle|vase|jar)", re.I)


def open_obj(path):
    scene = fresh_scene()
    bpy.ops.wm.obj_import(
        filepath=path, up_axis="Y", forward_axis="NEGATIVE_Z", use_split_objects=True,
        use_split_groups=False, validate_meshes=True,
    )
    # MTL "illum 4" (ray-traced reflection) makes the importer treat every
    # material as glass; only glass-like names keep their transmission.
    for m in bpy.data.materials:
        p = m.node_tree.nodes.get("Principled BSDF") if m.use_nodes else None
        if p is not None and p.inputs["Transmission Weight"].default_value > 0 and not GLASS_NAMES.search(m.name):
            p.inputs["Transmission Weight"].default_value = 0.0
    return scene


# Mitsuba scenes are Y-up like OBJ files.
Y_UP_TO_Z_UP = Matrix.Rotation(math.radians(90), 4, "X")


def mitsuba_transform(node):
    """A Mitsuba <transform>: matrix, lookat and the basic ops, in order."""
    m = Matrix.Identity(4)
    if node is None:
        return m
    for child in node:
        if child.tag == "matrix":
            values = [float(v) for v in child.get("value").split()]
            t = Matrix([values[i * 4:(i + 1) * 4] for i in range(4)])
        elif child.tag == "lookat":
            origin = Vector([float(v) for v in child.get("origin").split(",")])
            target = Vector([float(v) for v in child.get("target").split(",")])
            up = Vector([float(v) for v in child.get("up").split(",")])
            direction = (target - origin).normalized()
            right = direction.cross(up).normalized()
            true_up = right.cross(direction)
            t = Matrix((
                (right.x, true_up.x, direction.x, origin.x),
                (right.y, true_up.y, direction.y, origin.y),
                (right.z, true_up.z, direction.z, origin.z),
                (0, 0, 0, 1),
            ))
        elif child.tag == "translate":
            t = Matrix.Translation(Vector([float(child.get(k, 0)) for k in "xyz"]))
        elif child.tag == "scale":
            if child.get("value") is not None:
                s = float(child.get("value"))
                t = Matrix.Diagonal((s, s, s, 1))
            else:
                t = Matrix.Diagonal([float(child.get(k, 1)) for k in "xyz"] + [1])
        elif child.tag == "rotate":
            axis = Vector([float(child.get(k, 0)) for k in "xyz"])
            t = Matrix.Rotation(math.radians(float(child.get("angle", 0))), 4, axis)
        else:
            continue
        m = t @ m
    return m


def find_named(node, name):
    for child in node:
        if child.get("name") == name:
            return child
    return None


def mitsuba_color(node, default):
    if node is None or node.get("value") is None:
        return default
    parts = [float(v) for v in re.split(r"[,\s]+", node.get("value").strip()) if v]
    if len(parts) == 1:
        parts *= 3
    return tuple(parts[:3])


def mitsuba_texture(tex, base_dir):
    if tex is None or tex.tag != "texture" or tex.get("type") != "bitmap":
        return None
    filename = find_named(tex, "filename")
    if filename is None:
        return None
    path = os.path.join(base_dir, filename.get("value"))
    if not os.path.exists(path):
        say("missing texture %s" % filename.get("value"))
        return None
    return bpy.data.images.load(path, check_existing=True)


def mitsuba_material(name, bsdf, base_dir, bsdfs):
    """A Principled material from a Mitsuba BSDF description."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    principled = nodes.get("Principled BSDF")
    kind = bsdf.get("type")
    while kind in ("twosided", "bumpmap", "coating", "roughcoating", "normalmap", "mask"):
        inner = bsdf.find("bsdf")
        if inner is None:
            ref = bsdf.find("ref")
            inner = bsdfs.get(ref.get("id")) if ref is not None else None
        if inner is None:
            break
        if kind == "mask":
            image = mitsuba_texture(find_named(bsdf, "opacity"), base_dir)
            if image:
                node = nodes.new("ShaderNodeTexImage")
                node.image = image
                links.new(node.outputs["Color"], principled.inputs["Alpha"])
                mat.blend_method = "CLIP"
        bsdf = inner
        kind = bsdf.get("type")
    reflectance = (
        find_named(bsdf, "reflectance")
        or find_named(bsdf, "diffuse_reflectance")
        or find_named(bsdf, "specular_reflectance")
    )
    image = mitsuba_texture(reflectance, base_dir)
    if image:
        node = nodes.new("ShaderNodeTexImage")
        node.image = image
        links.new(node.outputs["Color"], principled.inputs["Base Color"])
    else:
        default = (0.9, 0.9, 0.9) if kind in ("conductor", "roughconductor") else (0.8, 0.8, 0.8)
        principled.inputs["Base Color"].default_value = (*mitsuba_color(reflectance, default), 1.0)
    alpha = find_named(bsdf, "alpha")
    roughness = None
    if alpha is not None and alpha.get("value"):
        roughness = min(1.0, math.sqrt(float(alpha.get("value"))) * 1.5)
    if kind in ("plastic", "roughplastic"):
        principled.inputs["Roughness"].default_value = roughness if roughness is not None else 0.25
    elif kind in ("conductor", "roughconductor"):
        principled.inputs["Metallic"].default_value = 1.0
        principled.inputs["Roughness"].default_value = roughness if roughness is not None else 0.15
    elif kind in ("dielectric", "roughdielectric", "thindielectric"):
        principled.inputs["Roughness"].default_value = roughness if roughness is not None else 0.05
        principled.inputs["Alpha"].default_value = 0.25
        mat.blend_method = "BLEND"
        mat.surface_render_method = "BLENDED"
    else:
        principled.inputs["Roughness"].default_value = 0.9
    return mat


def open_mitsuba(path):
    """Import every OBJ shape of a Mitsuba XML scene with its transform and a
    Principled material built from its BSDF; the sensor becomes the camera."""
    scene = fresh_scene()
    base_dir = os.path.dirname(path)
    root = ET.parse(path).getroot()
    bsdfs = {b.get("id"): b for b in root.iter("bsdf") if b.get("id")}
    materials = {}
    count = 0
    for shape in root.findall("shape"):
        filename = find_named(shape, "filename")
        if shape.get("type") != "obj" or filename is None:
            continue
        file = os.path.join(base_dir, filename.get("value"))
        if not os.path.exists(file):
            say("missing shape %s" % filename.get("value"))
            continue
        before = set(bpy.data.objects)
        bpy.ops.wm.obj_import(filepath=file, up_axis="Y", forward_axis="NEGATIVE_Z",
                              use_split_objects=False, use_split_groups=False)
        new = [o for o in bpy.data.objects if o not in before and o.type == "MESH"]
        transform = mitsuba_transform(shape.find("transform"))
        bsdf = shape.find("bsdf")
        ref = shape.find("ref")
        if bsdf is None and ref is not None:
            bsdf = bsdfs.get(ref.get("id"))
        material = None
        if bsdf is not None:
            key = bsdf.get("id") or ("inline-%d" % count)
            if key not in materials:
                materials[key] = mitsuba_material(key, bsdf, base_dir, bsdfs)
            material = materials[key]
        emitter = shape.find("emitter")
        for o in new:
            # The importer turned the file Y-up → Z-up; place the shape in the
            # scene's Y-up frame, then turn the whole placement Z-up.
            o.matrix_world = Y_UP_TO_Z_UP @ transform @ Y_UP_TO_Z_UP.inverted() @ o.matrix_world
            o.name = os.path.splitext(os.path.basename(file))[0]
            if material:
                o.data.materials.clear()
                o.data.materials.append(material)
            if emitter is not None and o.data.materials:
                color = mitsuba_color(find_named(emitter, "radiance"), (1, 1, 1))
                strength = max(max(color), 1e-3)
                p = o.data.materials[0].node_tree.nodes.get("Principled BSDF")
                if p is not None:
                    p.inputs["Emission Color"].default_value = (*[c / strength for c in color], 1)
                    p.inputs["Emission Strength"].default_value = min(strength, 20)
        count += 1
    sensor = root.find("sensor")
    if sensor is not None:
        data = bpy.data.cameras.new("mitsuba")
        fov = find_named(sensor, "fov")
        if fov is not None:
            axis = find_named(sensor, "fov_axis")
            data.sensor_fit = "VERTICAL" if axis is not None and axis.get("value") == "y" else "HORIZONTAL"
            data.angle = math.radians(float(fov.get("value")))
        cam = bpy.data.objects.new("mitsuba", data)
        scene.collection.objects.link(cam)
        # Mitsuba cameras look along +Z with +Y up; Blender's along -Z.
        flip = Matrix.Diagonal((-1, 1, -1, 1))
        cam.matrix_world = Y_UP_TO_Z_UP @ mitsuba_transform(sensor.find("transform")) @ flip
        scene.camera = cam
    say("imported %d shapes with %d materials" % (count, len(materials)))
    return scene


# ------------------------------------------------------------ preparation
def wanted(scene):
    """The objects to export. Viewport visibility is the truth; the render
    flag only counts when the artist used it to hide a few things (an EEVEE
    walkthrough can have everything marked "hide in render")."""
    rule = job.get("visibility", "auto")
    visible = [o for o in scene.objects if o.visible_get()]
    hidden_render = sum(1 for o in visible if o.hide_render)
    if rule == "auto":
        rule = "viewport" if hidden_render * 2 > len(visible) else "render"
    drop = re.compile(job["drop"], re.I) if job.get("drop") else None
    keep = []
    for o in visible:
        if rule == "render" and o.hide_render:
            continue
        if drop and drop.search(o.name):
            continue
        o.hide_render = False
        keep.append(o)
    return keep


def strip_particles(objects):
    """Particle systems and hair go. An emitter the artist did not render
    (Show Emitter off: a scatter plane for pebbles or plants) was never
    meant to be seen and goes with them. Returns the surviving objects."""
    kept = []
    for o in objects:
        unseen = bool(o.particle_systems) and not o.show_instancer_for_render
        for m in list(o.modifiers):
            if m.type == "PARTICLE_SYSTEM":
                o.modifiers.remove(m)
        if unseen or o.type == "CURVES":
            bpy.data.objects.remove(o)
        else:
            kept.append(o)
    return kept


def make_real(scene, objects):
    """Collection instances become real objects; particles and hair go."""
    objects = strip_particles(objects)
    instancers = [o for o in objects if o.instance_type == "COLLECTION" and o.instance_collection]
    if instancers:
        before = set(scene.objects)
        with context_objects(instancers):
            bpy.ops.object.duplicates_make_real(use_base_parent=False, use_hierarchy=True)
        for o in instancers:
            o.instance_type = "NONE"
        new = [o for o in scene.objects if o not in before]
        say("made %d objects real from %d collection instances" % (len(new), len(instancers)))
        new = strip_particles(new)
        nested = [o for o in new if o.instance_type == "COLLECTION" and o.instance_collection]
        if nested:
            with context_objects(nested):
                bpy.ops.object.duplicates_make_real(use_base_parent=False, use_hierarchy=True)
            for o in nested:
                o.instance_type = "NONE"
            new = strip_particles([o for o in scene.objects if o not in before])
        objects = objects + [o for o in new if o.visible_get()]
    return objects


def apply_modifiers(scene, objects):
    """Everything becomes a plain mesh at viewport quality (curves, text,
    metaballs included). Shared meshes stay shared unless a modifier makes
    them differ, so repeated furniture is still instanced in the GLB."""
    convertible = [o for o in objects if o.type in ("MESH", "CURVE", "FONT", "SURFACE", "META")]
    for o in convertible:
        if o.type == "MESH" and o.modifiers and o.data.users > 1:
            o.data = o.data.copy()
    with_work = [o for o in convertible if o.type != "MESH" or o.modifiers]
    for o in with_work:
        for m in list(o.modifiers):
            if m.type == "SUBSURF":
                if m.levels == 0:
                    o.modifiers.remove(m)
                else:
                    m.levels = min(m.levels, int(job.get("subdivision", 2)))
    if with_work:
        with context_objects(with_work):
            bpy.ops.object.convert(target="MESH", keep_original=False)
    meshes = [o for o in objects if o.name in scene.objects and o.type == "MESH" and len(o.data.polygons)]
    for o in meshes:
        if o.data.shape_keys:
            o.shape_key_clear()
    return meshes


def reduce_triangles(objects, limit):
    """Decimates the heaviest meshes, each by the same ratio, until the set
    fits its triangle budget; instances of one mesh stay instances."""
    total = triangles(objects)
    if total <= limit:
        return total
    by_mesh = {}
    for o in objects:
        if len(o.data.loop_triangles) > 10000:
            by_mesh.setdefault(o.data, []).append(o)
    heavy = sum(len(m.loop_triangles) * len(users) for m, users in by_mesh.items())
    ratio = max(0.2, (limit - (total - heavy)) / heavy) if heavy else 1.0
    if ratio >= 1.0:
        return total
    for mesh, users in by_mesh.items():
        first = users[0]
        if mesh.users > 1:
            first.data = mesh.copy()
        modifier = first.modifiers.new("decimate", "DECIMATE")
        modifier.decimate_type = "COLLAPSE"
        modifier.ratio = ratio
        modifier.use_collapse_triangulate = True
        with context_objects([first]):
            bpy.ops.object.modifier_apply(modifier=modifier.name)
        for o in users[1:]:
            o.data = first.data
    after = triangles(objects)
    say("decimated %d heavy meshes to %d %%: %d triangles become %d" % (len(by_mesh), round(ratio * 100), total, after))
    return after


def clip_to_extent(scene, objects, extent):
    """Cuts away everything beyond `extent` metres from the origin along x
    and y (a landscape plane running to the horizon); emptied meshes go."""
    import bmesh

    planes = [((1, 0, 0), extent), ((-1, 0, 0), extent), ((0, 1, 0), extent), ((0, -1, 0), extent)]
    kept, clipped = [], 0
    for o in objects:
        corners = [o.matrix_world @ Vector(c) for c in o.bound_box]
        if all(abs(p.x) <= extent and abs(p.y) <= extent for p in corners):
            kept.append(o)
            continue
        if o.data.users > 1:
            o.data = o.data.copy()
        bm = bmesh.new()
        bm.from_mesh(o.data)
        inverse = o.matrix_world.inverted()
        for normal, distance in planes:
            n = Vector(normal)
            geometry = bm.verts[:] + bm.edges[:] + bm.faces[:]
            bmesh.ops.bisect_plane(
                bm, geom=geometry, dist=1e-4, plane_co=inverse @ (n * distance),
                plane_no=(o.matrix_world.to_3x3().transposed() @ n).normalized(), clear_outer=True,
            )
        bm.to_mesh(o.data)
        bm.free()
        o.data.update()
        clipped += 1
        if len(o.data.polygons):
            kept.append(o)
        else:
            bpy.data.objects.remove(o)
    say("clipped %d meshes to %.0f m around the cast" % (clipped, extent))
    return kept


def flatten(scene, keep):
    """Only the kept meshes, lights and cameras remain, each with its world
    transform; parents and other helpers go."""
    for o in keep:
        if o.parent is not None:
            world = o.matrix_world.copy()
            o.parent = None
            o.matrix_world = world
    keep_set = set(keep)
    for o in list(scene.objects):
        if o in keep_set or o.type in ("LIGHT", "CAMERA"):
            continue
        bpy.data.objects.remove(o)
    bpy.context.view_layer.update()


# --------------------------------------------------------------- materials
class Unsupported(Exception):
    pass


class ImageRef:
    def __init__(self, image, interpolation="Linear", extension="REPEAT"):
        self.image = image
        self.interpolation = interpolation
        self.extension = extension if extension in ("REPEAT", "EXTEND", "CLIP") else "REPEAT"


def input_source(socket):
    """(node, output socket) feeding `socket`, through reroutes."""
    if not socket.is_linked:
        return None, None
    link = socket.links[0]
    node, out = link.from_node, link.from_socket
    while node.type == "REROUTE":
        if not node.inputs[0].is_linked:
            return None, None
        link = node.inputs[0].links[0]
        node, out = link.from_node, link.from_socket
    return node, out


def plain(spec):
    return {"color": ("const", (0.8, 0.8, 0.8, 1.0)), "roughness": ("const", 0.6), "metallic": ("const", 0.0),
            "alpha": ("const", 1.0), "normal": None, "emission": None, **spec}


# Light Path outputs as seen by a ray from the camera.
CAMERA_RAY = {"Is Camera Ray": 1.0, "Is Shadow Ray": 0.0, "Is Diffuse Ray": 0.0, "Is Glossy Ray": 0.0,
              "Is Singular Ray": 0.0, "Is Reflection Ray": 0.0, "Is Transmission Ray": 0.0,
              "Is Volume Scatter Ray": 0.0, "Ray Depth": 0.0, "Diffuse Depth": 0.0, "Glossy Depth": 0.0,
              "Transparent Depth": 0.0, "Transmission Depth": 0.0}


def glass_like(material):
    """True when the shader lets light through like glass: a baked texture
    would come out black, so such a material becomes plain clear glass."""
    for node in material.node_tree.nodes:
        if node.type in ("BSDF_GLASS", "BSDF_REFRACTION") and node.outputs[0].is_linked:
            return True
        if node.type == "BSDF_PRINCIPLED" and node.outputs[0].is_linked:
            weight = node.inputs["Transmission Weight"]
            if not weight.is_linked and weight.default_value > 0.5:
                return True
    return False


GLASS = {"color": ("const", (0.92, 0.94, 0.95, 1.0)), "roughness": ("const", 0.05),
         "alpha": ("const", 0.25), "transparent": True}


class Simplifier:
    """Reads a shader tree into Principled parameters when it is made of
    constants, image textures and the simple Diffuse/Glossy/Glass/Mix shaders
    of older Cycles scenes. Anything cleverer raises Unsupported → bake."""

    def __init__(self, material):
        self.material = material

    def color(self, socket, group=None):
        """('const', rgba) or ('image', ImageRef) or ('image_alpha', ImageRef)."""
        node, out = input_source(socket)
        if node is None:
            v = socket.default_value
            if isinstance(v, float):
                return ("const", (v, v, v, 1.0))
            return ("const", tuple(v) if len(v) == 4 else (*v, 1.0))
        t = node.type
        if t == "TEX_IMAGE":
            if node.image is None or node.projection != "FLAT":
                raise Unsupported("image projection")
            vector, vector_out = input_source(node.inputs["Vector"])
            if vector is not None and not (
                vector.type == "UVMAP" or (vector.type == "TEX_COORD" and vector_out.name == "UV")
            ):
                raise Unsupported("mapped texture")
            ref = ImageRef(node.image, node.interpolation, node.extension)
            return ("image_alpha" if out.name == "Alpha" else "image", ref)
        if t == "RGB":
            return ("const", tuple(node.outputs[0].default_value))
        if t == "VALUE":
            v = node.outputs[0].default_value
            return ("const", (v, v, v, 1.0))
        if t == "GROUP_INPUT" and group is not None:
            return self.color(group.inputs[out.name])
        if t in ("MIX_RGB", "MIX"):
            if t == "MIX":
                if node.data_type != "RGBA":
                    raise Unsupported("mix of vectors")
                fac_socket, a_socket, b_socket = node.inputs[0], node.inputs[6], node.inputs[7]
            else:
                fac_socket, a_socket, b_socket = node.inputs["Fac"], node.inputs["Color1"], node.inputs["Color2"]
            fac = self.factor(fac_socket, group)
            a = self.color(a_socket, group)
            b = self.color(b_socket, group)
            if a[0] == "const" and b[0] == "const" and node.blend_type == "MIX":
                return ("const", tuple(a[1][i] * (1 - fac) + b[1][i] * fac for i in range(4)))
            if a[0] == "const" and b[0] == "const" and node.blend_type == "MULTIPLY":
                return ("const", tuple(a[1][i] * (1 - fac + fac * b[1][i]) for i in range(3)) + (1.0,))
            # A texture tinted by a constant keeps the texture.
            if node.blend_type in ("MULTIPLY", "MIX") and a[0] == "image" and b[0] == "const":
                return a
            if node.blend_type in ("MULTIPLY", "MIX") and b[0] == "image" and a[0] == "const":
                return b
            raise Unsupported("mix of textures")
        raise Unsupported("colour from " + t)

    def factor(self, socket, group=None):
        node, out = input_source(socket)
        if node is None:
            v = socket.default_value
            return float(v if isinstance(v, (float, int)) else v[0])
        if node.type == "VALUE":
            return float(node.outputs[0].default_value)
        if node.type == "GROUP_INPUT" and group is not None:
            return self.factor(group.inputs[out.name])
        if node.type in ("FRESNEL", "LAYER_WEIGHT"):
            # A dielectric's specular layer: Principled has it built in.
            return 0.08
        if node.type == "LIGHT_PATH" and out.name in CAMERA_RAY:
            # Path tricks (a lamp shade lit only for the camera, a window
            # that hides from it) resolve to what the camera sees.
            return CAMERA_RAY[out.name]
        raise Unsupported("factor from " + node.type)

    def factor_or_image(self, socket, group=None):
        node, out = input_source(socket)
        if node is not None and node.type == "TEX_IMAGE":
            return self.color(socket, group)
        return ("const", self.factor(socket, group))

    def normal(self, socket, group=None):
        node, out = input_source(socket)
        if node is None:
            return None
        if node.type == "NORMAL_MAP":
            color = self.color(node.inputs["Color"], group)
            if color[0] == "image":
                return (color[1], self.factor(node.inputs["Strength"], group))
            return None
        if node.type == "BUMP":
            # A bump map is fine detail; the colour texture keeps the look.
            return None
        if node.type == "GROUP_INPUT" and group is not None:
            return self.normal(group.inputs[out.name])
        raise Unsupported("normal from " + node.type)

    def shader(self, socket, group=None):
        """Principled values for the shader plugged into `socket`."""
        node, out = input_source(socket)
        if node is None:
            raise Unsupported("no shader")
        t = node.type
        if t == "GROUP_INPUT" and group is not None:
            return self.shader(group.inputs[out.name])
        if t == "GROUP":
            inner = node.node_tree
            output = next((n for n in inner.nodes if n.type == "GROUP_OUTPUT" and n.is_active_output), None)
            if output is None:
                raise Unsupported("group without output")
            return self.shader(output.inputs[out.name], group=node)
        if t == "BSDF_PRINCIPLED":
            spec = plain({
                "color": self.color(node.inputs["Base Color"], group),
                "roughness": self.factor_or_image(node.inputs["Roughness"], group),
                "metallic": self.factor_or_image(node.inputs["Metallic"], group),
                "alpha": self.factor_or_image(node.inputs["Alpha"], group),
                "normal": self.normal(node.inputs["Normal"], group),
            })
            strength = self.factor(node.inputs["Emission Strength"], group)
            if strength > 0:
                color = self.color(node.inputs["Emission Color"], group)
                if color[0] != "const" or max(color[1][:3]) > 0.001:
                    spec["emission"] = (color, strength)
            if self.factor(node.inputs["Transmission Weight"], group) > 0.5:
                spec["alpha"] = ("const", 0.25)
                spec["transparent"] = True
            return spec
        if t in ("BSDF_DIFFUSE", "BSDF_TRANSLUCENT", "SUBSURFACE_SCATTERING", "BSDF_VELVET", "BSDF_SHEEN", "BSDF_TOON"):
            return plain({"color": self.color(node.inputs["Color"], group), "roughness": ("const", 0.8),
                          "normal": self.normal(node.inputs["Normal"], group) if "Normal" in node.inputs else None})
        if t in ("BSDF_GLOSSY", "BSDF_ANISOTROPIC", "BSDF_METALLIC"):
            return plain({"color": self.color(node.inputs["Color"], group),
                          "roughness": self.factor_or_image(node.inputs["Roughness"], group),
                          "metallic": ("const", 1.0), "normal": self.normal(node.inputs["Normal"], group)})
        if t in ("BSDF_GLASS", "BSDF_REFRACTION"):
            return plain({"color": self.color(node.inputs["Color"], group),
                          "roughness": self.factor_or_image(node.inputs["Roughness"], group),
                          "alpha": ("const", 0.25), "transparent": True})
        if t in ("BSDF_TRANSPARENT", "HOLDOUT"):
            return plain({"color": ("const", (1, 1, 1, 1)), "alpha": ("const", 0.0), "transparent": True})
        if t == "EMISSION":
            return plain({"color": ("const", (0, 0, 0, 1)),
                          "emission": (self.color(node.inputs["Color"], group), self.factor(node.inputs["Strength"], group))})
        if t == "MIX_SHADER":
            a = self.shader(node.inputs[1], group)
            b = self.shader(node.inputs[2], group)
            fac_node, _ = input_source(node.inputs["Fac"])
            fresnel = fac_node is not None and fac_node.type in ("FRESNEL", "LAYER_WEIGHT")
            return mix_shaders(a, b, self.factor(node.inputs["Fac"], group), fresnel)
        if t == "ADD_SHADER":
            a = self.shader(node.inputs[0], group)
            b = self.shader(node.inputs[1], group)
            if a["emission"] and not b["emission"]:
                return {**b, "emission": a["emission"]}
            if b["emission"] and not a["emission"]:
                return {**a, "emission": b["emission"]}
            return mix_shaders(a, b, 0.5, False)
        raise Unsupported("shader " + t)


def is_metal(spec):
    return spec["metallic"][0] == "const" and spec["metallic"][1] > 0.5


def mix_shaders(a, b, fac, fresnel):
    """Two simple shaders mixed. Diffuse + glossy behind a Fresnel is the
    classic dielectric: the glossy side only sets the roughness."""
    if a.get("transparent") and not b.get("transparent"):
        return {**b, "alpha": ("const", fac), "transparent": True}
    if b.get("transparent") and not a.get("transparent"):
        return {**a, "alpha": ("const", 1 - fac), "transparent": True}
    if fresnel or (is_metal(a) != is_metal(b) and 0.0 < fac < 1.0):
        glossy, diffuse = (a, b) if is_metal(a) else (b, a)
        weight = fac if glossy is b else 1 - fac
        metallic = 0.0 if (fresnel or weight < 0.5) else 1.0
        return {**diffuse, "roughness": glossy["roughness"], "metallic": ("const", metallic),
                "emission": diffuse["emission"] or glossy["emission"]}
    if a["color"][0] == "const" and b["color"][0] == "const":
        color = tuple(a["color"][1][i] * (1 - fac) + b["color"][1][i] * fac for i in range(4))
        result = {**(a if fac < 0.5 else b), "color": ("const", color)}
        if a["roughness"][0] == "const" and b["roughness"][0] == "const":
            result["roughness"] = ("const", a["roughness"][1] * (1 - fac) + b["roughness"][1] * fac)
        return result
    return a if fac < 0.5 else b


def output_shader_socket(material):
    tree = material.node_tree
    output = next((n for n in tree.nodes if n.type == "OUTPUT_MATERIAL" and n.is_active_output), None)
    output = output or next((n for n in tree.nodes if n.type == "OUTPUT_MATERIAL"), None)
    if output is None:
        raise Unsupported("no output")
    return output.inputs["Surface"]


def rebuild_material(material, spec):
    """Replaces the node tree with a Principled BSDF fed by `spec`."""
    tree = material.node_tree
    images = {}
    for key in ("color", "roughness", "metallic", "alpha"):
        value = spec.get(key)
        if value and value[0] in ("image", "image_alpha"):
            images[key] = (value[1], value[0] == "image_alpha")
    if spec.get("normal"):
        images["normal"] = (spec["normal"][0], False)
    emission = spec.get("emission")
    if emission and emission[0][0] == "image":
        images["emission"] = (emission[0][1], False)
    tree.nodes.clear()
    output = tree.nodes.new("ShaderNodeOutputMaterial")
    principled = tree.nodes.new("ShaderNodeBsdfPrincipled")
    tree.links.new(principled.outputs["BSDF"], output.inputs["Surface"])

    def plug(key, non_color=True):
        ref, alpha = images[key]
        node = tree.nodes.new("ShaderNodeTexImage")
        node.image = ref.image
        node.interpolation = ref.interpolation
        node.extension = ref.extension
        if non_color and ref.image.colorspace_settings.name != "Non-Color":
            ref.image.colorspace_settings.name = "Non-Color"
        return node, node.outputs["Alpha" if alpha else "Color"]

    def constant(value):
        return tuple(min(1.0, max(0.0, float(c))) for c in value[:3]) + (1.0,)

    if "color" in images:
        node, out = plug("color", non_color=False)
        tree.links.new(out, principled.inputs["Base Color"])
        # The texture's own alpha when the artist used it.
        if "alpha" in images and images["alpha"][1] and images["alpha"][0].image is node.image:
            tree.links.new(node.outputs["Alpha"], principled.inputs["Alpha"])
            images.pop("alpha")
            spec = {**spec, "alpha": ("texture", 1.0)}
    else:
        principled.inputs["Base Color"].default_value = constant(spec["color"][1])
    for key, socket in (("roughness", "Roughness"), ("metallic", "Metallic"), ("alpha", "Alpha")):
        if key in images:
            node, out = plug(key)
            tree.links.new(out, principled.inputs[socket])
        elif spec[key][0] == "const":
            principled.inputs[socket].default_value = min(1.0, max(0.0, float(spec[key][1])))
    if "normal" in images:
        node, out = plug("normal")
        normal_map = tree.nodes.new("ShaderNodeNormalMap")
        normal_map.inputs["Strength"].default_value = min(2.0, max(0.0, spec["normal"][1]))
        tree.links.new(out, normal_map.inputs["Color"])
        tree.links.new(normal_map.outputs["Normal"], principled.inputs["Normal"])
    if emission:
        color, strength = emission
        if "emission" in images:
            node, out = plug("emission", non_color=False)
            tree.links.new(out, principled.inputs["Emission Color"])
        else:
            principled.inputs["Emission Color"].default_value = constant(color[1])
        principled.inputs["Emission Strength"].default_value = min(10.0, max(0.0, strength))
    else:
        principled.inputs["Emission Strength"].default_value = 0.0
    cutout = spec["alpha"][0] != "const"
    see_through = bool(spec.get("transparent")) or (spec["alpha"][0] == "const" and spec["alpha"][1] < 0.999)
    if cutout:
        material.blend_method = "CLIP"
        material.surface_render_method = "DITHERED"
        material.alpha_threshold = 0.5
    elif see_through:
        material.blend_method = "BLEND"
        material.surface_render_method = "BLENDED"
    else:
        material.blend_method = "OPAQUE"
        material.surface_render_method = "DITHERED"
    material.use_backface_culling = False


def ensure_uv(objects):
    """Baking needs UVs. Objects without any get a smart projection."""
    missing = [o for o in objects if not o.data.uv_layers]
    for o in missing:
        with context_objects([o]):
            bpy.ops.object.mode_set(mode="EDIT")
            bpy.ops.mesh.select_all(action="SELECT")
            bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.003)
            bpy.ops.object.mode_set(mode="OBJECT")
    return len(missing)


def surface_area(o):
    me = o.data
    if not len(me.polygons):
        return 0.0
    areas = np.empty(len(me.polygons), dtype=np.float32)
    me.polygons.foreach_get("area", areas)
    s = o.matrix_world.to_scale()
    return float(areas.sum()) * abs(s.x * s.y)


def bake_size(area):
    if area <= 1.5:
        return 512
    if area <= 12:
        return 1024
    return int(job.get("bakeSize", 2048))


def read_pixels(image):
    px = np.empty(image.size[0] * image.size[1] * 4, dtype=np.float32)
    image.pixels.foreach_get(px)
    return px.reshape(image.size[1], image.size[0], 4)


def write_image(name, pixels, path):
    """Saves float pixels (already display-encoded for colour) as a PNG."""
    h, w = pixels.shape[:2]
    image = bpy.data.images.new(name, w, h, alpha=False, float_buffer=False)
    image.pixels.foreach_set(np.clip(pixels, 0, 1).astype(np.float32).reshape(-1))
    image.filepath_raw = path
    image.file_format = "PNG"
    image.save()
    bpy.data.images.remove(image)


def use_gpu(scene):
    prefs = bpy.context.preferences.addons["cycles"].preferences
    for kind in ("OPTIX", "CUDA", "HIP", "METAL", "ONEAPI"):
        try:
            prefs.compute_device_type = kind
        except TypeError:
            continue
        prefs.refresh_devices()
        gpus = [d for d in prefs.devices if d.type == kind]
        if gpus:
            for d in prefs.devices:
                d.use = d.type == kind
            scene.cycles.device = "GPU"
            return kind
    scene.cycles.device = "CPU"
    return "CPU"


def luminance(px):
    return px[..., 0] * 0.2126 + px[..., 1] * 0.7152 + px[..., 2] * 0.0722


def to_srgb(linear):
    return np.where(linear <= 0.0031308, linear * 12.92,
                    1.055 * np.power(np.maximum(linear, 1e-6), 1 / 2.4) - 0.055)


def polygon_areas_by_material(o):
    """World-space polygon area per material slot of a mesh object."""
    me = o.data
    n = len(me.polygons)
    if not n:
        return {}
    areas = np.empty(n, dtype=np.float32)
    me.polygons.foreach_get("area", areas)
    slots = np.empty(n, dtype=np.int32)
    me.polygons.foreach_get("material_index", slots)
    s = o.matrix_world.to_scale()
    scale = abs(s.x * s.y)
    return {int(k): float(areas[slots == k].sum()) * scale for k in np.unique(slots)}


def single_uv_layer(o):
    """Keeps only the render UV layer, named alike on every object, so a
    join lines the layers up."""
    layers = o.data.uv_layers
    if not layers:
        return
    keep = (layers.active or layers[0]).name
    for layer in layers:
        if layer.active_render:
            keep = layer.name
    for name in [layer.name for layer in layers if layer.name != keep]:
        layers.remove(layers[name])
    layers[0].name = "UVMap"
    layers.active_index = 0


def fold_uvs(mesh):
    """Shifts each face's UVs by whole tiles so it lies in the unit square
    the bake paints: a texture tiled across a wall (UVs from 0 to 10) bakes
    one tile, which the exported material repeats like the original."""
    if not mesh.uv_layers or not len(mesh.polygons):
        return
    layer = mesh.uv_layers[0].data
    uv = np.empty(len(layer) * 2, dtype=np.float64)
    layer.foreach_get("uv", uv)
    uv = uv.reshape(-1, 2)
    starts = np.empty(len(mesh.polygons), dtype=np.int64)
    totals = np.empty(len(mesh.polygons), dtype=np.int64)
    mesh.polygons.foreach_get("loop_start", starts)
    mesh.polygons.foreach_get("loop_total", totals)
    # Every loop's index, face by face, and the face it belongs to.
    face = np.repeat(np.arange(len(starts)), totals)
    loops = starts[face] + np.arange(len(face)) - np.repeat(np.cumsum(totals) - totals, totals)
    centre = np.zeros((len(starts), 2))
    np.add.at(centre, face, uv[loops])
    centre /= totals[:, None]
    uv[loops] -= np.floor(centre)[face]
    layer.foreach_set("uv", uv.reshape(-1).astype(np.float32))


def face_uv_areas(mesh):
    """The UV area of every face of `mesh` (first UV layer)."""
    layer = mesh.uv_layers[0].data
    uv = np.empty(len(layer) * 2, dtype=np.float64)
    layer.foreach_get("uv", uv)
    uv = uv.reshape(-1, 2)
    starts = np.empty(len(mesh.polygons), dtype=np.int64)
    totals = np.empty(len(mesh.polygons), dtype=np.int64)
    mesh.polygons.foreach_get("loop_start", starts)
    mesh.polygons.foreach_get("loop_total", totals)
    face = np.repeat(np.arange(len(starts)), totals)
    within = np.arange(len(face)) - np.repeat(np.cumsum(totals) - totals, totals)
    loops = starts[face] + within
    following = starts[face] + (within + 1) % totals[face]
    cross = uv[loops, 0] * uv[following, 1] - uv[following, 0] * uv[loops, 1]
    area = np.zeros(len(starts))
    np.add.at(area, face, cross)
    return np.abs(area) / 2


def bake_subset(copies, bake_set, budget=3.0):
    """Trims the bake copies to the faces worth baking: for each baked
    material the largest faces until they cover its texture `budget` times
    over. More faces would only paint over the same texels (thousands of
    tiled floor planks, a row of identical chairs), yet each one costs the
    bake a pass over its whole UV area. Faces of other materials go too."""
    import bmesh

    faces = []
    for c in copies:
        me = c.data
        if not me.uv_layers or not len(me.polygons):
            continue
        slots = np.empty(len(me.polygons), dtype=np.int64)
        me.polygons.foreach_get("material_index", slots)
        sizes = np.empty(len(me.polygons), dtype=np.float64)
        me.polygons.foreach_get("area", sizes)
        uv_area = np.minimum(face_uv_areas(me), 1.0)
        materials = [slot.material for slot in c.material_slots]
        for index in np.flatnonzero(sizes > 0):
            slot = int(slots[index])
            m = materials[slot] if slot < len(materials) else None
            if m in bake_set:
                faces.append((m.name, -float(sizes[index]), id(c), int(index), float(uv_area[index])))
    keep = {}
    covered = {}
    for name, _, owner, index, uv_area in sorted(faces):
        if covered.get(name, 0.0) < budget:
            covered[name] = covered.get(name, 0.0) + uv_area
            keep.setdefault(owner, set()).add(index)
    kept = []
    for c in copies:
        chosen = keep.get(id(c))
        if not chosen:
            mesh = c.data
            bpy.data.objects.remove(c)
            bpy.data.meshes.remove(mesh)
            continue
        if len(chosen) < len(c.data.polygons):
            bm = bmesh.new()
            bm.from_mesh(c.data)
            bm.faces.ensure_lookup_table()
            bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.index not in chosen], context="FACES")
            bm.to_mesh(c.data)
            bm.free()
        kept.append(c)
    say("baking %d of %d faces" % (sum(len(v) for v in keep.values()), len(faces)))
    return kept


def constant_emission(material):
    """The glow of a material whose tree has an Emission shader (or a
    Principled emission) of fixed colour and strength, as [r, g, b,
    strength]: the bake passes only capture how a surface reflects."""
    for node in material.node_tree.nodes:
        if not node.outputs or not node.outputs[0].is_linked:
            continue
        if node.type == "EMISSION":
            color, strength = node.inputs["Color"], node.inputs["Strength"]
        elif node.type == "BSDF_PRINCIPLED":
            color, strength = node.inputs["Emission Color"], node.inputs["Emission Strength"]
        else:
            continue
        if color.is_linked or strength.is_linked or strength.default_value <= 0:
            continue
        if max(color.default_value[:3]) > 0.001:
            return [float(c) for c in color.default_value[:3]] + [float(min(strength.default_value, 10.0))]
    return None


def compose_baked(material, results, work):
    """Textures from the three bake passes: diffuse + glossy colour is the
    base colour (metal shows up as glossy colour without diffuse colour),
    roughness stays a texture only when it varies. Only the pixels the bake
    reached count; the rest take the average so distant mip levels do not
    darken. Returns the material's entry for the bake cache."""
    entry = compose_reflection(material, results, work)
    glow = constant_emission(material)
    if glow:
        entry["emission"] = glow
    return entry


def compose_reflection(material, results, work):
    """The base colour, metalness and roughness part of compose_baked."""
    diffuse, glossy, rough = results["DIFFUSE"], results["GLOSSY"], results["ROUGHNESS"]
    reached = (rough[..., 0] > 0) | (diffuse[..., :3].max(-1) > 0) | (glossy[..., :3].max(-1) > 0)
    if not reached.any():
        # The bake never landed on this material: its viewport colour stands in.
        return {"color": [float(c) for c in material.diffuse_color[:3]], "metallic": 0.0, "roughness": 0.6}
    total = luminance(diffuse) + luminance(glossy)
    share = np.where(total > 1e-4, luminance(glossy) / np.maximum(total, 1e-4), 0.0)
    metal = float(share[reached].mean()) > 0.5
    color = (diffuse + glossy if metal else diffuse).copy()
    color[~reached] = color[reached].mean(0)
    color[..., :3] = to_srgb(color[..., :3])
    color[..., 3] = 1.0
    os.makedirs(work, exist_ok=True)
    safe = re.sub(r"[^A-Za-z0-9_-]+", "_", material.name)
    entry = {"color": safe + "-color.png", "metallic": 1.0 if metal else 0.0}
    write_image(entry["color"], color, os.path.join(work, entry["color"]))
    values = rough[..., 0][reached]
    if float(values.max() - values.min()) > 0.08:
        rough = rough.copy()
        rough[~reached] = float(values.mean())
        rough[..., 3] = 1.0
        entry["roughness"] = safe + "-rough.png"
        write_image(entry["roughness"], rough, os.path.join(work, entry["roughness"]))
    else:
        entry["roughness"] = float(values.mean())
    return entry


def apply_baked(material, entry, work):
    """Rebuilds a material from its baked textures (or the plain colour that
    stood in for a bake that missed it)."""
    def texture(name, srgb):
        image = bpy.data.images.load(os.path.join(work, name), check_existing=True)
        image.colorspace_settings.name = "sRGB" if srgb else "Non-Color"
        return ("image", ImageRef(image))

    color, roughness, glow = entry["color"], entry["roughness"], entry.get("emission")
    rebuild_material(material, plain({
        "color": texture(color, True) if isinstance(color, str) else ("const", (*color, 1.0)),
        "metallic": ("const", entry["metallic"]),
        "roughness": texture(roughness, False) if isinstance(roughness, str) else ("const", roughness),
        "emission": (("const", (*glow[:3], 1.0)), glow[3]) if glow else None,
    }))


# Bump when the bake itself changes; older cached bakes are then redone.
BAKE_VERSION = 2


def bake_cache(work):
    """The baked materials of an earlier conversion of this set (name →
    entry): a big set takes an hour to bake, and its sources never change."""
    try:
        with open(os.path.join(work, "manifest.json")) as f:
            manifest = json.load(f)
    except (OSError, ValueError):
        return {}
    if manifest.get("version") != BAKE_VERSION:
        return {}
    return {name: entry for name, entry in manifest.get("materials", {}).items()
            if all(os.path.exists(os.path.join(work, entry[key])) for key in ("color", "roughness")
                   if isinstance(entry[key], str))}


def bake_materials(scene, materials, objects, work):
    """Bakes the diffuse colour, glossy colour and roughness of every
    procedural material at once: the objects using them are copied, joined
    into one mesh (one scene sync per pass instead of one per object) and
    baked into one texture per material, sized by the area it covers."""
    bake_set = set(materials)
    users = [o for o in objects if any(s.material in bake_set for s in o.material_slots)]
    if not users:
        return {}
    ensure_uv(users)
    areas = {m: 0.0 for m in bake_set}
    for o in users:
        for slot, area in polygon_areas_by_material(o).items():
            m = o.material_slots[slot].material if slot < len(o.material_slots) else None
            if m in areas:
                areas[m] += area
    targets, added, copies = {}, [], []
    scratch = bpy.data.images.new("bake-scratch", 64, 64, float_buffer=True)
    results = {m: {} for m in bake_set}
    try:
        for m in bake_set:
            size = bake_size(areas[m])
            target = bpy.data.images.new("bake-" + m.name, size, size, alpha=False, float_buffer=True)
            target.colorspace_settings.name = "Non-Color"
            node = m.node_tree.nodes.new("ShaderNodeTexImage")
            node.image = target
            m.node_tree.nodes.active = node
            targets[m] = target
            added.append((m, node))
        # Every other material on those objects needs an active image too,
        # or the bake refuses the object; a scratch image catches those, so
        # the bake never paints over a material's own texture.
        for m in {s.material for o in users for s in o.material_slots} - bake_set - {None}:
            if not m.use_nodes:
                m.use_nodes = True
            n = m.node_tree.nodes.new("ShaderNodeTexImage")
            n.image = scratch
            m.node_tree.nodes.active = n
            added.append((m, n))
        for o in users:
            c = o.copy()
            c.data = o.data.copy()
            single_uv_layer(c)
            fold_uvs(c.data)
            scene.collection.objects.link(c)
            copies.append(c)
        copies = bake_subset(copies, bake_set)
        if not copies:
            raise Exception("no face to bake")
        with context_objects(copies):
            bpy.ops.object.join()
        copies = [copies[0]]
        scene.render.engine = "CYCLES"
        scene.cycles.samples = 8
        scene.cycles.use_denoising = False
        scene.render.bake.use_selected_to_active = False
        scene.render.bake.target = "IMAGE_TEXTURES"
        for kind in ("DIFFUSE", "GLOSSY", "ROUGHNESS"):
            t = time.time()
            with context_objects(copies):
                bpy.ops.object.bake(type=kind, pass_filter={"COLOR"}, use_clear=True, margin=4)
            for m in bake_set:
                results[m][kind] = read_pixels(targets[m])
            say("baked the %s pass in %.0f s" % (kind.lower(), time.time() - t))
    finally:
        for c in copies:
            if c.name in bpy.data.objects:
                mesh = c.data
                bpy.data.objects.remove(c)
                bpy.data.meshes.remove(mesh)
        for m, n in added:
            m.node_tree.nodes.remove(n)
        bpy.data.images.remove(scratch)
        for target in targets.values():
            bpy.data.images.remove(target)
    if any(len(r) < 3 for r in results.values()):
        raise Exception("the bake did not finish")
    return {m.name: compose_baked(m, results[m], work) for m in bake_set}


def gltf_occlusion_group():
    """The node group the glTF exporter reads an occlusion map from."""
    group = bpy.data.node_groups.get("glTF Material Output")
    if group is None:
        group = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
        group.interface.new_socket(name="Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
        group.nodes.new("NodeGroupInput")
        group.nodes.new("NodeGroupOutput")
    return group


def texture_from_file(path, work, kind):
    """A DDS/TGA game texture as a PNG the exporter can embed. Normal maps
    are DirectX (green down) and are flipped to glTF's OpenGL convention."""
    name = os.path.splitext(os.path.basename(path))[0]
    png = os.path.join(work, name + ".png")
    if not os.path.exists(png):
        source = bpy.data.images.load(path)
        px = read_pixels(source)
        bpy.data.images.remove(source)
        if kind == "Normal":
            px[..., 1] = 1.0 - px[..., 1]
        if kind == "BaseColor":
            # Byte buffers take display values; the DDS holds sRGB bytes
            # that Blender has already converted to linear.
            px[..., :3] = to_srgb(px[..., :3])
        has_alpha = kind == "BaseColor" and float(px[..., 3].min()) < 0.5
        image = bpy.data.images.new(name, px.shape[1], px.shape[0], alpha=has_alpha, float_buffer=False)
        if not has_alpha:
            px[..., 3] = 1.0
        image.pixels.foreach_set(np.clip(px, 0, 1).astype(np.float32).reshape(-1))
        image.filepath_raw = png
        image.file_format = "PNG"
        image.save()
        bpy.data.images.remove(image)
    image = bpy.data.images.load(png, check_existing=True)
    image.colorspace_settings.name = "sRGB" if kind in ("BaseColor", "Emissive") else "Non-Color"
    return image


def bistro_materials(scene, objects):
    """Amazon Lumberyard Bistro: metal-rough PBR texture sets named after
    their material (<name>_BaseColor/_Specular/_Normal/_Emissive), Specular
    packing R = occlusion, G = roughness, B = metalness, exactly glTF's
    layout. Rebuilds every material straight from those files."""
    textures = os.path.join(os.path.dirname(job["source"]), "Textures")
    work = os.path.join(job["work"], "textures")
    os.makedirs(work, exist_ok=True)
    files = {}
    for f in os.listdir(textures):
        base, ext = os.path.splitext(f)
        if ext.lower() in (".dds", ".tga"):
            files[base.lower()] = os.path.join(textures, f)
    materials = {s.material for o in objects for s in o.material_slots if s.material}
    rebuilt = 0
    for m in materials:
        base = m.name.lower()
        if base + "_basecolor" not in files and m.use_nodes:
            # Fall back to the file the importer found for this material.
            for n in m.node_tree.nodes:
                if n.type == "TEX_IMAGE" and n.image and n.image.filepath:
                    stem = os.path.splitext(os.path.basename(n.image.filepath))[0].lower()
                    base = re.sub(r"_(basecolor|specular|normal|emissive)$", "", stem)
                    break
        found = {kind: files.get(base + "_" + kind.lower()) for kind in ("BaseColor", "Specular", "Normal", "Emissive")}
        if not found["BaseColor"]:
            continue
        m.use_nodes = True
        tree = m.node_tree
        tree.nodes.clear()
        output = tree.nodes.new("ShaderNodeOutputMaterial")
        principled = tree.nodes.new("ShaderNodeBsdfPrincipled")
        tree.links.new(principled.outputs["BSDF"], output.inputs["Surface"])
        color = tree.nodes.new("ShaderNodeTexImage")
        color.image = texture_from_file(found["BaseColor"], work, "BaseColor")
        tree.links.new(color.outputs["Color"], principled.inputs["Base Color"])
        cutout = color.image.alpha_mode != "NONE" and color.image.channels == 4 and color.image.depth == 32
        if cutout:
            tree.links.new(color.outputs["Alpha"], principled.inputs["Alpha"])
            m.blend_method = "CLIP"
            m.surface_render_method = "DITHERED"
            m.alpha_threshold = 0.5
        else:
            m.blend_method = "OPAQUE"
        if found["Specular"]:
            orm = tree.nodes.new("ShaderNodeTexImage")
            orm.image = texture_from_file(found["Specular"], work, "Specular")
            split = tree.nodes.new("ShaderNodeSeparateColor")
            tree.links.new(orm.outputs["Color"], split.inputs["Color"])
            tree.links.new(split.outputs["Green"], principled.inputs["Roughness"])
            tree.links.new(split.outputs["Blue"], principled.inputs["Metallic"])
            # Falcor never read the occlusion channel, so most of these maps
            # carry zero there; shipped as occlusion it would black out every
            # surface lit by ambient light. Only a map with real occlusion
            # data keeps it.
            if float(read_pixels(orm.image)[..., 0].mean()) >= 0.35:
                occlusion = tree.nodes.new("ShaderNodeGroup")
                occlusion.node_tree = gltf_occlusion_group()
                tree.links.new(split.outputs["Red"], occlusion.inputs["Occlusion"])
        else:
            principled.inputs["Roughness"].default_value = 0.6
        if found["Normal"]:
            normal = tree.nodes.new("ShaderNodeTexImage")
            normal.image = texture_from_file(found["Normal"], work, "Normal")
            normal_map = tree.nodes.new("ShaderNodeNormalMap")
            tree.links.new(normal.outputs["Color"], normal_map.inputs["Color"])
            tree.links.new(normal_map.outputs["Normal"], principled.inputs["Normal"])
        if found["Emissive"]:
            emissive = tree.nodes.new("ShaderNodeTexImage")
            emissive.image = texture_from_file(found["Emissive"], work, "Emissive")
            tree.links.new(emissive.outputs["Color"], principled.inputs["Emission Color"])
            principled.inputs["Emission Strength"].default_value = 2.0
        else:
            principled.inputs["Emission Strength"].default_value = 0.0
        m.use_backface_culling = False
        m["sceneMakerRebuilt"] = True
        rebuilt += 1
    say("rebuilt %d of %d Bistro materials from their texture sets" % (rebuilt, len(materials)))


def prepare_materials(scene, objects):
    materials = {}
    for o in objects:
        if not o.material_slots:
            o.data.materials.append(bpy.data.materials.get("untextured") or bpy.data.materials.new("untextured"))
        for slot in o.material_slots:
            if slot.material is None:
                slot.material = bpy.data.materials.get("untextured") or bpy.data.materials.new("untextured")
            materials[slot.material.name] = slot.material
    counts = {"kept": 0, "simplified": 0, "baked": 0, "failed": 0}
    to_bake = []
    for material in materials.values():
        if not material.use_nodes or material.node_tree is None:
            color, roughness, metallic = material.diffuse_color[:3], material.roughness, material.metallic
            material.use_nodes = True
            p = material.node_tree.nodes.get("Principled BSDF")
            if p is not None:
                p.inputs["Base Color"].default_value = (*color, 1.0)
                p.inputs["Roughness"].default_value = roughness
                p.inputs["Metallic"].default_value = metallic
            counts["kept"] += 1
            continue
        if material.get("sceneMakerRebuilt"):
            counts["kept"] += 1
            continue
        try:
            rebuild_material(material, Simplifier(material).shader(output_shader_socket(material)))
            counts["simplified"] += 1
        except Unsupported as reason:
            if str(reason) in ("no shader", "no output"):
                rebuild_material(material, plain({"color": ("const", (0.7, 0.7, 0.7, 1.0))}))
                counts["simplified"] += 1
            elif glass_like(material):
                rebuild_material(material, plain(GLASS))
                counts["simplified"] += 1
            else:
                to_bake.append((material, str(reason)))
    work = os.path.join(job["work"], "baked")
    cached = bake_cache(work)
    reused = [(m, why) for m, why in to_bake if m.name in cached]
    for material, _ in reused:
        apply_baked(material, cached[material.name], work)
    to_bake = [(m, why) for m, why in to_bake if m.name not in cached]
    if reused:
        say("reused the earlier bake of %d procedural materials" % len(reused))
        counts["baked"] += len(reused)
    if to_bake:
        device = use_gpu(scene)
        say("baking %d procedural materials on the %s: %s" % (
            len(to_bake), device, ", ".join("%s (%s)" % (m.name, why) for m, why in to_bake[:12])))
        try:
            baked = bake_materials(scene, [m for m, _ in to_bake], objects, work)
        except Exception as error:
            traceback.print_exc()
            say("baking failed, those materials keep a plain colour: %s" % error)
            for material, _ in to_bake:
                rebuild_material(material, plain({"color": ("const", (0.6, 0.6, 0.6, 1.0))}))
                counts["failed"] += 1
        else:
            for material, _ in to_bake:
                apply_baked(material, baked[material.name], work)
            counts["baked"] += len(baked)
            with open(os.path.join(work, "manifest.json"), "w") as f:
                json.dump({"version": BAKE_VERSION, "materials": {**cached, **baked}}, f, indent=1)
    return counts


def limit_textures(objects, limit):
    """Downscale textures above `limit` px; drop unreadable ones."""
    nodes_by_image = {}
    for o in objects:
        for slot in o.material_slots:
            m = slot.material
            if m and m.use_nodes:
                for n in m.node_tree.nodes:
                    if n.type == "TEX_IMAGE" and n.image:
                        nodes_by_image.setdefault(n.image, []).append((m, n))
    largest, scaled = 0, 0
    for image, nodes in nodes_by_image.items():
        w, h = image.size
        if w == 0 or h == 0:
            say("texture %s is unreadable; its materials keep a plain colour" % image.name)
            for m, n in nodes:
                m.node_tree.nodes.remove(n)
            continue
        if max(w, h) > limit:
            scale = limit / max(w, h)
            image.scale(max(1, round(w * scale)), max(1, round(h * scale)))
            scaled += 1
        largest = max(largest, max(image.size))
    return len(nodes_by_image), scaled, largest


# ---------------------------------------------------------------- geometry
def world_triangles(objects):
    """Every triangle of the exported meshes in world space: (n, 3, 3)
    vertices and the index of the owning object per triangle."""
    chunks, owners = [], []
    for index, o in enumerate(objects):
        me = o.data
        if not len(me.polygons):
            continue
        tris = me.loop_triangles
        n = len(tris)
        tri = np.empty(n * 3, dtype=np.int32)
        tris.foreach_get("vertices", tri)
        co = np.empty(len(me.vertices) * 3, dtype=np.float64)
        me.vertices.foreach_get("co", co)
        m = np.array(o.matrix_world, dtype=np.float64)
        world = co.reshape(-1, 3) @ m[:3, :3].T + m[:3, 3]
        chunks.append(world[tri].reshape(n, 3, 3))
        owners.append(np.full(n, index, dtype=np.int32))
    if not chunks:
        raise Exception("the scene has no geometry")
    return np.concatenate(chunks), np.concatenate(owners)


def triangle_areas(tris):
    cross = np.cross(tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0])
    area = np.linalg.norm(cross, axis=1) / 2
    up = np.zeros(len(tris))
    ok = area > 1e-9
    up[ok] = cross[ok, 2] / (2 * area[ok])
    return area, up


def floor_levels(tris):
    """Candidate floors: every level holding a real share of the upward-
    facing horizontal area in a 2 cm histogram of triangle heights, lowest
    first, as (z, area). A thin shadow catcher or a kerb does not count."""
    area, up = triangle_areas(tris)
    flat = (up > 0.95) & ((tris[:, :, 2].max(1) - tris[:, :, 2].min(1)) < 0.01)
    if not flat.any():
        raise Exception("no horizontal floor was found")
    z = tris[flat].mean(1)[:, 2]
    w = area[flat]
    edges = np.arange(z.min() - 0.01, z.max() + 0.03, 0.02)
    hist, edges = np.histogram(z, bins=edges, weights=w)
    hinted = job.get("floorLevel") is not None
    # A hinted level may be small next to a landscape plane: any real area.
    threshold = 0.5 if hinted else max(0.12 * hist.max(), min(4.0, 0.05 * w.sum()))
    levels = []
    index = 0
    while index < len(hist):
        if hist[index] < threshold:
            index += 1
            continue
        # Neighbouring bins over the threshold are one floor straddling an edge.
        end = index
        while end + 1 < len(hist) and hist[end + 1] >= threshold:
            end += 1
        inside = (z >= edges[index]) & (z < edges[end + 1])
        levels.append((float((z[inside] * w[inside]).sum() / w[inside].sum()), float(w[inside].sum())))
        index = end + 1
    if hinted:
        wanted = float(job["floorLevel"])
        levels = [min(levels, key=lambda level: abs(level[0] - wanted))]
    return levels


def scene_bvh(tris):
    """One BVH over every world-space triangle: scene.ray_cast walks each
    object's tree per ray, far too slow for the thousands of probes below."""
    vertices = [tuple(v) for v in tris.reshape(-1, 3)]
    polygons = [(3 * i, 3 * i + 1, 3 * i + 2) for i in range(len(tris))]
    return BVHTree.FromPolygons(vertices, polygons, all_triangles=True)


def enclosed(bvh, floor_z, cells, lo, step):
    """The cells with walls around them: of eight level rays from chest
    height, at least six meet something within 15 m. A terrace under a
    balcony is covered but open on most sides; a room is not."""
    result = np.zeros(cells.shape, dtype=bool)
    directions = [Vector((math.cos(a), math.sin(a), 0)) for a in np.arange(8) * math.pi / 4]
    for i, j in np.argwhere(cells):
        origin = Vector((lo[0] + i * step, lo[1] + j * step, floor_z + 1.2))
        hits = sum(1 for d in directions if bvh.ray_cast(origin, d, 15.0)[0] is not None)
        result[i, j] = hits >= 6
    return result


def floor_grid(bvh, tris, floor_z, step):
    """Walkable cells: a ray from head height straight down lands on the
    floor level with nothing in between."""
    lo = tris[:, :, :2].min((0, 1)) - step
    hi = tris[:, :, :2].max((0, 1)) + step
    nx = int((hi[0] - lo[0]) / step) + 1
    ny = int((hi[1] - lo[1]) / step) + 1
    grid = np.zeros((nx, ny), dtype=bool)
    covered = np.zeros((nx, ny), dtype=bool)
    head = floor_z + float(job.get("headroom", 1.9))
    down, up = Vector((0, 0, -1)), Vector((0, 0, 1))
    for i in range(nx):
        x = lo[0] + i * step
        for j in range(ny):
            origin = Vector((x, lo[1] + j * step, head))
            location, normal, *_ = bvh.ray_cast(origin, down, head - floor_z + 0.3)
            # A rug or a threshold still counts; a terrace 4 cm lower does not.
            if location is not None and -0.02 <= location.z - floor_z <= 0.03 and abs(normal.z) > 0.7:
                grid[i, j] = True
                covered[i, j] = bvh.ray_cast(origin, up, 12.0)[0] is not None
    return grid, covered, lo


def components(mask):
    """4-connected components of a boolean grid; labels and sizes."""
    nx, ny = mask.shape
    labels = np.zeros(mask.shape, dtype=np.int32)
    sizes = [0]
    for i in range(nx):
        for j in range(ny):
            if not mask[i, j] or labels[i, j]:
                continue
            label = len(sizes)
            sizes.append(0)
            stack = [(i, j)]
            labels[i, j] = label
            while stack:
                a, b = stack.pop()
                sizes[label] += 1
                for c, d in ((a + 1, b), (a - 1, b), (a, b + 1), (a, b - 1)):
                    if 0 <= c < nx and 0 <= d < ny and mask[c, d] and not labels[c, d]:
                        labels[c, d] = label
                        stack.append((c, d))
    return labels, sizes


def clearance(mask, step):
    """Distance (m) from each walkable cell to the nearest blocked cell."""
    nx, ny = mask.shape
    dist = np.where(mask, nx + ny, 0).astype(np.int64)
    for i in range(nx):
        for j in range(ny):
            if dist[i, j]:
                if i > 0:
                    dist[i, j] = min(dist[i, j], dist[i - 1, j] + 1)
                if j > 0:
                    dist[i, j] = min(dist[i, j], dist[i, j - 1] + 1)
    for i in range(nx - 1, -1, -1):
        for j in range(ny - 1, -1, -1):
            if dist[i, j]:
                if i < nx - 1:
                    dist[i, j] = min(dist[i, j], dist[i + 1, j] + 1)
                if j < ny - 1:
                    dist[i, j] = min(dist[i, j], dist[i, j + 1] + 1)
    return dist.astype(np.float64) * step


def trace_outline(mask):
    """The outer boundary of a blob as a closed list of cell coordinates,
    by Moore-neighbour tracing (clockwise around each boundary cell)."""
    pad = np.pad(mask, 1)
    cells = np.argwhere(pad)
    if not len(cells):
        return []
    start = (int(cells[0][0]), int(cells[0][1]))
    # Neighbours clockwise, starting north: N, NE, E, SE, S, SW, W, NW.
    around = [(-1, 0), (-1, 1), (0, 1), (1, 1), (1, 0), (1, -1), (0, -1), (-1, -1)]
    outline = [start]
    current = start
    # The scan reached `start` from the west, which is outside the blob.
    backtrack = (start[0], start[1] - 1)
    for _ in range(4 * len(cells) + 8):
        offset = (backtrack[0] - current[0], backtrack[1] - current[1])
        k = around.index(offset)
        found = None
        for step in range(1, 9):
            candidate_offset = around[(k + step) % 8]
            candidate = (current[0] + candidate_offset[0], current[1] + candidate_offset[1])
            if pad[candidate]:
                found = candidate
                break
            backtrack = candidate
        if found is None:
            break
        current = found
        if current == start:
            break
        outline.append(current)
    return [(i - 1, j - 1) for i, j in outline]


def simplify(points, tolerance):
    """Ramer–Douglas–Peucker on a closed polygon."""
    if len(points) < 4:
        return points
    pts = np.array(points, dtype=np.float64)

    def rdp(seg):
        if len(seg) < 3:
            return [seg[0], seg[-1]]
        a, b = seg[0], seg[-1]
        ab = b - a
        norm = np.linalg.norm(ab)
        d = np.linalg.norm(seg - a, axis=1) if norm < 1e-9 else np.abs(np.cross(ab, seg - a)) / norm
        k = int(np.argmax(d))
        if d[k] > tolerance:
            return rdp(seg[: k + 1])[:-1] + rdp(seg[k:])
        return [seg[0], seg[-1]]

    far = int(np.argmax(np.linalg.norm(pts - pts[0], axis=1)))
    first = rdp(pts[: far + 1])[:-1]
    second = rdp(np.concatenate([pts[far:], pts[:1]]))[:-1]
    return [tuple(p) for p in first + second]


def analyse_floor(scene, tris, owners):
    """The floor the cast lives on. Each candidate level is probed for open
    floor; an indoor set takes the level with the most floor walled in (a
    lawn outside the windows, or a terrace under the balcony, is larger but
    wrong), an outdoor one the most open floor, and the lowest level that
    comes close wins, so a ground floor beats the storey above it."""
    extent = tris[:, :, :2].max((0, 1)) - tris[:, :, :2].min((0, 1))
    step = 0.15 if max(extent) < 25 else (0.3 if max(extent) < 80 else 0.6)
    # The five largest levels, lowest first, keep the probing affordable.
    levels = sorted(sorted(floor_levels(tris), key=lambda level: -level[1])[:5])
    indoor = job.get("indoor")
    bvh = scene_bvh(tris)
    candidates = []
    for z, _ in levels:
        grid, covered, lo = floor_grid(bvh, tris, z, step)
        under = grid & covered
        walled = enclosed(bvh, z, under, lo, step) if indoor else under
        candidates.append((z, grid, covered, lo, int(grid.sum()), int(walled.sum())))
    # An indoor set without a walled-in level (a stage, a pergola) falls
    # back to the most open floor.
    for score in ([lambda c: c[5]] if indoor else []) + [lambda c: c[4]]:
        best = max(score(c) for c in candidates)
        if best > 0:
            break
    if best <= 0:
        raise Exception("no open floor was found at any floor level")
    floor_z, grid, covered, lo, open_cells, under = next(c for c in candidates if score(c) >= 0.5 * best)
    say("floor levels: " + ", ".join(
        "%.2f m (%d open, %d %s)" % (c[0], c[4], c[5], "walled in" if indoor else "covered") for c in candidates))
    if indoor is None:
        # A room whose floor continues outside (a garden plane, a street)
        # keeps the cast under its ceiling; an open-air set has little cover.
        indoor = under >= 0.3 * open_cells
    if indoor:
        grid &= covered
    labels, sizes = components(grid)
    main = labels == int(np.argmax(sizes))
    say("floor at z=%.3f, %d open cells of %.2f m in %d regions%s" % (
        floor_z, main.sum(), step, len(sizes) - 1, ", under a ceiling" if indoor else ""))
    return {"z": floor_z, "main": main, "lo": lo, "step": step, "clearance": clearance(main, step),
            "bvh": bvh, "owners": owners, "indoor": bool(indoor)}


def cell_center(floor, i, j):
    return Vector((floor["lo"][0] + i * floor["step"], floor["lo"][1] + j * floor["step"], floor["z"]))


def best_cell(floor, near=None, min_clear=0.5, radius=3.0, fallback=True):
    """The open cell to stand on: near a wanted spot when given (None when
    nothing is open within `radius` and no fallback is wanted), otherwise
    the roomiest cell, slightly preferring the middle of the floor."""
    main, clear, step = floor["main"], floor["clearance"], floor["step"]
    nx, ny = main.shape
    xs, ys = np.meshgrid(np.arange(nx), np.arange(ny), indexing="ij")
    ok = main & (clear >= min_clear)
    if near is not None:
        d = np.hypot(floor["lo"][0] + xs * step - near.x, floor["lo"][1] + ys * step - near.y)
        if (ok & (d <= radius)).any():
            score = np.where(ok & (d <= radius), d - 0.25 * np.minimum(clear, 1.5), np.inf)
            return tuple(int(k) for k in np.unravel_index(int(np.argmin(score)), score.shape))
        if not fallback:
            return None
    if not ok.any():
        ok = main
    centre = ((nx - 1) / 2, (ny - 1) / 2)
    score = np.where(ok, clear - 0.02 * step * np.hypot(xs - centre[0], ys - centre[1]), -np.inf)
    return tuple(int(k) for k in np.unravel_index(int(np.argmax(score)), score.shape))


def walkable_polygon(floor, cell, transform):
    """The open floor around the spawn as a simplified outline in glTF xz."""
    main, step = floor["main"], floor["step"]
    keep = main & (floor["clearance"] >= step * 1.5)
    if not keep[cell]:
        keep = main
    labels, sizes = components(keep)
    blob = labels == (labels[cell] or int(np.argmax(sizes)))
    outline = trace_outline(blob)
    points = [(floor["lo"][0] + i * step, floor["lo"][1] + j * step) for i, j in outline]
    if len(points) < 3:
        return []
    tolerance = step * 0.7
    poly = simplify(points, tolerance)
    while len(poly) > 48:
        tolerance *= 1.5
        poly = simplify(points, tolerance)
    result = []
    for x, y in poly:
        v = transform @ Vector((x, y, floor["z"]))
        result.append([round(v.x, 2), round(-v.y, 2)])
    return result


# ------------------------------------------------------------------ camera
# The studio's camera: 38° vertical field of view on a 16:10 frame. The home
# view is judged, and the thumbnail rendered, with the same lens.
VIEW_HEIGHT = math.radians(38.0)
VIEW_ASPECT = 1.6
EYE_HEIGHT = 1.6
# Sixteen level directions around a point, for distances to walls.
RING = [Vector((math.cos(a), math.sin(a), 0.0)) for a in np.arange(16) * (math.pi / 8)]


def aim_point(position, forward, floor_z):
    """Where a camera looks: its line of sight meeting the floor, or 4 m
    ahead when it looks level."""
    if forward.z < -0.05:
        return position + forward * min((floor_z - position.z) / forward.z, 12.0)
    return position + forward * 4.0


def camera_candidates(scene):
    """The job's named camera, then the active one, then the rest by name."""
    cams = [o for o in scene.objects if o.type == "CAMERA"]
    first = [c for c in (scene.objects.get(job.get("camera") or ""), scene.camera) if c in cams]
    return first + sorted((c for c in cams if c not in first), key=lambda c: c.name)


def wall_distance(floor, point, reach=12.0):
    """How far `point` is from the nearest wall, column or tall cupboard:
    the shortest of sixteen level rays around it."""
    nearest = reach
    for direction in RING:
        hit = floor["bvh"].ray_cast(point, direction, reach)
        if hit[0] is not None:
            nearest = min(nearest, hit[3])
    return nearest


def in_sight(floor, position, spot):
    """Nothing stands between the camera and the cast's head and chest (a
    glass on the table in front may still hide the knees)."""
    for height in (1.55, 1.0):
        line = spot + Vector((0, 0, height)) - position
        if floor["bvh"].ray_cast(position, line.normalized(), line.length - 0.25)[0] is not None:
            return False
    return True


def view_score(floor, position, target, shells, columns=14, rows=9):
    """How much of the set a view shows: rays across the frame count the
    distinct pieces of furniture in sight and how deep the view reaches. A
    lens close to a surface, anything but floor between the lens and the
    cast (a door frame, chair backs: a view squeezed through a doorway),
    back faces (inside a wall, outside the room) and, indoors, open sky
    count against it."""
    bvh, owners = floor["bvh"], floor["owners"]
    forward = (target - position).normalized()
    before_cast = 0.8 * (target - position).length
    right = forward.cross(Vector((0, 0, 1))).normalized()
    up = right.cross(forward)
    half_h = math.tan(VIEW_HEIGHT / 2)
    half_w = half_h * VIEW_ASPECT
    seen, depths = set(), []
    near = backs = misses = blocked = 0
    for a in range(columns):
        x = ((a + 0.5) / columns * 2 - 1) * half_w
        for b in range(rows):
            y = ((b + 0.5) / rows * 2 - 1) * half_h
            direction = (forward + right * x + up * y).normalized()
            location, normal, index, distance = bvh.ray_cast(position, direction, 80.0)
            if location is None:
                misses += 1
                continue
            depths.append(distance)
            near += distance < 1.2
            blocked += distance < before_cast and abs(normal.z) < 0.7
            backs += normal.dot(direction) > 0.1
            owner = int(owners[index])
            if owner not in shells:
                seen.add(owner)
    total = columns * rows
    depth = float(np.median(np.log(np.clip(depths, 0.5, 40.0)))) if depths else 0.0
    sky = misses / total if floor["indoor"] else 0.0
    # Fewer rays see fewer pieces: scale the count to the full frame's 126.
    pieces = len(seen) * 126.0 / total
    return (1.5 * math.log1p(pieces) + 0.6 * depth - 8.0 * backs / total - 6.0 * near / total
            - 6.0 * blocked / total - 4.0 * sky)


def spread_cells(floor, ok, count, spacing):
    """Up to `count` cells of `ok`, roomiest first, at least `spacing` metres
    apart, so the search covers the whole floor."""
    clear, step = floor["clearance"], floor["step"]
    cells = np.argwhere(ok)
    order = np.argsort(-clear[ok], kind="stable")
    chosen = []
    for k in order:
        i, j = (int(v) for v in cells[k])
        if all(math.hypot(i - a, j - b) * step >= spacing for a, b in chosen):
            chosen.append((i, j))
            if len(chosen) >= count:
                break
    return chosen


def artist_views(scene, floor):
    """The artist's cameras that can open the set: about eye height over the
    chosen floor, looking roughly level, standing on open floor and aimed at
    some. Yields (camera, position, spawn cell)."""
    z = floor["z"]
    for cam in camera_candidates(scene):
        position = cam.matrix_world.translation.copy()
        forward = (cam.matrix_world.to_quaternion() @ Vector((0, 0, -1))).normalized()
        height = position.z - z
        why = None
        if not (1.0 <= height <= 2.2):
            why = "%.1f m above the floor" % height
        elif abs(forward.z) > 0.5:
            why = "it looks up or down"
        elif best_cell(floor, near=position, min_clear=0.0, radius=max(0.3, floor["step"] * 1.5),
                       fallback=False) is None:
            why = "it stands off the open floor"
        else:
            spot = best_cell(floor, near=aim_point(position, forward, z), min_clear=0.45, radius=4.0,
                             fallback=False)
            if spot is not None and (cell_center(floor, *spot) - position).xy.length < 2.0:
                # The camera sits on the spot itself: step the cast forward.
                spot = best_cell(floor, near=position + forward * 3.0, min_clear=0.45, radius=3.0,
                                 fallback=False)
            if spot is None:
                why = "it looks away from the open floor"
            else:
                yield cam, position, spot
                continue
        say("the artist's camera %s is not a home view: %s" % (cam.name.strip(), why))


def wall_penalty(wall, berth):
    """What standing close to a wall costs a view: nothing from `berth` out,
    growing steeply toward the 0.4 m a camera needs at the least."""
    return 4.0 * (max(0.0, berth - wall) / berth) ** 1.5


def focus_point(objects):
    """The centre of the objects the set's `focus` hint names (a terrace's
    tables, a living room's sofa), or None."""
    if not job.get("focus"):
        return None
    pattern = re.compile(job["focus"], re.I)
    centres = [o.matrix_world @ (sum((Vector(c) for c in o.bound_box), Vector()) / 8)
               for o in objects if pattern.search(o.name)]
    if not centres:
        say("nothing matches the focus %s" % job["focus"])
        return None
    return sum(centres, Vector()) / len(centres)


def focus_bonus(focus, position, target):
    """How squarely a view frames the focus: up to 2 points when it lies at
    the centre of the frame, nothing beyond the frame's edge."""
    if focus is None:
        return 0.0
    look, toward = (target - position).xy, (focus - position).xy
    if toward.length < 0.5 or toward.length > 25.0:
        return 0.0
    angle = abs(look.angle_signed(toward))
    edge = math.atan(math.tan(VIEW_HEIGHT / 2) * VIEW_ASPECT)
    return 2.0 * max(0.0, 1.0 - angle / edge)


def choose_view(scene, floor, shells, focus=None):
    """Spawn cell, camera position and view target in the source frame.

    The camera stands on the open floor at eye height, 1.5 m or more from
    any wall where the room allows it, with the cast in clear sight, and
    looks at the cast across the most furnished part of the set. A coarse
    look at every candidate picks the 40 most promising for a full look.
    The artist's own camera wins when it meets the same rules and shows
    about as much."""
    main, clear, step = floor["main"], floor["clearance"], floor["step"]
    nx, ny = main.shape
    indoor = floor["indoor"]
    standing = main & (clear >= 0.6)
    if standing.sum() < 4:
        standing = main & (clear >= 0.4)
    if not standing.any():
        standing = main
    # About 40 spawn points spread over the open floor, roomiest first.
    area = float(standing.sum()) * step * step
    spacing = max(1.0 if indoor else 3.0, math.sqrt(area / 40.0))
    spawns = spread_cells(floor, standing, 40, spacing)
    if focus is not None:
        # Spots in front of the focus, where the cast would stand.
        xs, ys = np.meshgrid(np.arange(nx), np.arange(ny), indexing="ij")
        reach = np.hypot(floor["lo"][0] + xs * step - focus.x, floor["lo"][1] + ys * step - focus.y)
        near_focus = standing & (reach >= 1.5) & (reach <= 6.0)
        spawns += [c for c in spread_cells(floor, near_focus, 24, 1.5) if c not in spawns]
    # Small rooms only allow a short step back; longer ones score better.
    distances = (1.6, 2.2, 2.9, 3.6, 4.5) if indoor else (4.0, 5.5, 7.0, 9.0)
    prefer = 3.5 if indoor else 6.0
    eye = Vector((0, 0, EYE_HEIGHT))
    walls = {}

    def wall_at(cell):
        if cell not in walls:
            walls[cell] = wall_distance(floor, cell_center(floor, *cell) + eye)
        return walls[cell]

    options = []
    for spawn in spawns:
        spot = cell_center(floor, *spawn)
        for k in range(16):
            angle = 2 * math.pi * k / 16
            for distance in distances:
                ci = int(round(spawn[0] + math.cos(angle) * distance / step))
                cj = int(round(spawn[1] + math.sin(angle) * distance / step))
                if not (0 <= ci < nx and 0 <= cj < ny and main[ci, cj]):
                    continue
                wall = wall_at((ci, cj))
                position = cell_center(floor, ci, cj) + eye
                if wall >= 0.4 and in_sight(floor, position, spot):
                    options.append((wall, distance, spawn, position))
    # A small room cannot keep 1.5 m from every wall: the berth shrinks
    # with the widest open space the floor offers.
    berth = min(1.5, max(0.6, 0.6 * max(walls.values(), default=1.5)))
    rough = []
    for wall, distance, spawn, position in options:
        target = cell_center(floor, *spawn) + Vector((0, 0, 1.0))
        bonus = 0.4 * min(distance, prefer) - wall_penalty(wall, berth) + focus_bonus(focus, position, target)
        rough.append((view_score(floor, position, target, shells, 6, 4) + bonus, bonus, spawn, position))
    rough.sort(key=lambda option: -option[0])
    best = None
    for _, bonus, spawn, position in rough[:40]:
        target = cell_center(floor, *spawn) + Vector((0, 0, 1.0))
        score = view_score(floor, position, target, shells) + bonus
        if best is None or score > best[0]:
            best = (score, spawn, position, None)
    for cam, position, spawn in artist_views(scene, floor):
        wall = wall_distance(floor, position)
        spot = cell_center(floor, *spawn)
        if wall < 0.4:
            say("the artist's camera %s is not a home view: %.1f m from a wall" % (cam.name.strip(), wall))
            continue
        if not in_sight(floor, position, spot):
            say("the artist's camera %s is not a home view: something hides the cast" % cam.name.strip())
            continue
        # The artist's composition is worth a little furniture.
        target = spot + Vector((0, 0, 1.0))
        score = (view_score(floor, position, target, shells) - wall_penalty(wall, berth)
                 + 0.4 * min((position - spot).xy.length, prefer) + focus_bonus(focus, position, target) + 1.0)
        if best is None or score > best[0]:
            best = (score, spawn, position, cam)
    if best is None:
        raise Exception("no spot on the open floor sees the cast")
    score, spawn, position, cam = best
    spot = cell_center(floor, *spawn)
    say("home view %s, %.1f m from the cast and %.1f m from the nearest wall (berth %.1f m; "
        "score %.2f, best of %d views)" % (
            "from the artist's camera " + cam.name.strip() if cam else "fitted at eye height",
            (position - spot).xy.length, wall_distance(floor, position), berth, score, len(rough)))
    return spawn, spot, position, spot + Vector((0, 0, 1.0)), cam


def place(scene, spawn, camera_position):
    """Moves the spawn to the origin with the floor at z = 0 and turns the
    set by a right angle so the home camera lies toward -Y (glTF +Z, within
    45°). Keeping the room's own axes keeps every bounding box tight; the
    cast's heading turns it the rest of the way toward the camera."""
    to_camera = (camera_position - spawn).xy
    angle = math.atan2(to_camera.y, to_camera.x)
    turn = round((-math.pi / 2 - angle) / (math.pi / 2)) * (math.pi / 2)
    transform = Matrix.Rotation(turn, 4, "Z") @ Matrix.Translation(-spawn)
    for o in [o for o in scene.objects if o.parent is None]:
        o.matrix_world = transform @ o.matrix_world
    bpy.context.view_layer.update()
    return transform


# ------------------------------------------------------------------- roles
# A face of the walkable floor: facing up, within this band of the floor level.
FLOOR_BAND = (-0.015, 0.03)


def classify_roles(objects, tris, owners, floor_z):
    """The part each mesh plays, by object name: "floor" for meshes that
    are the floor, "split" for meshes whose floor faces must become a floor
    mesh of their own (a slab, a plinth, a whole street with its kerbs),
    "shell" for walls, ceilings and the like by name."""
    area, up = triangle_areas(tris)
    level = tris[:, :, 2] - floor_z
    at_floor = (up > 0.95) & (level.min(1) >= FLOOR_BAND[0]) & (level.max(1) <= FLOOR_BAND[1])
    floor_area = np.bincount(owners[at_floor], weights=area[at_floor], minlength=len(objects))
    total_area = np.bincount(owners, weights=area, minlength=len(objects))
    lowest = np.full(len(objects), np.inf)
    np.minimum.at(lowest, owners, level.min(1))
    roles = {}
    for index, o in enumerate(objects):
        if floor_area[index] >= 1.0:
            whole = lowest[index] >= FLOOR_BAND[0] and floor_area[index] >= 0.3 * total_area[index]
            roles[o.name] = "floor" if whole else "split"
        elif job.get("shellNames", True) and SHELL_NAMES.search(o.name) and max(o.dimensions) > 2.5:
            roles[o.name] = "shell"
    return roles


def shell_indices(objects, roles):
    """Objects that are the set's shell rather than furniture, by index:
    tagged ones and anything spanning 5 m both ways."""
    shells = set()
    for index, o in enumerate(objects):
        corners = [o.matrix_world @ Vector(c) for c in o.bound_box]
        xs, ys = [c.x for c in corners], [c.y for c in corners]
        if o.name in roles or (max(xs) - min(xs) >= 5.0 and max(ys) - min(ys) >= 5.0):
            shells.add(index)
    return shells


def split_floor(scene, o):
    """Moves the floor faces of `o` (the floor now at z = 0) into a mesh of
    their own. Returns the new object, or None when no face qualified."""
    import bmesh

    if o.data.users > 1:
        o.data = o.data.copy()
    matrix = o.matrix_world
    normals = matrix.to_3x3().inverted_safe().transposed()
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bm.verts.index_update()
    heights = [(matrix @ v.co).z for v in bm.verts]
    # A face layer marks the floor faces; it survives the copy below.
    mark = bm.faces.layers.int.new("sceneMakerFloor")
    count = 0
    for face in bm.faces:
        face[mark] = int((normals @ face.normal).normalized().z > 0.95 and all(
            FLOOR_BAND[0] <= heights[v.index] <= FLOOR_BAND[1] for v in face.verts))
        count += face[mark]
    if count == 0 or count == len(bm.faces):
        bm.free()
        return None
    rest = bm.copy()
    rest_mark = rest.faces.layers.int.get("sceneMakerFloor")
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if not f[mark]], context="FACES")
    bmesh.ops.delete(rest, geom=[f for f in rest.faces if f[rest_mark]], context="FACES")
    bm.faces.layers.int.remove(mark)
    rest.faces.layers.int.remove(rest_mark)
    piece = o.copy()
    piece.data = o.data.copy()
    piece.name = o.name + " floor"
    for collection in o.users_collection:
        collection.objects.link(piece)
    bm.to_mesh(piece.data)
    rest.to_mesh(o.data)
    bm.free()
    rest.free()
    piece.data.update()
    o.data.update()
    return piece


def apply_roles(scene, objects, roles):
    """Writes each mesh's role as the glTF extra sceneMaker.role, splitting
    the floor faces off meshes that reach below the floor; what remains of
    those is shell (a slab never stops the cast)."""
    counts = {"floor": 0, "shell": 0}
    result = []
    for o in objects:
        role = roles.get(o.name)
        if role == "split":
            piece = split_floor(scene, o)
            if piece is not None:
                piece["sceneMaker"] = {"role": "floor"}
                counts["floor"] += 1
                result.append(piece)
            role = "shell"
        if role:
            o["sceneMaker"] = {"role": role}
            counts[role] += 1
        result.append(o)
    return result, counts


# -------------------------------------------------------------- thumbnail
# The studio's backdrop behind an indoor set: the daylight preset a new
# scene starts with (#dce1dc, linear).
STUDIO_BACKDROP = (0.716, 0.753, 0.716, 1.0)


def hdri_exposure(image):
    """The studio exposure for a set lit by this HDR: a floor of albedo 0.45
    lit by its sky (sun included) shows at 60 % white through the studio's
    ACES tone mapping, which needs 0.425 going in after its 1/0.6 scale, so
    the exposure is 0.425 × 0.6 / 0.45 = 0.567 over the sky's mean radiance
    (cosine-weighted over the upper half)."""
    px = read_pixels(image)
    rows, width = px.shape[:2]
    # Rows run bottom to top; the upper half is the sky.
    elevation = ((np.arange(rows) + 0.5) / rows - 0.5) * np.pi
    weight = np.where(elevation > 0, np.sin(elevation) * np.cos(elevation), 0.0)[:, None]
    radiance = float((luminance(px) * weight).sum() / (weight.sum() * width))
    return min(3.0, max(0.15, 0.567 / max(radiance, 1e-4)))


def light_like_studio(scene, path, sky):
    """Lights the scene as the studio lights the set: the set's HDR is the
    only light (its sun included, so the artist's lamps go), seen behind the
    set when it is the sky and otherwise replaced there by the studio's
    plain backdrop. Returns the HDR's studio exposure."""
    for o in [o for o in scene.objects if o.type == "LIGHT"]:
        bpy.data.objects.remove(o)
    image = bpy.data.images.load(path, check_existing=True)
    world = bpy.data.worlds.new("set light")
    world.use_nodes = True
    nodes, links = world.node_tree.nodes, world.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputWorld")
    texture = nodes.new("ShaderNodeTexEnvironment")
    texture.image = image
    light = nodes.new("ShaderNodeBackground")
    links.new(texture.outputs["Color"], light.inputs["Color"])
    if sky:
        links.new(light.outputs["Background"], output.inputs["Surface"])
    else:
        backdrop = nodes.new("ShaderNodeBackground")
        backdrop.inputs["Color"].default_value = STUDIO_BACKDROP
        ray = nodes.new("ShaderNodeLightPath")
        mix = nodes.new("ShaderNodeMixShader")
        links.new(ray.outputs["Is Camera Ray"], mix.inputs["Fac"])
        links.new(light.outputs["Background"], mix.inputs[1])
        links.new(backdrop.outputs["Background"], mix.inputs[2])
        links.new(mix.outputs["Shader"], output.inputs["Surface"])
    scene.world = world
    # Only a real sun (thousands of times the sky) becomes a light with
    # shadows, as in the studio; a bright window stays part of the sky.
    world.sun_threshold = 100.0
    # Bounced light keeps a room lit by its windows from looking flat.
    try:
        scene.eevee.use_raytracing = True
        scene.eevee.fast_gi_method = "GLOBAL_ILLUMINATION"
    except (AttributeError, TypeError):
        pass
    return hdri_exposure(image)


def home_camera(scene, position, target):
    """The home view through the studio's lens."""
    data = bpy.data.cameras.new("home")
    data.sensor_fit = "VERTICAL"
    data.angle_y = VIEW_HEIGHT
    data.clip_start, data.clip_end = 0.05, 500.0
    cam = bpy.data.objects.new("home", data)
    scene.collection.objects.link(cam)
    cam.location = position
    cam.rotation_euler = (target - position).to_track_quat("-Z", "Y").to_euler()
    return cam


# ----------------------------------------------------------------- export
def export(path):
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", export_image_format="JPEG", export_jpeg_quality=85,
        export_yup=True, export_apply=True, export_animations=False, export_skins=False,
        export_morph=False, export_cameras=False, export_lights=False, export_extras=True,
        use_visible=True, export_texcoords=True, export_normals=True, export_materials="EXPORT",
        export_unused_images=False, export_unused_textures=False, export_vertex_color="NONE",
        export_draco_mesh_compression_enable=False,
    )


def triangles(objects):
    return int(sum(len(o.data.loop_triangles) for o in objects))


def main():
    source, fmt = job["source"], job["format"]
    scene = {"blend": open_blend, "fbx": open_fbx, "obj": open_obj, "mitsuba": open_mitsuba}[fmt](source)
    scene.frame_set(scene.frame_current)
    if job.get("scale") and abs(job["scale"] - 1) > 1e-9:
        for o in scene.objects:
            if o.parent is None:
                o.matrix_world = Matrix.Scale(float(job["scale"]), 4) @ o.matrix_world
    objects = wanted(scene)
    say("%d visible objects" % len(objects))
    objects = make_real(scene, objects)
    objects = apply_modifiers(scene, objects)
    flatten(scene, objects)
    objects = [o for o in scene.objects if o.type == "MESH" and len(o.data.polygons)]
    # A set cut to an extent spends its triangle budget on what is kept;
    # otherwise decimating first makes the bake lighter.
    if job.get("maxTriangles") and not job.get("extent"):
        reduce_triangles(objects, int(job["maxTriangles"]))
    say("%d meshes, %d triangles" % (len(objects), triangles(objects)))
    if job.get("materials") == "bistro":
        bistro_materials(scene, objects)
    counts = prepare_materials(scene, objects)
    say("materials: %s" % ", ".join("%d %s" % (v, k) for k, v in counts.items() if v))
    textures, scaled, largest = limit_textures(objects, int(job.get("maxTexture", 2048)))
    say("%d textures, %d downscaled, largest %d px" % (textures, scaled, largest))
    bpy.context.view_layer.update()
    tris, owners = world_triangles(objects)
    floor = analyse_floor(scene, tris, owners)
    roles = classify_roles(objects, tris, owners, floor["z"])
    say("floor analysed after %d s" % (time.time() - started))
    cell, spawn, cam_position, cam_target, artist = choose_view(
        scene, floor, shell_indices(objects, roles), focus_point(objects))
    say("home view chosen after %d s" % (time.time() - started))
    transform = place(scene, spawn, cam_position)
    if job.get("extent"):
        objects = clip_to_extent(scene, objects, float(job["extent"]))
        if job.get("maxTriangles"):
            reduce_triangles(objects, int(job["maxTriangles"]))
    objects, role_counts = apply_roles(scene, objects, roles)
    say("roles: %d floor and %d shell meshes" % (role_counts["floor"], role_counts["shell"]))
    tris, owners = world_triangles(objects)
    lo, hi = tris.min((0, 1)), tris.max((0, 1))
    position, target = transform @ cam_position, transform @ cam_target
    walkable = walkable_polygon(floor, cell, transform)
    if job.get("extent"):
        reach = float(job["extent"])
        walkable = [[max(-reach, min(reach, x)), max(-reach, min(reach, z))] for x, z in walkable]
    export(job["glb"])
    say("exported %s (%.1f MB)" % (os.path.basename(job["glb"]), os.path.getsize(job["glb"]) / 1e6))
    camera = home_camera(scene, position, target)
    exposure = light_like_studio(scene, job["hdri"], bool(job.get("sky")))
    render_thumbnail(scene, camera, job["png"], 640, 400)
    diagonal = math.hypot(hi[0] - lo[0], hi[1] - lo[1])
    return {
        "version": job["version"],
        "bounds": {"min": gl((lo[0], hi[1], lo[2])), "max": gl((hi[0], lo[1], hi[2]))},
        "camera": {"position": gl(position), "target": gl(target),
                   "maxDistance": max(6.0, min(25.0, diagonal * 0.5 + 3.0))},
        # The cast faces the home camera (radians, 0 = glTF +Z).
        "heading": math.atan2(position.x, -position.y),
        "walkable": walkable,
        "exposure": exposure,
        "triangles": triangles(objects),
        "meshes": len(objects),
        "materials": counts,
        "textures": {"count": textures, "downscaled": scaled, "largest": largest},
        "roles": role_counts,
        "seconds": round(time.time() - started),
        "log": messages,
    }


try:
    result = main()
    say("done in %d s" % result["seconds"])
except Exception as error:
    traceback.print_exc()
    result = {"version": job["version"], "error": str(error), "log": messages}
    say("FAILED %s" % error)
with open(job["measure"], "w") as f:
    json.dump(result, f, indent=1)
if "error" in result:
    sys.exit(1)
