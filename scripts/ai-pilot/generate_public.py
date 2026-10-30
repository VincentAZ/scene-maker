"""Anonymous official FLUX reference + Hunyuan shape-only inference.
This calls actual public GPU inference; errors propagate, outputs are reloaded.
"""
from pathlib import Path
from PIL import Image
import json
import shutil
import hashlib
import numpy as np
import trimesh
from gradio_client import Client, handle_file

ROOT=Path('.data/ai-pilot')
REFERENCES=ROOT/'references'
OUTPUT=ROOT/'generated'
REFERENCES.mkdir(parents=True,exist_ok=True)
OUTPUT.mkdir(parents=True,exist_ok=True)
CASES=[
 ('bankers-lamp',29001,'Product photograph of one antique bankers desk lamp, emerald green curved rectangular glass lampshade, polished golden brass vertical stem, oval heavy brass base, small pull chain, elegant realistic proportions, entire lamp fully visible, isolated on pure white background, three quarter front view, studio softbox lighting, extremely detailed, realistic materials, professional catalogue photograph'),
 ('archivist-male',29002,'Full body studio photograph of a realistic middle aged male archivist, short brown hair, clean shaven, wearing a fitted brown tweed vest over a cream long sleeved shirt and dark brown trousers, brown leather shoes, standing facing camera in a symmetrical T pose, both arms extended straight horizontally to sides, palms facing down, fingers straight, legs straight and feet shoulder width apart, entire body visible including both hands and feet, isolated on pure white background, neutral expression, realistic human proportions, professional character reference photography'),
 ('investigator-female',29003,'Full body studio photograph of a realistic adult female investigator, dark tied back hair, wearing a fitted muted dark teal jacket over a cream shirt and fitted charcoal trousers, dark leather shoes, standing facing camera in a symmetrical T pose, both arms extended straight horizontally to sides, palms facing down, fingers straight, legs straight and feet shoulder width apart, entire body visible including both hands and feet, isolated on pure white background, neutral expression, realistic human proportions, professional character reference photography'),
]
flux=Client('https://black-forest-labs-flux-1-schnell.hf.space',token=False)
hunyuan=Client('https://tencent-hunyuan3d-2.hf.space',token=False)
for name,seed,prompt in CASES:
    reference=REFERENCES/f'{name}.png'
    if not reference.exists():
        result=flux.predict(prompt,seed,False,1024,1024,4,api_name='/infer')
        Image.open(result[0]).convert('RGB').save(reference)
        reference.with_suffix('.json').write_text(json.dumps(dict(model='black-forest-labs/FLUX.1-schnell',space='black-forest-labs/FLUX.1-schnell',space_revision='2569ee41266dd6d3a5e84c2a5ea3f4ad6e4ff25e',license='Apache-2.0',prompt=prompt,seed=result[1],steps=4,width=1024,height=1024,sha256=hashlib.sha256(reference.read_bytes()).hexdigest(),status='Actual AI-generated reference; visual pose quality requires review'),indent=2))
        print(f'GENERATED REFERENCE {reference}',flush=True)
    target=OUTPUT/f'{name}-hunyuan-remote-untextured.glb'
    if target.exists():
        continue
    result=hunyuan.predict(None,handle_file(str(reference)),None,None,None,None,40,5,seed+10000,384,False,16000,False,api_name='/shape_generation')
    remote_path=result[0]['value']
    shutil.copy2(remote_path,target)
    scene=trimesh.load(target,force='scene')
    assert scene.geometry and np.isfinite(scene.bounds).all()
    meta=dict(model='tencent/Hunyuan3D-2/hunyuan3d-dit-v2-0',space='tencent/Hunyuan3D-2',space_revision='40b9abf02675534b9e80e3150bd97b85c135c8c8',license='Tencent Hunyuan 3D 2.0 Community License Agreement',license_url='https://huggingface.co/tencent/Hunyuan3D-2/blob/main/LICENSE',license_limitations='Excludes EU UK South Korea; >1M MAU special license; see downloaded full license',input_reference=str(reference),input_sha256=hashlib.sha256(reference.read_bytes()).hexdigest(),server_stats=result[2],seed=result[3],geometry=[dict(vertices=len(g.vertices),faces=len(g.faces),visual=g.visual.kind) for g in scene.geometry.values()],bounds=scene.bounds.tolist(),bytes=target.stat().st_size,sha256=hashlib.sha256(target.read_bytes()).hexdigest(),status='Actual AI-generated shape, untextured and unrigged; visual quality and riggability require review')
    target.with_suffix('.json').write_text(json.dumps(meta,indent=2))
    print(f'GENERATED AND RELOADED {target}',flush=True)
