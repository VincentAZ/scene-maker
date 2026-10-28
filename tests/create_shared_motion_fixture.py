"""Original T-pose humanoid with altered bone axes, travel, turning and an overhead arm pose.

blender --background --python tests/create_shared_motion_fixture.py -- output-directory
No third-party character or animation is used.
"""
import bpy
import runpy
import sys
from pathlib import Path
from math import pi
from mathutils import Matrix

directory = Path(sys.argv[sys.argv.index('--') + 1]).resolve()
runpy.run_path(str(Path(__file__).with_name('create_imported_fixture.py')), run_name='__main__')
rig = next(obj for obj in bpy.data.objects if obj.type == 'ARMATURE')
rig.animation_data_clear()
rig.location = (0, 0, 0)
rig.rotation_mode = 'XYZ'
arm = rig.pose.bones['mixamorig:RightArm']
arm.rotation_mode = 'QUATERNION'
rest = arm.bone.matrix_local.copy()
head = arm.bone.head_local.copy()
for frame, amount in [(0, 0), (24, 1), (48, 0)]:
    rig.location = (0, -2 * frame / 48, 0)
    rig.rotation_euler = (0, 0, pi / 2 * frame / 48)
    rig.keyframe_insert(data_path='location', frame=frame)
    rig.keyframe_insert(data_path='rotation_euler', frame=frame)
    arm.matrix = Matrix.Translation(head) @ Matrix.Rotation(pi / 2 * amount, 4, 'Y') @ Matrix.Translation(-head) @ rest
    arm.keyframe_insert(data_path='rotation_quaternion', frame=frame)
rig.animation_data.action.name = 'Turn and greet'
for layer in rig.animation_data.action.layers:
    for strip in layer.strips:
        for bag in strip.channelbags:
            for curve in bag.fcurves:
                for key in curve.keyframe_points:
                    key.interpolation = 'LINEAR'
bpy.context.scene.frame_set(0)
bpy.ops.export_scene.gltf(filepath=str(directory / 'shared-motion.glb'), export_format='GLB', export_animations=True)
bpy.ops.export_scene.fbx(filepath=str(directory / 'shared-motion.fbx'), add_leaf_bones=False, bake_anim=True)
print('SCENE_MAKER_SHARED_FIXTURE', str(directory / 'shared-motion.fbx'))
