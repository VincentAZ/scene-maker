"""Verify the actual furnished-room browser export in Blender, independently of Three.js.
Pass scene.blend and scene.json from the portable production package.
"""
import bpy
import json
import math
import sys
from pathlib import Path
from mathutils import Vector

blend, definition = map(Path, sys.argv[sys.argv.index('--') + 1:])
scene = json.loads(definition.read_text())
bpy.ops.wm.open_mainfile(filepath=str(blend.resolve()))
manifest = json.loads(Path('docs/furniture-sources.json').read_text())
dimensions = {'furniture-' + Path(row['file']).stem: row['dimensions_m'] for row in manifest['models']}
assert len(scene['entities']) == 17
furniture = [e for e in scene['entities'] if e['assetId'] in dimensions]
assert len(furniture) == 14
roots = {e['id']: bpy.data.objects['entity_' + e['id']] for e in scene['entities']}

def at(seconds):
    frame = seconds * 24
    bpy.context.scene.frame_set(int(frame), subframe=frame-int(frame))

def vertices(root, skinned=False):
    points=[]
    graph=bpy.context.evaluated_depsgraph_get()
    for obj in root.children_recursive:
        if obj.type != 'MESH' or (skinned and not any(m.type=='ARMATURE' for m in obj.modifiers)):continue
        evaluated=obj.evaluated_get(graph)
        mesh=evaluated.to_mesh()
        points.extend(evaluated.matrix_world @ v.co for v in mesh.vertices)
        evaluated.to_mesh_clear()
    assert points and all(math.isfinite(c) for p in points for c in p)
    return points

at(0)
errors=[]
static={}
for entity in furniture:
    root=roots[entity['id']]
    points=vertices(root)
    static[entity['id']]=points
    low=Vector(tuple(min(p[i] for p in points) for i in range(3)))
    high=Vector(tuple(max(p[i] for p in points) for i in range(3)))
    width,height,depth=dimensions[entity['assetId']]
    sine,cosine=abs(math.sin(entity['rotation'])),abs(math.cos(entity['rotation']))
    expected=Vector((width*cosine+depth*sine,depth*cosine+width*sine,height))*entity['scale']
    errors.append((high-low-expected).length)
    x,y,z=entity['position']
    errors.append((root.matrix_world.translation-Vector((x,-z,y))).length)
    assert abs(low.z-y)<.0001,(entity['name'],low.z,y)
assert max(errors)<.0001,max(errors)
actors=[e for e in scene['entities'] if e['name'] in ('Simone','Adrian')]
assert len([o for o in bpy.data.objects if o.type=='ARMATURE'])==2
initial={e['name']:vertices(roots[e['id']],True) for e in actors}
at(.8)
deformation={e['name']:max((a-b).length for a,b in zip(initial[e['name']],vertices(roots[e['id']],True))) for e in actors}
assert all(value>.05 for value in deformation.values()),deformation
at(5)
static_error=max((a-b).length for e in furniture for a,b in zip(static[e['id']],vertices(roots[e['id']])))
assert static_error<.0001,static_error
assert bpy.context.scene.render.fps==24
assert bpy.context.scene.frame_end==288
print(json.dumps({'furniture_instances':len(furniture),'placement_and_size_error_m':max(errors),'static_error_m':static_error,'rigs':len(actors),'skin_deformation_m':deformation,'fps':24,'frame_end':288},indent=2))
