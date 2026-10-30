"""Prepare a user-owned ActorCore Unity FBX and adjacent JSON, without executing assets.

blender -b --factory-startup --disable-autoexec --python engine/prepare_actorcore.py -- \
  --source /downloads/Actor/name/name.fbx --output /private/prepared/name.glb \
  --motion 'Stand and talk=/downloads/Motion/stand-talk.fbx'

Writes embedded GLB, a CPU Cycles PNG and a JSON verification report alongside it.
Only FBX, JSON and explicitly referenced local images are read. No Unity packages,
scripts, .blend files or vendor code are loaded. Sources are never saved/modified.
Motion transfer deliberately requires matching bone names AND matching rest matrices;
this is not a general retargeter. One-frame default/T-pose actions are excluded.
World units/facing, mesh topology, weights and morphs are retained. Near-unit FBX
joint scale noise is corrected in GLB together with inverse binds, not by applying
mesh/armature transforms. The report includes real GLB re-import and motion samples.
"""
import argparse
import hashlib
import json
import math
import struct
import sys
from pathlib import Path, PureWindowsPath

# Keep pure parsing helpers importable by normal Python tests.
try:
    import bpy
    from mathutils import Matrix, Quaternion, Vector
except ModuleNotFoundError:
    bpy = None


CORE_BONES = {
    "Hip": "hips", "Spine01": "spine", "Head": "head",
    "L_Upperarm": "leftArm", "L_Forearm": "leftForearm", "L_Hand": "leftHand",
    "R_Upperarm": "rightArm", "R_Forearm": "rightForearm", "R_Hand": "rightHand",
    "L_Thigh": "leftLeg", "L_Calf": "leftShin", "L_Foot": "leftFoot",
    "R_Thigh": "rightLeg", "R_Calf": "rightShin", "R_Foot": "rightFoot",
}
# Only the CC_Base hierarchy was verified in the supplied ActorCore exports.
BONE_ALIASES = {"CC_Base_" + name: target for name, target in CORE_BONES.items()}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def local_texture(root, value):
    """No absolute paths, traversal, URI schemes, symlink escapes or basename guessing."""
    require(isinstance(value, str) and value, "Empty texture path")
    value = value.replace("\\", "/")
    require(not PureWindowsPath(value).drive and ":" not in value and not value.startswith("/"),
            "Texture must be relative to source: " + value)
    path = (Path(root) / value).resolve()
    require(path.is_relative_to(Path(root).resolve()), "Texture escapes source directory: " + value)
    require(path.is_file(), "Missing texture: " + str(path))
    return path


def read_sidecar(path):
    document = json.loads(Path(path).read_text(encoding="utf-8-sig"))
    require(isinstance(document, dict), "ActorCore sidecar must be an object")
    materials = {}
    for value in document.values():
        if not isinstance(value, dict):
            continue
        for obj in value.get("Object", {}).values():
            for mesh, settings in obj.get("Meshes", {}).items():
                for name, material in settings.get("Materials", {}).items():
                    materials[(mesh, name)] = material
    require(materials, "No ActorCore material settings in " + str(path))
    return materials


def read_glb(path):
    data = Path(path).read_bytes()
    require(len(data) >= 28, "Truncated GLB")
    magic, version, length = struct.unpack_from("<III", data)
    require(magic == 0x46546C67 and version == 2 and length == len(data), "Invalid GLB header")
    size, kind = struct.unpack_from("<II", data, 12)
    require(kind == 0x4E4F534A, "GLB JSON chunk missing")
    document = json.loads(data[20:20 + size])
    offset = 20 + size
    binary_size, kind = struct.unpack_from("<II", data, offset)
    require(kind == 0x004E4942 and offset + 8 + binary_size == len(data), "Invalid GLB binary chunk")
    return document, bytearray(data[offset + 8:])


def write_glb(path, document, binary):
    encoded = json.dumps(document, separators=(",", ":"), allow_nan=False).encode()
    encoded += b" " * (-len(encoded) % 4)
    binary += b"\0" * (-len(binary) % 4)
    Path(path).write_bytes(struct.pack("<III", 0x46546C67, 2, 28 + len(encoded) + len(binary))
                          + struct.pack("<II", len(encoded), 0x4E4F534A) + encoded
                          + struct.pack("<II", len(binary), 0x004E4942) + binary)


def float_accessor(document, binary, index, width):
    accessor = document["accessors"][index]
    require(accessor["componentType"] == 5126 and "sparse" not in accessor, "Expected dense float accessor")
    view = document["bufferViews"][accessor["bufferView"]]
    start = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
    stride = view.get("byteStride", width * 4)
    return accessor, [(start + i * stride, struct.unpack_from("<%df" % width, binary, start + i * stride))
                      for i in range(accessor["count"])]


def node_worlds(document):
    nodes = document.get("nodes", [])
    parents = {child: index for index, node in enumerate(nodes) for child in node.get("children", [])}
    result = {}

    def world(index):
        if index not in result:
            node = nodes[index]
            if "matrix" in node:
                local = Matrix([node["matrix"][i:i + 4] for i in range(0, 16, 4)]).transposed()
            else:
                q = node.get("rotation", [0, 0, 0, 1])
                local = Matrix.LocRotScale(Vector(node.get("translation", [0, 0, 0])),
                                          Quaternion((q[3], *q[:3])), Vector(node.get("scale", [1, 1, 1])))
            result[index] = world(parents[index]) @ local if index in parents else local
        return result[index]
    for index in range(len(nodes)):
        world(index)
    return result


def dense_accessor(document, binary, index, width):
    """Decode the data consumed by a glTF runtime, independently of re-import."""
    accessor = document['accessors'][index]
    formats = {5121: ('B', 255), 5123: ('H', 65535), 5125: ('I', 4294967295), 5126: ('f', 1)}
    require(accessor['componentType'] in formats and 'sparse' not in accessor, "Unsupported verification accessor")
    kind, denominator = formats[accessor['componentType']]
    view = document['bufferViews'][accessor['bufferView']]
    start = view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
    stride = view.get('byteStride', struct.calcsize('<' + kind) * width)
    rows = [struct.unpack_from('<%d%s' % (width, kind), binary, start + i * stride)
            for i in range(accessor['count'])]
    return [[v / denominator for v in row] for row in rows] if accessor.get('normalized') else rows


def raw_gltf_sample(document, binary, animation=None, fraction=0):
    """glTF node worlds and CPU skinning; never invokes Blender glTF importer.

    This uses all exported influence sets (Three's renderer uses JOINTS_0).
    Captures exported bind/action axes, inverse binds and actual mesh positions.
    """
    import copy
    import bisect
    import numpy as np
    document = copy.deepcopy(document)
    if animation is not None:
        duration = max(document['accessors'][s['input']]['max'][0] for s in animation['samplers'])
        start = min(document['accessors'][s['input']]['min'][0] for s in animation['samplers'])
        time = start + (duration - start) * fraction
        for channel in animation['channels']:
            target = channel['target']
            require(target['path'] != 'weights', "Animated morph verification requires explicit implementation")
            sampler = animation['samplers'][channel['sampler']]
            require(sampler.get('interpolation', 'LINEAR') in ('LINEAR', 'STEP'), "Unsupported raw animation interpolation")
            times = [row[0] for row in dense_accessor(document, binary, sampler['input'], 1)]
            width = 4 if target['path'] == 'rotation' else 3
            values = dense_accessor(document, binary, sampler['output'], width)
            a = max(0, min(bisect.bisect_right(times, time) - 1, len(times) - 1))
            b = min(a + 1, len(times) - 1)
            t = (time - times[a]) / (times[b] - times[a]) if a != b else 0
            if sampler.get('interpolation') == 'STEP':
                t = 0
            if target['path'] == 'rotation':
                qa, qb = (Quaternion((row[3], *row[:3])).normalized() for row in (values[a], values[b]))
                q = qa.slerp(qb, t)
                value = [q.x, q.y, q.z, q.w]
            else:
                value = [x + (y - x) * t for x, y in zip(values[a], values[b])]
            document['nodes'][target['node']][target['path']] = value
    worlds = node_worlds(document)
    joints = {node['name']: list(worlds[i].translation) for i, node in enumerate(document['nodes'])
              if node.get('name') in CORE_BONES.values()}
    low, high, vertex_count = np.full(3, np.inf), np.full(3, -np.inf), 0
    for index, node in enumerate(document['nodes']):
        if 'mesh' not in node:
            continue
        mesh = document['meshes'][node['mesh']]
        require(not any(mesh.get('weights', [])) and not any(node.get('weights', [])), "Nonzero default morph weights")
        palette = None
        if 'skin' in node:
            skin = document['skins'][node['skin']]
            rows = dense_accessor(document, binary, skin['inverseBindMatrices'], 16)
            palette = np.array([list(worlds[joint] @ Matrix([row[i:i + 4] for i in range(0, 16, 4)]).transposed())
                                for joint, row in zip(skin['joints'], rows)])
        for primitive in mesh['primitives']:
            attributes = primitive['attributes']
            vertices = np.array(dense_accessor(document, binary, attributes['POSITION'], 3))
            vertices = np.column_stack((vertices, np.ones(len(vertices))))
            if palette is None:
                points = (np.array(worlds[index]) @ vertices.T).T[:, :3]
            else:
                points = np.zeros((len(vertices), 3))
                totals = np.zeros(len(vertices))
                sets = sorted(key for key in attributes if key.startswith('JOINTS_'))
                require(sets, "Skin has no joint attributes")
                for key in sets:
                    indices = np.array(dense_accessor(document, binary, attributes[key], 4), dtype=np.int64)
                    weights = np.array(dense_accessor(document, binary, attributes[key.replace('JOINTS_', 'WEIGHTS_')], 4))
                    for component in range(4):
                        transformed = np.einsum('vij,vj->vi', palette[indices[:, component]], vertices)
                        points += transformed[:, :3] * weights[:, component, None]
                    totals += weights.sum(axis=1)
                require(np.max(np.abs(totals - 1)) < .001, "Non-normalized skin weights")
            low, high = np.minimum(low, points.min(axis=0)), np.maximum(high, points.max(axis=0))
            vertex_count += len(points)
    require(vertex_count > 0, "No exported vertices to verify")
    return {'bounds': {'min': low.tolist(), 'max': high.tolist(), 'dimensions': (high - low).tolist()},
            'joints': joints, 'verticesChecked': vertex_count}


def verify_raw_gltf(document, binary, original, motion_samples):
    rest = raw_gltf_sample(document, binary)
    error = max(abs(rest['bounds'][edge][i] - original['bounds'][edge][i]) for edge in ('min', 'max') for i in range(3))
    require(error < .001, "Raw glTF skin changed rest mesh bounds: %.6g m" % error)
    if document.get('skins'):
        require(set(CORE_BONES.values()).issubset(rest['joints']), "Raw glTF missing canonical humanoid joints")
        joints, bounds = rest['joints'], rest['bounds']
        foot_y = min(joints[name][1] for name in ('leftFoot', 'rightFoot'))
        require(joints['hips'][1] - foot_y > .5 and joints['head'][1] - joints['hips'][1] > .2,
                "Raw glTF joints are not upright Y-up above the feet")
        require(all(bounds['min'][1] - .05 <= p[1] <= bounds['max'][1] + .05 for p in joints.values()),
                "Raw glTF joint origins disagree with upright mesh bounds")
    checks = []
    for animation in document.get('animations', []):
        expected = motion_samples[animation['name']]
        actual = [raw_gltf_sample(document, binary, animation, t) for t in (0., .5, 1.)]
        bounds_error = max(abs(a['bounds'][edge][i] - b['bounds'][edge][i])
                           for a, b in zip(expected, actual) for edge in ('min', 'max') for i in range(3))
        joint_error = max(abs(a['joints'][name][i] - b['joints'][name][i])
                          for a, b in zip(expected, actual) for name in a['joints'] for i in range(3))
        require(bounds_error < .003 and joint_error < .003,
                "Raw glTF animation differs: %s (bounds %.6g m, joints %.6g m)" % (animation['name'], bounds_error, joint_error))
        checks.append({'name': animation['name'], 'maximumBoundsErrorMeters': bounds_error,
                       'maximumJointPositionErrorMeters': joint_error, 'samples': actual})
    return {'method': 'Raw glTF TRS node worlds and all-vertex CPU skinning with exported inverse binds; no Blender reimport',
            'rest': rest, 'maximumRestBoundsErrorMeters': error, 'motionChecks': checks}


def normalize_joints(document, binary, tolerance=1e-4):
    """Remove ONLY measured near-unit noise; preserve worldJoint * inverseBind at rest.

    Meaningful animated scaling is left untouched. Near-unit animation scale samples
    are snapped too (at most tolerance error per joint, measured by re-import tests).
    Parent armature centimeter-to-meter scales are intentionally NOT changed.
    """
    joints = {joint for skin in document.get("skins", []) for joint in skin["joints"]}
    scale_tracks = {}
    for animation in document.get("animations", []):
        for channel in animation["channels"]:
            if channel["target"]["path"] == "scale":
                sampler = animation["samplers"][channel["sampler"]]
                scale_tracks.setdefault(channel["target"]["node"], []).append(sampler)
    before = node_worlds(document)
    changed, preserved = [], []
    for index in joints:
        node = document["nodes"][index]
        scales = node.get("scale", [1, 1, 1])
        tracks = scale_tracks.get(index, [])
        near = "matrix" not in node and all(abs(v - 1) <= tolerance for v in scales)
        for sampler in tracks:
            # Cubic spline tangents are not scale values: do not rewrite them.
            near = near and sampler.get("interpolation", "LINEAR") != "CUBICSPLINE"
            _, values = float_accessor(document, binary, sampler["output"], 3)
            near = near and all(abs(v - 1) <= tolerance for _, row in values for v in row)
        if not near:
            preserved.append(node.get("name", str(index)))
            continue
        if "scale" in node or tracks:
            node.pop("scale", None)
            changed.append(node.get("name", str(index)))
        for sampler in tracks:
            accessor, values = float_accessor(document, binary, sampler["output"], 3)
            for offset, _ in values:
                struct.pack_into("<3f", binary, offset, 1, 1, 1)
            accessor["min"] = accessor["max"] = [1, 1, 1]
    after = node_worlds(document)
    processed, maximum_error = {}, 0.0
    for skin in document.get("skins", []):
        key = skin["inverseBindMatrices"]
        if key in processed:
            require(processed[key] == skin["joints"], "Shared inverse binds with different joints")
            continue
        processed[key] = skin["joints"]
        accessor, values = float_accessor(document, binary, key, 16)
        require(accessor["type"] == "MAT4" and len(values) == len(skin["joints"]), "Invalid inverse binds")
        for joint, (offset, row) in zip(skin["joints"], values):
            inverse = Matrix([row[i:i + 4] for i in range(0, 16, 4)]).transposed()
            corrected = after[joint].inverted() @ before[joint] @ inverse
            flat = [corrected[r][c] for c in range(4) for r in range(4)]
            struct.pack_into("<16f", binary, offset, *flat)
            stored = Matrix([struct.unpack_from("<16f", binary, offset)[i:i + 4] for i in range(0, 16, 4)]).transposed()
            a, b = before[joint] @ inverse, after[joint] @ stored
            maximum_error = max(maximum_error, max(abs(a[r][c] - b[r][c]) for r in range(4) for c in range(4)))
    return {"normalizedJoints": changed, "preservedScaledJoints": preserved,
            "maximumRestSkinMatrixError": maximum_error, "tolerance": tolerance}


def normalize_translation_noise(document, binary, tolerance_meters=5e-6):
    """Collapse only measured FBX fixed-offset roundoff, in world metres.

    Local FBX centimetres can contain 1e-4 translation jitter (1 micrometre),
    which is not changing bone length. Body travel, attachment sway and genuine
    offsets above the explicit budget are untouched. Report every edited track.
    """
    joints = {joint for skin in document.get("skins", []) for joint in skin["joints"]}
    worlds = node_worlds(document)
    parents = {child: i for i, node in enumerate(document['nodes']) for child in node.get('children', [])}
    collapsed = []
    for animation in document.get('animations', []):
        for channel in animation['channels']:
            target = channel['target']
            if target['path'] != 'translation' or target['node'] not in joints:
                continue
            sampler = animation['samplers'][channel['sampler']]
            if sampler.get('interpolation', 'LINEAR') not in ('LINEAR', 'STEP'):
                continue
            index = target['node']
            baseline = document['nodes'][index].get('translation', [0, 0, 0])
            accessor, rows = float_accessor(document, binary, sampler['output'], 3)
            parent_world = worlds[parents[index]] if index in parents else Matrix.Identity(4)
            error = max((parent_world.to_3x3() @ (Vector(row) - Vector(baseline))).length for _, row in rows)
            if 0 < error <= tolerance_meters:
                for offset, _ in rows:
                    struct.pack_into('<3f', binary, offset, *baseline)
                accessor['min'] = accessor['max'] = baseline[:]
                collapsed.append({'animation': animation.get('name', ''),
                                  'joint': document['nodes'][index].get('name', str(index)),
                                  'maximumWorldErrorMeters': error})
    return {'toleranceMeters': tolerance_meters, 'collapsedChannels': collapsed}


def canonical_names(document):
    used = {node.get("name") for node in document.get("nodes", [])}
    renamed = {}
    joints = {i for skin in document.get("skins", []) for i in skin["joints"]}
    for index in sorted(joints):
        node = document["nodes"][index]
        name = node.get("name", "")
        target = BONE_ALIASES.get(name)
        if target:
            require(target not in used, "Canonical bone name collision: " + target)
            node["name"] = target
            renamed[name] = target
            used.add(target)
    return renamed


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def import_fbx(path):
    before, actions = set(bpy.data.objects), set(bpy.data.actions)
    bpy.ops.import_scene.fbx(filepath=str(path), use_anim=True, use_image_search=False,
                             ignore_leaf_bones=False, automatic_bone_orientation=False)
    bpy.context.view_layer.update()
    return [o for o in bpy.data.objects if o not in before], [a for a in bpy.data.actions if a not in actions]


def fbx_bind_worlds(path):
    """Read data-only FBX BindPose matrices in Blender world units/axes.

    FBX import can synthesize an armature object in the animated root frame,
    while bone rest matrices use the bind root frame. Clearing the take leaves
    horizontal joints inside an upright mesh. Use the actual FBX bind data,
    not a guessed rotation or the one-frame default pose. Our import defaults
    deliberately disable automatic/bone-axis corrections.
    """
    from io_scene_fbx import parse_fbx, import_fbx as fbx
    from io_scene_fbx.fbx_utils import RIGHT_HAND_AXES, units_blender_to_fbx_factor
    from bpy_extras.io_utils import axis_conversion
    tree, _ = parse_fbx.parse(str(path))
    settings = fbx.elem_find_first(fbx.elem_find_first(tree, b'GlobalSettings'), b'Properties70')
    require(settings is not None, "FBX GlobalSettings missing")
    axes = tuple((fbx.elem_props_get_integer(settings, axis + b'Axis', default),
                  fbx.elem_props_get_integer(settings, axis + b'AxisSign', 1))
                 for axis, default in [(b'Up', 2), (b'Front', 1), (b'Coord', 0)])
    orientations = {v: k for k, v in RIGHT_HAND_AXES.items()}
    require(axes in orientations, "Unsupported FBX axes")
    up, forward = orientations[axes]
    scale = fbx.elem_props_get_number(settings, b'UnitScaleFactor', 1.) / units_blender_to_fbx_factor(bpy.context.scene)
    global_matrix = Matrix.Scale(scale, 4) @ axis_conversion(from_forward=forward, from_up=up).to_4x4()
    objects = fbx.elem_find_first(tree, b'Objects')
    names = {e.props[0]: e.props[1].split(b'\0')[0].decode('utf-8')
             for e in objects.elems if e.id == b'Model'}
    result = {}
    for pose in objects.elems:
        if pose.id != b'Pose' or pose.props[2] != b'BindPose':
            continue
        for node in pose.elems:
            if node.id != b'PoseNode':
                continue
            identifier = fbx.elem_find_first(node, b'Node').props[0]
            matrix = fbx.elem_find_first(node, b'Matrix')
            if identifier not in names or matrix is None:
                continue
            world = global_matrix @ fbx.array_to_matrix4(matrix.props[0])
            name = names[identifier]
            if name in result:
                require(matrix_error(result[name], world) < 1e-5, "Conflicting FBX bind poses: " + name)
            result[name] = world
    return result


def matrix_error(a, b):
    return max(abs(a[i][j] - b[i][j]) for i in range(4) for j in range(4))


def action_curves(action, slot):
    return [curve for layer in action.layers for strip in layer.strips
            for bag in strip.channelbags if bag.slot_handle == slot.handle for curve in bag.fcurves]


def canonicalize_fbx_bind(objects, actions, path, allow_missing_bind=False):
    """Restore FBX bind object frame and explicitly rebase root action channels.

    W_old P(t) == W_bind P_new(t). Only root matrix_basis changes, by the
    constant left factor B_root^-1 W_bind^-1 W_old B_root. Child channels,
    bone rest matrices, mesh/morph coordinates and weights remain untouched.
    Native skinning uses the authoritative FBX bind frame instead of Blender's
    inconsistent synthesized object frame. Source animated joint worlds are
    preserved; the formerly invalid deformations are intentionally corrected.
    """
    rigs = [o for o in objects if o.type == 'ARMATURE']
    if not rigs:
        return None
    require(len(rigs) == 1, "Expected one FBX armature")
    rig = rigs[0]
    require(rig.parent is None, "Nested FBX armature bind canonicalization unsupported")
    binds = fbx_bind_worlds(path)
    if not binds and allow_missing_bind:
        return {"source": str(path), "bindPoseAvailable": False, "rebasedRootActions": []}
    roots = [b for b in rig.data.bones if not b.parent]
    require(roots and all(b.name in binds for b in roots), "FBX root bind pose missing")
    world = binds[roots[0].name] @ roots[0].matrix_local.inverted()
    bind_error = max(matrix_error(world @ b.matrix_local, binds[b.name])
                     for b in rig.data.bones if b.name in binds)
    require(bind_error < .001, "FBX bind frames disagree: %.6g" % bind_error)
    old_world = rig.matrix_world.copy()
    correction = world.inverted() @ old_world
    _, rotation, scale = correction.decompose()
    require(max(abs(v - 1) for v in scale) < 1e-5, "FBX bind correction is not rigid")
    report = {"source": str(path), "originalArmatureWorld": [list(row) for row in old_world],
              "bindArmatureWorld": [list(row) for row in world],
              "maximumBindMatrixDifference": bind_error, "rebasedRootActions": [],
              "maximumOriginalAnimatedJointErrorMeters": 0.0}
    if matrix_error(old_world, world) < 1e-6:
        return report
    plans = []
    for action in actions:
        for slot in action.slots:
            if slot.target_id_type != 'OBJECT':
                continue
            curves = action_curves(action, slot)
            if not any(c.data_path.startswith('pose.bones[') for c in curves):
                continue
            require(all(c.data_path.startswith('pose.bones[') for c in curves),
                    "Animated FBX armature object transforms require explicit baking")
            for root in roots:
                prefix = rig.pose.bones[root.name].path_from_id()
                relevant = [c for c in curves if c.data_path.startswith(prefix + '.')]
                if not relevant:
                    continue
                frames = sorted({k.co.x for c in relevant for k in c.keyframe_points})
                require(all(k.interpolation == 'LINEAR' for c in relevant for k in c.keyframe_points),
                        "Nonlinear FBX root action requires explicit baking")
                factor = root.matrix_local.inverted() @ correction @ root.matrix_local
                samples, previous = [], None
                for frame in frames:
                    def values(prop, defaults):
                        return [next((c.evaluate(frame) for c in relevant if c.data_path == prefix + '.' + prop and c.array_index == i), v)
                                for i, v in enumerate(defaults)]
                    require(not any(c.data_path.endswith(('rotation_euler', 'rotation_axis_angle')) for c in relevant),
                            "FBX root must use quaternion curves")
                    original = Matrix.LocRotScale(Vector(values('location', (0, 0, 0))),
                                                 Quaternion(values('rotation_quaternion', (1, 0, 0, 0))),
                                                 Vector(values('scale', (1, 1, 1))))
                    rebased = factor @ original
                    location, quaternion, scaling = rebased.decompose()
                    if previous and quaternion.dot(previous) < 0:
                        quaternion.negate()
                    previous = quaternion.copy()
                    require(matrix_error(rebased, Matrix.LocRotScale(location, quaternion, scaling)) < 1e-4,
                            "FBX root correction introduces shear")
                    error = matrix_error(old_world @ root.matrix_local @ original,
                                         world @ root.matrix_local @ Matrix.LocRotScale(location, quaternion, scaling))
                    report['maximumOriginalAnimatedJointErrorMeters'] = max(report['maximumOriginalAnimatedJointErrorMeters'], error)
                    samples.append((frame, {'location': location, 'rotation_quaternion': quaternion, 'scale': scaling}))
                plans.append((action, slot, prefix, relevant, samples))
                report['rebasedRootActions'].append({'action': action.name, 'root': root.name, 'frames': len(frames),
                                                   'basisLeftFactor': [list(row) for row in factor]})
    original_samples = []
    for action, slot, *_ in plans:
        rig.animation_data_create()
        rig.animation_data.action = action
        rig.animation_data.action_slot = slot
        start, end = action.frame_range
        expected = []
        for fraction in (0., .5, 1.):
            frame = start + (end - start) * fraction
            bpy.context.scene.frame_set(math.floor(frame), subframe=frame - math.floor(frame))
            expected.append({b.name: old_world @ b.matrix.translation for b in rig.pose.bones})
        original_samples.append((action, slot, expected))
    children = {obj: binds.get(obj.name, obj.matrix_world).copy() for obj in objects if obj != rig}
    rig.animation_data_clear()
    rig.matrix_world = world
    bpy.context.view_layer.update()
    for obj, matrix in children.items():
        obj.matrix_world = matrix
    for action, slot, prefix, curves, samples in plans:
        bag = next(bag for layer in action.layers for strip in layer.strips
                   for bag in strip.channelbags if bag.slot_handle == slot.handle)
        for curve in curves:
            bag.fcurves.remove(curve)
        for prop, width in [('location', 3), ('rotation_quaternion', 4), ('scale', 3)]:
            for index in range(width):
                curve = bag.fcurves.new(prefix + '.' + prop, index=index)
                curve.keyframe_points.add(len(samples))
                for key, (frame, values) in zip(curve.keyframe_points, samples):
                    key.co = (frame, values[prop][index])
                    key.interpolation = 'LINEAR'
                curve.update()
    report['originalAnimatedJointChecks'] = []
    for action, slot, expected in original_samples:
        rig.animation_data_create()
        rig.animation_data.action = action
        rig.animation_data.action_slot = slot
        start, end = action.frame_range
        maximum = 0.
        for fraction, positions in zip((0., .5, 1.), expected):
            frame = start + (end - start) * fraction
            bpy.context.scene.frame_set(math.floor(frame), subframe=frame - math.floor(frame))
            maximum = max(maximum, max((rig.matrix_world @ b.matrix.translation - positions[b.name]).length for b in rig.pose.bones))
        report['originalAnimatedJointChecks'].append({'action': action.name, 'maximumJointPositionErrorMeters': maximum})
        report['maximumOriginalAnimatedJointErrorMeters'] = max(report['maximumOriginalAnimatedJointErrorMeters'], maximum)
    rig.animation_data_clear()
    for bone in rig.pose.bones:
        bone.matrix_basis.identity()
    bpy.context.view_layer.update()
    require(report['maximumOriginalAnimatedJointErrorMeters'] < .0001, "FBX root rebase changed motion")
    return report


def clear_animation(objects):
    for obj in objects:
        obj.animation_data_clear()
        if obj.type == "ARMATURE":
            for bone in obj.pose.bones:
                bone.matrix_basis.identity()
        if obj.type == "MESH" and obj.data.shape_keys:
            obj.data.shape_keys.animation_data_clear()
            for key in obj.data.shape_keys.key_blocks:
                key.value = 0
    bpy.context.view_layer.update()


def geometry_digest(objects):
    """Numeric mesh positions, topology, morphs and weights; names/materials excluded."""
    digest = hashlib.sha256()
    for obj in sorted((o for o in objects if o.type == "MESH"), key=lambda o: o.name):
        for v in obj.data.vertices:
            digest.update(struct.pack("<3f", *v.co))
            for group in v.groups:
                digest.update(struct.pack("<If", group.group, group.weight))
        for polygon in obj.data.polygons:
            digest.update(struct.pack("<I", len(polygon.vertices)))
            digest.update(struct.pack("<%dI" % len(polygon.vertices), *polygon.vertices))
        if obj.data.shape_keys:
            for key in obj.data.shape_keys.key_blocks:
                for v in key.data:
                    digest.update(struct.pack("<3f", *v.co))
    return digest.hexdigest()


def scene_stats():
    bpy.context.view_layer.update()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    points, triangles, morphs, meshes, skinned = [], 0, 0, 0, 0
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH" or obj.hide_render or not obj.visible_get():
            continue
        meshes += 1
        triangles += sum(len(p.vertices) - 2 for p in obj.data.polygons)
        morphs += max(0, len(obj.data.shape_keys.key_blocks) - 1) if obj.data.shape_keys else 0
        skinned += int(any(m.type == "ARMATURE" and m.object for m in obj.modifiers))
        evaluated = obj.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh()
        points.extend(evaluated.matrix_world @ v.co for v in mesh.vertices)
        evaluated.to_mesh_clear()
    require(points, "Source has no mesh geometry")
    low = [min(v[i] for v in points) for i in range(3)]
    high = [max(v[i] for v in points) for i in range(3)]
    # Blender Z-up -> glTF Y-up, without rotating/re-facing the asset.
    low, high = [low[0], low[2], -high[1]], [high[0], high[2], -low[1]]
    return {"meshes": meshes, "triangles": triangles, "morphTargets": morphs, "skinnedMeshes": skinned,
            "bounds": {"min": low, "max": high, "dimensions": [b - a for a, b in zip(low, high)]}}


def load_image(path, color_space, limit, cache):
    key = (str(path), color_space)
    if key in cache:
        return cache[key]
    image = bpy.data.images.load(str(path), check_existing=False)
    image.colorspace_settings.name = color_space
    require(image.size[0] and image.size[1], "Unreadable image: " + str(path))
    width, height = image.size
    # Inspect the original pixels, not the capped export image: downsampling can
    # hide a small hair cutout or a genuinely translucent texel. ActorCore often
    # declares Base Color as Opacity too, despite its alpha being uniformly 1.
    # Keep separate evidence for the alpha channel and a standalone RGB opacity
    # map; an opaque alpha channel says nothing about a grayscale opacity map.
    import numpy as np
    pixels = np.empty(width * height * 4, dtype=np.float32)
    image.pixels.foreach_get(pixels)
    pixels = pixels.reshape((-1, 4))
    image["actorcore_source_alpha_opaque"] = bool(np.all(pixels[:, 3] == 1))
    image["actorcore_source_color_opaque"] = bool(np.all(pixels[:, :3] == 1))
    del pixels
    if max(width, height) > limit:
        ratio = limit / max(width, height)
        image.scale(max(1, round(width * ratio)), max(1, round(height * ratio)))
    image.pack()  # memory only: NEVER save to its original filepath
    cache[key] = image
    return image


def build_material(settings, root, name, limit, cache, files):
    import numpy as np
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    material.use_backface_culling = not settings.get("Two Side", False)
    nodes, links = material.node_tree.nodes, material.node_tree.links
    shader = nodes.get("Principled BSDF")
    diffuse = settings.get("Diffuse Color", [255, 255, 255])
    linear = [((v / 255 + .055) / 1.055) ** 2.4 if v / 255 > .04045 else v / 255 / 12.92 for v in diffuse]
    shader.inputs["Base Color"].default_value = (*linear, 1)
    shader.inputs["Metallic"].default_value = 0  # FBX specular != metallic
    shader.inputs["Roughness"].default_value = .65
    shader.inputs["Alpha"].default_value = settings.get("Opacity", 1)
    textures = settings.get("Textures", {})

    def image_node(channel, color_space="Non-Color"):
        spec = textures.get(channel, {})
        relative = spec.get("Texture Path", "")
        if not relative:
            return None
        path = local_texture(root, relative)
        files.add(path)
        node = nodes.new("ShaderNodeTexImage")
        node.label = channel
        node.image = load_image(path, color_space, limit, cache)
        offset, tiling = spec.get("Offset", [0, 0]), spec.get("Tiling", [1, 1])
        if offset != [0, 0] or tiling != [1, 1]:
            uv = nodes.new("ShaderNodeTexCoord")
            mapping = nodes.new("ShaderNodeMapping")
            mapping.inputs["Location"].default_value = (*offset, 0)
            mapping.inputs["Scale"].default_value = (*tiling, 1)
            links.new(uv.outputs["UV"], mapping.inputs["Vector"])
            links.new(mapping.outputs["Vector"], node.inputs["Vector"])
        return node

    base = image_node("Base Color", "sRGB")
    if base:
        links.new(base.outputs["Color"], shader.inputs["Base Color"])
    opacity = textures.get("Opacity", {}).get("Texture Path")
    if opacity:
        alpha = image_node("Opacity", "sRGB")
        same_as_base = base is not None and alpha.image == base.image
        channel = "Alpha" if same_as_base else "Color"
        opaque_key = "actorcore_source_alpha_opaque" if same_as_base else "actorcore_source_color_opaque"
        if not alpha.image[opaque_key]:
            output = alpha.outputs[channel]
            scalar = settings.get("Opacity", 1)
            if scalar != 1:
                # Linking a texture otherwise overrides the socket default and
                # silently loses authored scalar opacity. glTF exports this
                # multiplier as baseColorFactor.a, retaining texture alpha too.
                multiply = nodes.new("ShaderNodeMath")
                multiply.operation = "MULTIPLY"
                multiply.inputs[1].default_value = scalar
                links.new(output, multiply.inputs[0])
                output = multiply.outputs[0]
            links.new(output, shader.inputs["Alpha"])
        # A redundant all-one link alone makes Blender export BLEND. Leave the
        # scalar socket default intact instead; do not force all materials opaque.
    normal = image_node("Normal")
    if normal:
        convert = nodes.new("ShaderNodeNormalMap")
        convert.inputs["Strength"].default_value = textures["Normal"].get("Strength", 100) / 100
        links.new(normal.outputs["Color"], convert.inputs["Color"])
        links.new(convert.outputs["Normal"], shader.inputs["Normal"])
    packed = image_node("MetallicAlpha")
    ao = image_node("AO")
    if packed:
        # Unity Standard metallic map: R = metallic, A = smoothness. glTF:
        # R = AO, G = roughness (1 - smoothness), B = metallic. Never use RGB
        # color space conversion or treat an empty Metallic path as metallic=1.
        width, height = packed.image.size
        pixels = np.empty(width * height * 4, dtype=np.float32)
        packed.image.pixels.foreach_get(pixels)
        pixels = pixels.reshape((-1, 4))
        orm = np.ones_like(pixels)
        orm[:, 1], orm[:, 2] = 1 - pixels[:, 3], pixels[:, 0]
        key = ("ORM", packed.image.as_pointer())
        if key not in cache:
            image = bpy.data.images.new(packed.image.name + "_glTF_ORM", width, height, alpha=True)
            image.colorspace_settings.name = "Non-Color"
            image.pixels.foreach_set(orm.ravel())
            image.pack()
            cache[key] = image
        packed.image = cache[key]
        separate = nodes.new("ShaderNodeSeparateColor")
        links.new(packed.outputs["Color"], separate.inputs["Color"])
        links.new(separate.outputs["Blue"], shader.inputs["Metallic"])
        links.new(separate.outputs["Green"], shader.inputs["Roughness"])
    else:
        for channel in ("Metallic", "Roughness"):
            texture = image_node(channel)
            if texture:
                links.new(texture.outputs["Color"], shader.inputs[channel])
    if ao:
        group = bpy.data.node_groups.get("glTF Material Output")
        if group is None:
            group = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
            group.interface.new_socket(name="Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
        node = nodes.new("ShaderNodeGroup")
        node.node_tree = group
        links.new(ao.outputs["Color"], node.inputs["Occlusion"])
    glow = image_node("Glow", "sRGB")
    if glow:
        links.new(glow.outputs["Color"], shader.inputs["Emission Color"])
        shader.inputs["Emission Strength"].default_value = textures["Glow"].get("Strength", 100) / 100
    return material


def reconstruct_materials(objects, sidecar, root, limit, files):
    cache, material_cache = {}, {}
    for obj in objects:
        if obj.type != "MESH":
            continue
        for index, old in enumerate(list(obj.data.materials)):
            require(old is not None, "Empty material slot on " + obj.name)
            name = old.name
            key = (obj.name, name)
            if key not in sidecar:
                # Blender adds .001 only when material names collide on import.
                candidates = [k for k in sidecar if k[0] == obj.name and k[1] == name.rsplit(".", 1)[0]]
                require(len(candidates) == 1, "No exact sidecar material for " + str(key))
                key = candidates[0]
            settings = sidecar[key]
            signature = json.dumps(settings, sort_keys=True)
            if signature not in material_cache:
                material_cache[signature] = build_material(settings, root, name + "_glTF", limit, cache, files)
            obj.data.materials[index] = material_cache[signature]
    return [{"name": image.name, "width": image.size[0], "height": image.size[1]} for image in set(cache.values())]


def attach_motions(rig, specs, files):
    clips, seen = [], set()
    if not specs:
        return clips
    require(rig is not None, "Motions require an armature")
    original_fps = bpy.context.scene.render.fps / bpy.context.scene.render.fps_base
    for spec in specs:
        require("=" in spec, "Motion must be NAME=PATH: " + spec)
        name, filename = spec.split("=", 1)
        path = Path(filename).resolve()
        require(name.strip() and path.suffix.lower() == ".fbx" and path.is_file(), "Invalid motion: " + spec)
        digest = sha256(path)
        if digest in seen:
            continue
        require(name not in {clip["name"] for clip in clips}, "Duplicate motion name: " + name)
        seen.add(digest)
        files.add(path)
        objects, actions = import_fbx(path)
        motion_bind = canonicalize_fbx_bind(objects, actions, path, allow_missing_bind=True)
        extra_rigs = [o for o in objects if o.type == "ARMATURE"]
        require(len(extra_rigs) == 1, "Motion must have one armature: " + str(path))
        extra = extra_rigs[0]
        require(set(rig.data.bones.keys()) == set(extra.data.bones.keys()), "Motion bone names do not match target: " + str(path))
        maximum = 0
        for bone in extra.data.bones:
            other = rig.data.bones[bone.name]
            require((bone.parent.name if bone.parent else None) == (other.parent.name if other.parent else None),
                    "Motion hierarchy mismatch: " + bone.name)
            maximum = max(maximum, max(abs(bone.matrix_local[i][j] - other.matrix_local[i][j])
                                       for i in range(4) for j in range(4)))
        require(maximum < .01, "Motion bind coordinates do not match target (max error %.6g): %s" % (maximum, path))
        require(max(abs(rig.matrix_world[i][j] - extra.matrix_world[i][j]) for i in range(4) for j in range(4)) < 1e-5,
                "Motion armature world transform differs from target")
        require(abs(original_fps - bpy.context.scene.render.fps / bpy.context.scene.render.fps_base) < 1e-6,
                "Motion FPS differs from body; resample explicitly before conversion")
        candidates = [a for a in actions if a.frame_range[1] - a.frame_range[0] > 1]
        require(len(candidates) == 1, "Expected one non-default motion take in " + str(path))
        action = candidates[0]
        require(len(action.slots) == 1, "Expected one armature action slot")
        slot = action.slots[0]
        clear_animation(objects)
        rig.animation_data_create()
        action.name = name
        track = rig.animation_data.nla_tracks.new()
        track.name = name
        strip = track.strips.new(name, 0, action)
        strip.action_slot = slot
        strip.name = name
        # Mute during neutral snapshots. Exporter isolates/enables NLA tracks.
        track.mute = True
        clips.append({"name": name, "source": str(path), "sha256": digest,
                      "bindCanonicalization": motion_bind,
                      "duration": (action.frame_range[1] - action.frame_range[0]) / original_fps,
                      "maximumBindMatrixDifference": maximum, "action": action, "slot": slot})
        for obj in objects:
            bpy.data.objects.remove(obj, do_unlink=True)
    return clips


def motion_sample(rig, action, slot, fraction):
    rig.animation_data_create()
    for track in rig.animation_data.nla_tracks:
        track.mute = True
    rig.animation_data.action = action
    if slot:
        rig.animation_data.action_slot = slot
    start, end = action.frame_range
    frame = start + (end - start) * fraction
    bpy.context.scene.frame_set(math.floor(frame), subframe=frame - math.floor(frame))
    result = scene_stats()["bounds"]
    positions = {}
    for bone in rig.pose.bones:
        canonical = BONE_ALIASES.get(bone.name, bone.name)
        if canonical in CORE_BONES.values():
            point = rig.matrix_world @ bone.matrix.translation
            positions[canonical] = [point.x, point.z, -point.y]
    rig.animation_data.action = None
    for bone in rig.pose.bones:
        bone.matrix_basis.identity()
    bpy.context.view_layer.update()
    return {"bounds": result, "joints": positions}


def render_preview(path, size, samples):
    # Preview only: match the studio's neutral calibration after the verified GLB
    # has been written. Never bake this presentation pose into the model/skins.
    rigs = [obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"]
    if len(rigs) == 1:
        rig = rigs[0]
        for side in ("left", "right"):
            for upper_name, end_name in [(side + "Arm", side + "Forearm"), (side + "Forearm", side + "Hand")]:
                upper, end = rig.pose.bones.get(upper_name), rig.pose.bones.get(end_name)
                if not upper or not end:
                    continue
                start = rig.matrix_world @ upper.matrix.translation
                target = rig.matrix_world @ end.matrix.translation
                if (target - start).length < 1e-8:
                    continue
                turn = (target - start).normalized().rotation_difference(Vector((0, 0, -1))).to_matrix().to_4x4()
                upper.matrix = rig.matrix_world.inverted() @ Matrix.Translation(start) @ turn @ Matrix.Translation(-start) @ rig.matrix_world @ upper.matrix
                bpy.context.view_layer.update()
    stats = scene_stats()["bounds"]
    low, high = stats["min"], stats["max"]
    center = Vector(((low[0] + high[0]) / 2, -(low[2] + high[2]) / 2, (low[1] + high[1]) / 2))
    extent = max(stats["dimensions"])
    bpy.ops.object.camera_add(location=center + Vector((.65, -2.8, .45)) * extent)
    camera = bpy.context.object
    camera.rotation_euler = (center - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera.data.type, camera.data.ortho_scale = "ORTHO", extent * 1.25
    scene = bpy.context.scene
    scene.camera = camera
    for offset, energy in [((2, -3, 4), 650), ((-3, -1, 2), 350), ((1, 2, 3), 500)]:
        bpy.ops.object.light_add(type="AREA", location=center + Vector(offset) * extent / 2)
        light = bpy.context.object
        light.data.energy, light.data.shape, light.data.size = energy * extent * extent / 4, "DISK", extent * 2
        light.rotation_euler = (center - light.location).to_track_quat("-Z", "Y").to_euler()
    scene.world = bpy.data.worlds.new("Preview world")
    scene.world.use_nodes = True
    scene.world.node_tree.nodes["Background"].inputs[0].default_value = (.75, .8, .9, 1)
    scene.world.node_tree.nodes["Background"].inputs[1].default_value = .4
    scene.render.engine, scene.cycles.device = "CYCLES", "CPU"
    scene.cycles.samples, scene.cycles.use_denoising = samples, True
    scene.render.film_transparent = True
    scene.render.resolution_x = scene.render.resolution_y = size
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format, scene.render.image_settings.color_mode = "PNG", "RGBA"
    scene.view_settings.view_transform = "AgX"
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)


def prepare(args):
    require(bpy is not None, "Run this converter inside Blender")
    source, output = args.source.resolve(), args.output.resolve()
    require(source.is_file() and source.suffix.lower() == ".fbx", "Source must be an existing FBX")
    require(output.suffix.lower() == ".glb", "Output must end in .glb")
    require(1 <= args.max_texture <= 2048 and 1 <= args.preview_size <= 1024 and args.samples > 0, "Invalid texture/preview limits")
    preview, report_path = output.with_suffix(".png").resolve(), output.with_suffix(".json").resolve()
    sidecar_path = args.sidecar.resolve() if args.sidecar else source.with_suffix(".json")
    require(sidecar_path != report_path, "Output report would overwrite source JSON")
    files = {source, sidecar_path}
    hashes = {str(p): sha256(p) for p in files}
    sidecar = read_sidecar(sidecar_path)
    # Validate/hash referenced images BEFORE Blender imports or resizes anything.
    for material in sidecar.values():
        for spec in material.get("Textures", {}).values():
            if spec.get("Texture Path"):
                path = local_texture(source.parent, spec["Texture Path"])
                files.add(path)
                hashes[str(path)] = sha256(path)
    for motion in args.motion:
        require("=" in motion, "Motion must be NAME=PATH: " + motion)
        motion_path = Path(motion.split("=", 1)[1]).resolve()
        require(motion_path.is_file() and motion_path.suffix.lower() == ".fbx", "Invalid motion: " + motion)
        files.add(motion_path)
        hashes[str(motion_path)] = sha256(motion_path)
    destinations = [output, preview, report_path]
    if args.blend:
        require(args.blend.suffix.lower() == ".blend", "Editable output must end in .blend")
        destinations.append(args.blend.resolve())
    require(len(set(destinations)) == len(destinations) and not set(destinations).intersection(files),
            "Output would overwrite a source asset")
    bpy.context.preferences.filepaths.use_scripts_auto_execute = False
    bpy.ops.wm.read_factory_settings(use_empty=True)
    objects, actions = import_fbx(source)
    bind_canonicalization = canonicalize_fbx_bind(objects, actions, source)
    clear_animation(objects)
    rigs = [o for o in objects if o.type == "ARMATURE"]
    require(len(rigs) <= 1, "Expected at most one body armature")
    rig = rigs[0] if rigs else None
    original, digest = scene_stats(), geometry_digest(objects)
    source_fps, source_fps_base = bpy.context.scene.render.fps, bpy.context.scene.render.fps_base
    images = reconstruct_materials(objects, sidecar, source.parent, args.max_texture, files)
    clips = attach_motions(rig, args.motion, files)
    samples = {}
    for clip in clips:
        samples[clip["name"]] = [motion_sample(rig, clip["action"], clip["slot"], t) for t in (.0, .5, 1.)]
    require(digest == geometry_digest(objects), "Conversion changed source geometry/morphs/weights")
    output.parent.mkdir(parents=True, exist_ok=True)
    bpy.context.scene.frame_set(1)
    if rig and rig.animation_data:
        rig.animation_data.action = None
        for track in rig.animation_data.nla_tracks:
            track.mute = False
    bpy.ops.export_scene.gltf(filepath=str(output), export_format="GLB", export_yup=True,
                              export_animations=bool(clips), export_animation_mode="NLA_TRACKS",
                              export_frame_range=False, export_force_sampling=True,
                              export_optimize_animation_size=False, export_skins=True,
                              export_def_bones=False, export_all_influences=True,
                              export_morph=True, export_morph_normal=True, export_apply=False,
                              export_image_format="AUTO", export_cameras=False, export_lights=False)
    document, binary = read_glb(output)
    renamed = canonical_names(document)
    normalization = normalize_joints(document, binary)
    normalization["translationNoise"] = normalize_translation_noise(document, binary)
    require(all("uri" not in image and "bufferView" in image for image in document.get("images", [])), "Images not embedded")
    require(all("uri" not in buffer for buffer in document.get("buffers", [])), "External GLB buffers")
    animations = []
    for animation in document.get("animations", []):
        times = [document["accessors"][s["input"]] for s in animation["samplers"]]
        animations.append({"name": animation["name"], "duration": max(a["max"][0] for a in times) - min(a["min"][0] for a in times),
                           "channels": len(animation["channels"])})
    require({a["name"] for a in animations} == {c["name"] for c in clips}, "Exported clips differ from requested takes")
    for clip in clips:
        actual = next(a for a in animations if a["name"] == clip["name"])
        require(abs(actual["duration"] - clip["duration"]) < .04, "Motion duration truncated: " + clip["name"])
    write_glb(output, document, binary)
    document, binary = read_glb(output)
    raw_verification = verify_raw_gltf(document, binary, original, samples)
    # A clean scene is essential: verify the actual portable output, not our FBX scene.
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps, bpy.context.scene.render.fps_base = source_fps, source_fps_base
    bpy.ops.import_scene.gltf(filepath=str(output))
    imported_objects = list(bpy.context.scene.objects)
    imported_rigs = [o for o in imported_objects if o.type == "ARMATURE"]
    imported_rig = imported_rigs[0] if imported_rigs else None
    imported_actions = {}
    if imported_rig and imported_rig.animation_data:
        for track in imported_rig.animation_data.nla_tracks:
            for strip in track.strips:
                imported_actions[track.name] = (strip.action, strip.action_slot)
                track.mute = True
        imported_rig.animation_data.action = None
        for bone in imported_rig.pose.bones:
            bone.matrix_basis.identity()
    bpy.context.view_layer.update()
    reimport = scene_stats()
    require(reimport["triangles"] == original["triangles"], "Re-import triangle count differs")
    require(reimport["morphTargets"] == original["morphTargets"], "Re-import morph count differs")
    require(reimport["skinnedMeshes"] == original["skinnedMeshes"], "Re-import skin count differs")
    bounds_error = max(abs(original["bounds"][edge][i] - reimport["bounds"][edge][i]) for edge in ("min", "max") for i in range(3))
    require(bounds_error < .001, "Re-import changed rest bounds: %.6g m" % bounds_error)
    motion_checks = []
    for name, expected in samples.items():
        require(name in imported_actions, "Missing re-imported motion: " + name)
        action, slot = imported_actions[name]
        actual = [motion_sample(imported_rig, action, slot, t) for t in (0., .5, 1.)]
        error = max(abs(a["bounds"][edge][i] - b["bounds"][edge][i]) for a, b in zip(expected, actual) for edge in ("min", "max") for i in range(3))
        joint_error = max(abs(a["joints"][n][i] - b["joints"][n][i]) for a, b in zip(expected, actual) for n in a["joints"] for i in range(3))
        require(error < .003 and joint_error < .003,
                "Re-import animation deformation differs: %s (bounds %.6g m, joints %.6g m); expected %s; actual %s"
                % (name, error, joint_error, json.dumps(expected), json.dumps(actual)))
        motion_checks.append({"name": name, "maximumBoundsErrorMeters": error,
                              "maximumJointPositionErrorMeters": joint_error, "samples": actual, "sourceSamples": expected})
    decoded_images = [{"name": im.name, "width": im.size[0], "height": im.size[1]} for im in bpy.data.images if im.users]
    require(all(im["width"] > 0 and im["height"] > 0 and max(im["width"], im["height"]) <= args.max_texture for im in decoded_images),
            "Re-import image missing or exceeds limit")
    for path in files:
        hashes.setdefault(str(path), sha256(path))
    require(all(sha256(path) == digest for path, digest in hashes.items()), "A source file changed")
    if args.blend:
        require(args.blend.resolve() != source, "Blend output conflicts with source")
        args.blend.parent.mkdir(parents=True, exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=str(args.blend.resolve()))
    # The PNG is rendered from the exported/re-imported GLB, in its authored rest/facing.
    render_preview(preview, args.preview_size, args.samples)
    report = {"source": str(source), "output": str(output), "preview": str(preview), "blenderVersion": bpy.app.version_string,
              **reimport, "images": decoded_images, "textureCount": len(document.get("textures", [])),
              "embeddedImageCount": len(document.get("images", [])), "animations": animations,
              "canonicalJointNames": renamed, "bindScaleNormalization": normalization,
              "fbxBindCanonicalization": bind_canonicalization,
              "geometryWeightsMorphsUnchanged": True, "sourceGeometryDigest": digest,
              "sources": hashes, "sourceFilesUnchanged": True,
              "verification": {"glbReimported": True, "maximumRestBoundsErrorMeters": bounds_error,
                               "rest": reimport, "motionChecks": motion_checks, "rawGLTF": raw_verification},
              "motionSources": [{k: v for k, v in c.items() if k not in ("action", "slot")} for c in clips],
              "materialPolicy": "ActorCore JSON base/normal/AO/emission/opacity; Unity MetallicAlpha R metallic, A smoothness -> glTF G roughness/B metallic; absent metallic is dielectric",
              "previewRender": {"engine": "CYCLES", "device": "CPU", "size": args.preview_size, "samples": args.samples,
                                "pose": "calibrated-arms-down" if rig else "authored-rest"}}
    report_path.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
    print("ACTORCORE_REPORT " + str(report_path))
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--sidecar", type=Path)
    parser.add_argument("--motion", action="append", default=[], metavar="NAME=FBX")
    parser.add_argument("--max-texture", type=int, default=2048)
    parser.add_argument("--preview-size", type=int, default=512)
    parser.add_argument("--samples", type=int, default=24)
    parser.add_argument("--blend", type=Path)
    args = parser.parse_args(argv)
    prepare(args)


if __name__ == "__main__":
    try:
        main(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else None)
    except Exception as error:
        print("ACTORCORE_ERROR " + str(error), file=sys.stderr)
        raise
