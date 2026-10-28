"""Build an original skinned character from a validated declarative asset specification.
No model-generated Python is executed. Outputs a self-contained, weighted GLB.
"""
import bpy
import json
import sys
from mathutils import Vector, Euler, Quaternion
from math import pi
spec_path, output_path = sys.argv[sys.argv.index('--') + 1:]
spec = json.load(open(spec_path, encoding='utf-8'))
bpy.ops.wm.read_factory_settings(use_empty=True)
# Coordinates are defined in creator-space (+Y up), then converted to Blender's +Z.
def point(v):
    return Vector((v[0], -v[2], v[1]))
def material(color):
    mat = bpy.data.materials.new(color)
    rgb = tuple(int(color[i:i+2], 16) / 255 for i in (1, 3, 5))
    mat.diffuse_color = (*rgb, 1)
    mat.use_nodes = True
    mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*rgb, 1)
    mat.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.8
    return mat
skin = spec['color'] if spec['body'] == 'mannequin' else spec['skin']
colors = {c: material(c) for c in {spec['color'], skin, '#46534f', '#353c39', '#49382e', '#eadcc3'}}
joints = [('hips', None, (0,.9,0)), ('spine','hips',(0,1.08,0)), ('head','spine',(0,1.61,0)), ('leftArm','spine',(.25,1.38,0)), ('leftForearm','leftArm',(.25,1.09,0)), ('rightArm','spine',(-.25,1.38,0)), ('rightForearm','rightArm',(-.25,1.09,0)), ('leftLeg','hips',(.13,.86,0)), ('leftShin','leftLeg',(.13,.46,0)), ('rightLeg','hips',(-.13,.86,0)), ('rightShin','rightLeg',(-.13,.46,0))]
armature = bpy.data.armatures.new('Creator rig')
rig = bpy.data.objects.new('Character rig', armature)
bpy.context.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
rig.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
for name, parent, pos in joints:
    bone = armature.edit_bones.new(name)
    bone.head = point(pos)
    bone.tail = bone.head + Vector((0, 0, .15 if name in ('hips','spine','head') else -.15))
    if parent:
        bone.parent = armature.edit_bones[parent]
bpy.ops.object.mode_set(mode='OBJECT')
parts = []
def part(name, position, scale, color):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=12, location=point(position))
    obj = bpy.context.object
    obj.scale = (scale[0], scale[2], scale[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(colors[color])
    group = obj.vertex_groups.new(name=name)
    group.add(list(range(len(obj.data.vertices))), 1, 'REPLACE')
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    parts.append(obj)
part('hips',(0,.9,0),(.22,.16,.14),'#46534f')
part('spine',(0,1.23,0),(.23 if spec['body']=='feminine' else .26,.31,.15),spec['color'])
part('head',(0,1.65,0),(.17,.22,.16),skin)
if spec['body'] != 'mannequin':
    part('head',(0,1.77,-.035),(.176,.14,.15),'#49382e')
    for x in (-.065,.065):
        part('head',(x,1.66,.15),(.014,.02,.012),'#353c39')
    if spec['body']=='feminine':
        part('head',(0,1.61,-.12),(.18,.23,.08),'#49382e')
for side, x in [('left',.25),('right',-.25)]:
    part(side+'Arm',(x,1.25,0),(.09,.2,.09),spec['color'])
    part(side+'Forearm',(x,.96,0),(.065,.17,.065),skin)
    part(side+'Forearm',(x,.79,0),(.065,.075,.05),skin)
    legx = .13 if x>0 else -.13
    part(side+'Leg',(legx,.68,0),(.095,.25,.1),'#46534f')
    part(side+'Shin',(legx,.29,0),(.075,.23,.08),'#46534f')
    part(side+'Shin',(legx,.11,.06),(.09,.065,.15),'#353c39')
if spec['style'] in ('Chef','Barista'):
    part('spine',(0,1.1,.14),(.18,.27,.025),'#eadcc3')
if spec['style'] in ('Chef','Builder','Astronaut','Firefighter'):
    part('head',(0,1.83,0),(.21,.13,.19),spec['color'])
if spec.get('parts'):
    for obj in parts:
        bpy.data.objects.remove(obj, do_unlink=True)
    parts = []
    basis = Quaternion((1, 0, 0), pi / 2)
    for shape in spec['parts']:
        kind = shape['shape']
        if kind == 'box':
            bpy.ops.mesh.primitive_cube_add(size=1)
        elif kind == 'cylinder':
            bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=.5, depth=1)
        elif kind == 'cone':
            bpy.ops.mesh.primitive_cone_add(vertices=24, radius1=.5, radius2=0, depth=1)
        elif kind == 'torus':
            bpy.ops.mesh.primitive_torus_add(major_radius=.4, minor_radius=.1, major_segments=24, minor_segments=12)
            bpy.context.object.rotation_euler.x = pi / 2
            bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
        else:
            bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=16, radius=.5)
        obj = bpy.context.object
        obj.location = point(shape['position'])
        obj.scale = (shape['scale'][0], shape['scale'][2], shape['scale'][1])
        obj.rotation_mode = 'QUATERNION'
        obj.rotation_quaternion = basis @ Euler(shape['rotation'], 'XYZ').to_quaternion() @ basis.inverted()
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        obj.data.materials.append(material(shape['color']))
        group = obj.vertex_groups.new(name=shape.get('bone', 'hips'))
        group.add(list(range(len(obj.data.vertices))), 1, 'REPLACE')
        parts.append(obj)
bpy.ops.object.select_all(action='DESELECT')
for obj in parts:
    obj.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.join()
body = bpy.context.object
body.name = spec['name']
body.parent = rig
modifier = body.modifiers.new('Skin', 'ARMATURE')
modifier.object = rig
bpy.ops.export_scene.gltf(filepath=output_path, export_format='GLB', export_skins=True)
print('SCENE_MAKER_CHARACTER', output_path)
