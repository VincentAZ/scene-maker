"""Blender-backed checks for engine/prepare_generated.py and engine/mixamo_bundle.py.

python3 -m unittest tests/test_engine_generated.py
Skips when the Blender binary is missing (BLENDER_PATH or the studio's .data/tools copy).
Fixtures are generated locally with Blender; no Mixamo or vendor asset is used.
"""
import json
import os
import struct
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BLENDER = Path(os.environ.get("BLENDER_PATH") or "/home/vincent/Repos/scene-maker/.data/tools/blender/blender")

MESSY_GLB_FIXTURE = r'''
import bmesh, bpy, sys
from pathlib import Path
out = Path(sys.argv[sys.argv.index("--") + 1])
bpy.ops.wm.read_factory_settings(use_empty=True)
# Two overlapping dense spheres: ~50k triangles once the glTF exporter triangulates.
bpy.ops.mesh.primitive_uv_sphere_add(segments=160, ring_count=80, radius=1.0, location=(0, 0, 0))
a = bpy.context.active_object
bpy.ops.mesh.primitive_uv_sphere_add(segments=160, ring_count=80, radius=0.6, location=(0.3, 0.8, 0.4))
b = bpy.context.active_object
bm = bmesh.new()
bm.from_mesh(a.data)
for i in range(5):
    bm.verts.new((3.0 + i, 0.0, 0.0))  # loose vertices, far outside the body
bm.to_mesh(a.data)
bm.free()
image = bpy.data.images.new("Albedo", 1024, 1024)
image.generated_type = "COLOR_GRID"
image.filepath_raw = str(out.with_name("Albedo.png"))
image.file_format = "PNG"
image.save()
material = bpy.data.materials.new("Skin")
material.use_nodes = True
tex = material.node_tree.nodes.new("ShaderNodeTexImage")
tex.image = image
material.node_tree.links.new(tex.outputs["Color"], material.node_tree.nodes["Principled BSDF"].inputs["Base Color"])
for obj in (a, b):
    obj.data.materials.append(material)
bpy.ops.object.empty_add()
root = bpy.context.active_object
root.scale = (2, 2, 2)  # 4 m tall overall
for obj in (a, b):
    obj.parent = root
bpy.ops.object.camera_add(location=(0, -5, 1))
bpy.ops.export_scene.gltf(filepath=str(out), export_format="GLB", export_animations=False, export_cameras=True)
print("FIXTURE_FACES", sum(len(p.vertices) - 2 for o in (a, b) for p in o.data.polygons))
'''

MIXAMO_FBX_FIXTURE = r'''
import bpy, sys
from math import radians
from pathlib import Path
out, with_mesh, bone_name, travel = sys.argv[sys.argv.index("--") + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
armature = bpy.data.armatures.new("Armature")
rig = bpy.data.objects.new("Armature", armature)
bpy.context.scene.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode="EDIT")
chain = [
    ("Hips", None, (0, 0, 1.0), (0, 0, 1.1)), ("Spine", "Hips", (0, 0, 1.1), (0, 0, 1.3)),
    ("Spine1", "Spine", (0, 0, 1.3), (0, 0, 1.45)), ("Spine2", "Spine1", (0, 0, 1.45), (0, 0, 1.55)),
    ("Neck", "Spine2", (0, 0, 1.55), (0, 0, 1.65)), ("Head", "Neck", (0, 0, 1.65), (0, 0, 1.85)),
]
for side, s in (("Left", 1), ("Right", -1)):
    chain += [
        (side + "Shoulder", "Spine2", (0.05 * s, 0, 1.55), (0.2 * s, 0, 1.55)),
        (side + "Arm", side + "Shoulder", (0.2 * s, 0, 1.55), (0.45 * s, 0, 1.55)),
        (side + "ForeArm", side + "Arm", (0.45 * s, 0, 1.55), (0.7 * s, 0, 1.55)),
        (side + "Hand", side + "ForeArm", (0.7 * s, 0, 1.55), (0.8 * s, 0, 1.55)),
        (side + "UpLeg", "Hips", (0.1 * s, 0, 1.0), (0.1 * s, 0, 0.55)),
        (side + "Leg", side + "UpLeg", (0.1 * s, 0, 0.55), (0.1 * s, 0, 0.1)),
        (side + "Foot", side + "Leg", (0.1 * s, 0, 0.1), (0.1 * s, -0.15, 0.0)),
    ]
for name, parent, head, tail in chain:
    bone = armature.edit_bones.new("mixamorig:" + name)
    bone.head, bone.tail = head, tail
    if parent:
        bone.parent = armature.edit_bones["mixamorig:" + parent]
bpy.ops.object.mode_set(mode="OBJECT")
if with_mesh == "mesh":
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, 0, 0.95))
    body = bpy.context.active_object
    body.scale = (0.5, 0.3, 1.9)
    bpy.ops.object.transform_apply(scale=True)
    group = body.vertex_groups.new(name="mixamorig:Hips")
    group.add(list(range(len(body.data.vertices))), 1.0, "REPLACE")
    body.parent = rig
    body.modifiers.new("Armature", "ARMATURE").object = rig
    image = bpy.data.images.new("BodyTexture", 64, 64)
    image.generated_type = "COLOR_GRID"
    image.filepath_raw = str(Path(out).with_name("BodyTexture.png"))
    image.file_format = "PNG"
    image.save()  # a real file, like a downloaded texture; FBX export copies and embeds it
    material = bpy.data.materials.new("Body")
    material.use_nodes = True
    tex = material.node_tree.nodes.new("ShaderNodeTexImage")
    tex.image = image
    material.node_tree.links.new(tex.outputs["Color"], material.node_tree.nodes["Principled BSDF"].inputs["Base Color"])
    body.data.materials.append(material)
scene = bpy.context.scene
scene.render.fps = 30
scene.frame_start, scene.frame_end = 0, 30
pose_bone = rig.pose.bones["mixamorig:" + bone_name]
pose_bone.rotation_mode = "XYZ"
hips = rig.pose.bones["mixamorig:Hips"]
for frame, angle in [(0, 0.0), (15, 35.0), (30, 0.0)]:
    pose_bone.rotation_euler = (radians(angle), 0, 0)
    pose_bone.keyframe_insert("rotation_euler", frame=frame)
    hips.location = (0, 0, float(travel) * frame / 30)
    hips.keyframe_insert("location", frame=frame)
rig.animation_data.action.name = "mixamo.com"
bpy.ops.export_scene.fbx(filepath=str(out), add_leaf_bones=False, bake_anim=True,
                         bake_anim_use_nla_strips=False, bake_anim_use_all_actions=False,
                         object_types={"ARMATURE", "MESH"}, path_mode="COPY", embed_textures=True)
'''


def read_glb(path):
    data = Path(path).read_bytes()
    magic, version, length = struct.unpack_from("<4sII", data, 0)
    assert magic == b"glTF" and version == 2 and length == len(data), "not a GLB"
    json_length, json_type = struct.unpack_from("<II", data, 12)
    assert json_type == 0x4E4F534A
    document = json.loads(data[20:20 + json_length])
    binary = b""
    if 20 + json_length < len(data):
        binary_length, binary_type = struct.unpack_from("<II", data, 20 + json_length)
        assert binary_type == 0x004E4942
        binary = data[28 + json_length:28 + json_length + binary_length]
    return document, binary


def position_bounds(document):
    """World bounds from POSITION accessor min/max; valid because the model node is at identity."""
    low, high = [float("inf")] * 3, [float("-inf")] * 3
    for mesh in document["meshes"]:
        for primitive in mesh["primitives"]:
            accessor = document["accessors"][primitive["attributes"]["POSITION"]]
            low = [min(a, b) for a, b in zip(low, accessor["min"])]
            high = [max(a, b) for a, b in zip(high, accessor["max"])]
    return low, high


def view_bytes(document, binary, view_index):
    view = document["bufferViews"][view_index]
    offset = view.get("byteOffset", 0)
    return binary[offset:offset + view["byteLength"]]


def accessor_vectors(document, binary, index):
    """Decode a tightly packed float accessor (VEC3/VEC4/SCALAR) into tuples."""
    accessor = document["accessors"][index]
    assert accessor["componentType"] == 5126 and "sparse" not in accessor
    width = {"SCALAR": 1, "VEC3": 3, "VEC4": 4}[accessor["type"]]
    view = document["bufferViews"][accessor["bufferView"]]
    offset = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
    stride = view.get("byteStride", width * 4)
    return [struct.unpack_from("<%df" % width, binary, offset + i * stride) for i in range(accessor["count"])]


def png_size(data):
    assert data[:8] == b"\x89PNG\r\n\x1a\n", "not a PNG"
    return struct.unpack_from(">II", data, 16)


@unittest.skipUnless(BLENDER.is_file(), "Blender binary not available")
class EngineGeneratedTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.folder = tempfile.TemporaryDirectory()
        cls.directory = Path(cls.folder.name)

    @classmethod
    def tearDownClass(cls):
        cls.folder.cleanup()

    @classmethod
    def blender(cls, script, *args, expect_success=True):
        command = [str(BLENDER), "--background", "--factory-startup", "--disable-autoexec", "--threads", "4",
                   "--python-exit-code", "1", "--python", str(script), "--", *map(str, args)]
        result = subprocess.run(command, capture_output=True, text=True, timeout=900, cwd=str(ROOT))
        if expect_success and result.returncode != 0:
            raise AssertionError("Blender failed (%d)\n%s\n%s" % (result.returncode, result.stdout[-4000:], result.stderr[-4000:]))
        return result

    @classmethod
    def stats(cls, result):
        lines = [line for line in result.stdout.splitlines() if line.startswith("STATS ")]
        assert len(lines) == 1, "expected exactly one STATS line:\n" + result.stdout[-2000:]
        # Blender itself prints a version line and "Blender quit" after the script's last output.
        script_lines = [line for line in result.stdout.strip().splitlines() if line and not line.startswith("Blender")]
        assert lines[0] == script_lines[-1], "STATS must be the script's final stdout line:\n" + result.stdout[-2000:]
        return json.loads(lines[0][len("STATS "):])

    def write_script(self, name, body):
        path = self.directory / name
        path.write_text(body)
        return path

    def prepare(self, label, spec, source):
        spec_path = self.directory / (label + "-spec.json")
        spec_path.write_text(json.dumps(spec))
        glb, fbx = self.directory / (label + ".glb"), self.directory / (label + ".fbx")
        result = self.blender(ROOT / "engine/prepare_generated.py", spec_path, source, glb, fbx)
        stats = self.stats(result)
        self.assertTrue(glb.is_file() and glb.stat().st_size > 0)
        self.assertTrue(fbx.is_file() and fbx.stat().st_size > 0)
        self.assertEqual(glb.read_bytes()[:4], b"glTF")
        fbx_bytes = fbx.read_bytes()
        self.assertEqual(fbx_bytes[:18], b"Kaydara FBX Binary")
        png_offset = fbx_bytes.find(b"\x89PNG\r\n\x1a\n")
        self.assertGreater(png_offset, 0, "FBX for Mixamo must embed the texture")
        return stats, glb, png_size(fbx_bytes[png_offset:png_offset + 64])

    def test_prepare_generated_cleans_character_and_prop(self):
        source = self.directory / "messy.glb"
        result = self.blender(self.write_script("messy_fixture.py", MESSY_GLB_FIXTURE), source)
        fixture_faces = int(next(line for line in result.stdout.splitlines() if line.startswith("FIXTURE_FACES")).split()[1])
        self.assertGreater(fixture_faces, 45000)
        self.assertLess(fixture_faces, 60000)
        document, _ = read_glb(source)
        self.assertEqual(len(document["meshes"]), 2)
        self.assertTrue(any("camera" in node for node in document["nodes"]))

        stats, glb, fbx_texture = self.prepare("character", {"category": "characters", "height": 1.75, "textureSize": 512}, source)
        self.assertEqual(fbx_texture, (512, 512), "the FBX must carry the downscaled texture too")
        self.assertEqual(set(stats), {"faces", "vertices", "dimensions", "images"})
        self.assertLessEqual(stats["faces"], 30000)
        self.assertGreater(stats["faces"], 10000)
        self.assertEqual(stats["images"], 1)
        width, height, depth = stats["dimensions"]
        self.assertAlmostEqual(height, 1.75, places=3)
        self.assertGreater(width, depth, "character should be turned so its wide side faces +Z")
        document, binary = read_glb(glb)
        self.assertEqual(len(document["meshes"]), 1)
        self.assertEqual(len(document["nodes"]), 1)
        self.assertNotIn("animations", document)
        self.assertNotIn("skins", document)
        low, high = position_bounds(document)
        self.assertAlmostEqual(low[1], 0.0, places=3)
        self.assertAlmostEqual(high[1] - low[1], 1.75, places=3)
        self.assertAlmostEqual((low[0] + high[0]) / 2, 0.0, places=3)
        self.assertAlmostEqual((low[2] + high[2]) / 2, 0.0, places=3)
        triangles = sum(document["accessors"][p["indices"]]["count"] // 3 for m in document["meshes"] for p in m["primitives"])
        self.assertLessEqual(triangles, 30000)
        self.assertEqual(len(document["images"]), 1)
        image_size = png_size(view_bytes(document, binary, document["images"][0]["bufferView"]))
        self.assertLessEqual(max(image_size), 512)
        self.assertTrue(any("TEXCOORD_0" in p["attributes"] for m in document["meshes"] for p in m["primitives"]))

        stats, glb, fbx_texture = self.prepare("prop", {"category": "props", "maxSize": 1.0}, source)
        self.assertEqual(fbx_texture, (1024, 1024))
        self.assertLessEqual(stats["faces"], 15000)
        self.assertAlmostEqual(max(stats["dimensions"]), 1.0, places=3)
        document, binary = read_glb(glb)
        low, high = position_bounds(document)
        self.assertAlmostEqual(low[1], 0.0, places=3)
        self.assertAlmostEqual(max(h - l for l, h in zip(low, high)), 1.0, places=3)
        # Props keep their orientation: the fixture is deeper (Z) than wide (X).
        self.assertGreater(stats["dimensions"][2], stats["dimensions"][0])
        image_size = png_size(view_bytes(document, binary, document["images"][0]["bufferView"]))
        self.assertEqual(max(image_size), 1024, "default textureSize 2048 must not shrink a 1024 texture")

    def test_prepare_generated_rejects_mesh_free_input(self):
        empty = self.directory / "empty.glb"
        script = self.write_script("empty_fixture.py", (
            'import bpy, sys\nbpy.ops.wm.read_factory_settings(use_empty=True)\nbpy.ops.object.camera_add()\n'
            'bpy.ops.export_scene.gltf(filepath=sys.argv[-1], export_format="GLB", export_cameras=True)\n'))
        self.blender(script, empty)
        spec_path = self.directory / "empty-spec.json"
        spec_path.write_text(json.dumps({"category": "props"}))
        result = self.blender(ROOT / "engine/prepare_generated.py", spec_path, empty,
                              self.directory / "never.glb", self.directory / "never.fbx", expect_success=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("no mesh geometry", result.stderr)
        self.assertFalse((self.directory / "never.glb").exists())

    def test_mixamo_bundle_merges_animations_from_several_fbx(self):
        script = self.write_script("mixamo_fixture.py", MIXAMO_FBX_FIXTURE)
        idle, walking = self.directory / "Idle.fbx", self.directory / "Walking.fbx"
        self.blender(script, idle, "mesh", "Spine", 0.0)
        self.blender(script, walking, "nomesh", "LeftArm", 1.0)
        output = self.directory / "bundle.glb"
        result = self.blender(ROOT / "engine/mixamo_bundle.py", output, idle, walking)
        stats = self.stats(result)
        self.assertEqual(stats["animations"], ["Idle", "Walking"])
        self.assertEqual(stats["bones"], 20)
        self.assertEqual(stats["meshes"], 1)
        self.assertEqual(output.read_bytes()[:4], b"glTF")
        document, _ = read_glb(output)
        names = sorted(animation["name"] for animation in document["animations"])
        self.assertEqual(names, ["Idle", "Walking"])
        self.assertEqual(len(document["skins"]), 1)
        self.assertEqual(len(document["meshes"]), 1)
        self.assertEqual(len(document["images"]), 1)
        joints = {document["nodes"][j]["name"] for j in document["skins"][0]["joints"]}
        self.assertIn("mixamorig:Hips", joints)
        self.assertIn("mixamorig:LeftArm", joints)
        self.assertEqual(len(joints), 20)
        for node in document["nodes"]:
            scale = node.get("scale", [1, 1, 1])
            self.assertAlmostEqual(scale[0], scale[1], places=5)
            self.assertAlmostEqual(scale[1], scale[2], places=5)
        for animation in document["animations"]:
            self.assertGreater(len(animation["channels"]), 0)
            targets = {document["nodes"][channel["target"]["node"]]["name"] for channel in animation["channels"]}
            self.assertTrue(targets <= joints | {"Armature"}, targets)
            duration = max(document["accessors"][s["input"]]["max"][0] for s in animation["samplers"])
            # 30 frames at 30 fps; the FBX bake round trip may pad by one frame.
            self.assertGreaterEqual(duration, 0.99)
            self.assertLessEqual(duration, 1.04)
        # Hips travel only in Walking: its translation channel must move, Idle's must not.
        document, binary = read_glb(output)
        hips = next(i for i, node in enumerate(document["nodes"]) if node["name"] == "mixamorig:Hips")

        def hips_travel(name):
            animation = next(a for a in document["animations"] if a["name"] == name)
            channel = next(c for c in animation["channels"] if c["target"]["node"] == hips and c["target"]["path"] == "translation")
            samples = accessor_vectors(document, binary, animation["samplers"][channel["sampler"]]["output"])
            self.assertGreater(len(samples), 1)
            return max(max(s[axis] for s in samples) - min(s[axis] for s in samples) for axis in range(3))

        self.assertGreater(hips_travel("Walking"), 0.5)
        self.assertLess(hips_travel("Idle"), 1e-4)

    def test_mixamo_bundle_rejects_first_file_without_mesh(self):
        script = self.write_script("mixamo_fixture.py", MIXAMO_FBX_FIXTURE)
        skinless = self.directory / "Skinless.fbx"
        self.blender(script, skinless, "nomesh", "Head", 0.0)
        result = self.blender(ROOT / "engine/mixamo_bundle.py", self.directory / "never-bundle.glb", skinless, expect_success=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("no mesh", result.stderr)


if __name__ == "__main__":
    unittest.main()
