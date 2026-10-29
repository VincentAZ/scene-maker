"""Check A seat at the table's actual browser-exported animation in Blender.
Usage: blender --background --python-exit-code 1 --python this.py -- scene.blend scene.json
"""
import bpy
import json
import sys
from pathlib import Path
from mathutils import Vector
blend, source = sys.argv[sys.argv.index('--')+1:]
scene = json.loads(Path(source).read_text())
actor = next(e for e in scene['entities'] if e['name'] == 'Mila')
assert [c['motionId'] for c in actor['clips']] == ['sit','talk','wave','sip','stand','walk']
seat = next(e for e in scene['entities'] if e['id'] == actor['clips'][0]['targetId'])
prop = next(e for e in scene['entities'] if e['id'] == actor['clips'][3]['targetId'])
bpy.ops.wm.open_mainfile(filepath=str(Path(blend).resolve()))
rig = bpy.data.objects['entity_'+actor['id']]
chair = bpy.data.objects['entity_'+seat['id']]
cup = bpy.data.objects['entity_'+prop['id']]
assert rig.type == 'ARMATURE'
assert len([o for o in bpy.data.objects if o.type == 'ARMATURE']) == 1
meshes = [o for o in rig.children_recursive if o.type == 'MESH']
assert meshes
hip_vertices = {}
for mesh in meshes:
    group = mesh.vertex_groups.get('hips')
    if group:
        ids = [v.index for v in mesh.data.vertices if any(g.group == group.index and g.weight >= .4 for g in v.groups)]
        if ids: hip_vertices[mesh.name] = ids
assert hip_vertices

def at(t):
    frame = t*24
    bpy.context.scene.frame_set(int(frame), subframe=frame-int(frame))

def points(mesh):
    evaluated = mesh.evaluated_get(bpy.context.evaluated_depsgraph_get())
    return [evaluated.matrix_world @ v.co for v in evaluated.data.vertices]

def joint(name):
    return rig.matrix_world @ rig.pose.bones[name].matrix.translation

at(0)
chair_home = chair.matrix_world.copy()
cup_home = cup.matrix_world.copy()
# Independently ray-cast just the chair meshes at the centre of its seat.
origin = Vector((seat['position'][0],-seat['position'][2],seat['position'][1]+2))
hits=[]
for mesh in [chair,*chair.children_recursive]:
    if mesh.type != 'MESH': continue
    inverse=mesh.matrix_world.inverted()
    hit, location, normal, _ = mesh.ray_cast(inverse @ origin, inverse.to_3x3() @ Vector((0,0,-1)))
    if hit: hits.append((mesh.matrix_world @ location).z)
assert hits
seat_height=max(hits)
sit_end=actor['clips'][0]['duration']
sip_start=sum(c['duration'] for c in actor['clips'][:3])
stand_start=sum(c['duration'] for c in actor['clips'][:4])
walk_start=sum(c['duration'] for c in actor['clips'][:5])
end=sum(c['duration'] for c in actor['clips'])
at(sit_end)
seated_hip=joint('hips')
sole_errors=[]
pelvis_gaps=[]
hip_errors=[]
chair_errors=[]
for frame in range(round(sit_end*24),round(stand_start*24)+1):
    at(frame/24)
    vertices={m.name:points(m) for m in meshes}
    sole_errors.append(abs(min(v.z for values in vertices.values() for v in values)-seat['position'][1]))
    pelvis_gaps.append(min(vertices[name][i].z for name,ids in hip_vertices.items() for i in ids)-seat_height)
    hip_errors.append((joint('hips')-seated_hip).length)
    chair_errors.append(max(abs(a-b) for x,y in zip(chair_home,chair.matrix_world) for a,b in zip(x,y)))
assert max(sole_errors)<.002, f'Shoe/floor gap: {max(sole_errors)}'
assert min(pelvis_gaps)>-.001 and max(pelvis_gaps)<.01, f'Pelvis/seat gaps: {min(pelvis_gaps)}, {max(pelvis_gaps)}'
assert max(hip_errors)<.0001
assert max(chair_errors)<1e-6
at(sip_start+1.5)
upper=rig.data.bones['rightArm'].matrix_local
lower=rig.data.bones['rightForearm'].matrix_local
hand_local=lower.inverted() @ (lower.translation+(lower.translation-upper.translation)*(.3/.29))
hand=rig.matrix_world @ rig.pose.bones['rightForearm'].matrix @ hand_local
grip=cup.matrix_world @ Vector((.13,0,.08))
grip_error=(hand-grip).length
mouth=joint('head')+Vector((0,-.18,-.03))
rim_error=((cup.matrix_world @ Vector((0,.04,.15)))-mouth).length
assert grip_error<.002 and rim_error<.03
assert cup.matrix_world.translation.z-cup_home.translation.z>.2
at(stand_start)
release_error=max(abs(a-b) for x,y in zip(cup_home,cup.matrix_world) for a,b in zip(x,y))
assert release_error<1e-5
at(walk_start)
standing=joint('hips')
walk_from=rig.matrix_world.translation.copy()
assert standing.z-seated_hip.z>.2
at(end)
walk_delta=rig.matrix_world.translation-walk_from
assert abs(walk_delta.length-2*actor['scale'])<1e-5
# Subframe continuity across seated gesture changes, standing and walking.
gaps=[]
for boundary in [sit_end,7,sip_start,stand_start,walk_start]:
    at(boundary-.0001);before=joint('hips')
    at(boundary+.0001);gaps.append((joint('hips')-before).length)
assert max(gaps)<.001, f'Boundary jump: {max(gaps)}'
assert bpy.context.scene.render.fps==24
assert bpy.context.scene.frame_start==0 and bpy.context.scene.frame_end==round(end*24)
print('SCENE_MAKER_SEATING_VERIFIED',json.dumps({'seated_frames':len(sole_errors),'seat_height_m':seat_height,'maximum_sole_error_m':max(sole_errors),'pelvis_gap_m':[min(pelvis_gaps),max(pelvis_gaps)],'hip_drift_m':max(hip_errors),'chair_drift':max(chair_errors),'grip_error_m':grip_error,'rim_error_m':rim_error,'release_error':release_error,'stand_rise_m':standing.z-seated_hip.z,'walk_distance_m':walk_delta.length,'maximum_boundary_gap_m':max(gaps),'end_frame':bpy.context.scene.frame_end}))
