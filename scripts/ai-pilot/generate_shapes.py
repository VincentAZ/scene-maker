"""Actual Hunyuan3D diffusion geometry, not procedural replacement geometry.
Requires local Hunyuan source on PYTHONPATH and isolated HF_HOME.
Outputs are untextured until a real texture-generation stage is completed.
"""
import os
os.environ['HF_HUB_DISABLE_IMPLICIT_TOKEN'] = '1'
from pathlib import Path
import hashlib
import json
import time
import numpy as np
from scipy import ndimage
from PIL import Image
import torch
import trimesh
from huggingface_hub import snapshot_download
from hy3dgen.shapegen import Hunyuan3DDiTFlowMatchingPipeline

MODEL = 'tencent/Hunyuan3D-2'
REVISION = '9cd649ba6913f7a852e3286bad86bfa9a2d83dcf'
ROOT = Path('.data/ai-pilot')
OUT = ROOT / 'generated'
OUT.mkdir(parents=True, exist_ok=True)
model_dir = Path(snapshot_download(MODEL, revision=REVISION, allow_patterns=['hunyuan3d-dit-v2-0/config.yaml', 'hunyuan3d-dit-v2-0/model.fp16.safetensors', 'LICENSE*', 'NOTICE*'], token=False)) / 'hunyuan3d-dit-v2-0'
pipe = Hunyuan3DDiTFlowMatchingPipeline.from_single_file(str(model_dir/'model.fp16.safetensors'), str(model_dir/'config.yaml'), use_safetensors=True, device='cuda', dtype=torch.float16)
for name, seed in [('bankers-lamp', 39001), ('archivist-male',39002), ('investigator-female',39003)]:
    reference = ROOT / 'references' / f'{name}.png'
    deadline = time.monotonic() + 3600
    while not reference.exists():
        if time.monotonic() > deadline:
            raise TimeoutError(f'Reference not generated: {reference}')
        time.sleep(10)
    rgb = np.array(Image.open(reference).convert('RGB'))
    near_white = np.min(rgb, axis=2) > 235
    border = np.zeros(near_white.shape, dtype=bool)
    border[0,:] = border[-1,:] = True
    border[:,0] = border[:,-1] = True
    background = ndimage.binary_propagation(border & near_white, mask=near_white)
    rgba = np.concatenate([rgb, ((~background)*255).astype(np.uint8)[...,None]],axis=2)
    image = Image.fromarray(rgba)
    input_path = OUT / f'{name}-input.png'
    image.save(input_path)
    start = time.monotonic()
    mesh = pipe(image=image, num_inference_steps=40, guidance_scale=5.0, octree_resolution=384, num_chunks=16000, generator=torch.Generator('cuda').manual_seed(seed))[0]
    if not isinstance(mesh, trimesh.Trimesh) or len(mesh.vertices) < 100 or len(mesh.faces) < 100:
        raise RuntimeError(f'Model returned invalid mesh for {name}')
    target = OUT / f'{name}-hunyuan-untextured.glb'
    mesh.export(target)
    verified = trimesh.load(target, force='scene')
    if not verified.geometry or not np.all(np.isfinite(verified.bounds)):
        raise RuntimeError('Exported GLB failed reload validation')
    metadata = dict(model=MODEL, revision=REVISION, source_commit='recorded in Hunyuan3D-source-commit.txt', license='Tencent Hunyuan 3D 2.0 Community License Agreement', license_url=f'https://huggingface.co/{MODEL}/blob/main/LICENSE', license_limitations='Territory excludes EU, UK, South Korea; >1M MAU commercial license requirements; see downloaded full license', input_reference=str(reference), input_sha256=hashlib.sha256(reference.read_bytes()).hexdigest(), background_cleanup='border-connected RGB >235 white pixels made transparent; no geometry synthesized by cleanup', seed=seed, steps=40, guidance_scale=5.0, octree_resolution=384, elapsed_seconds=time.monotonic()-start, vertices=len(mesh.vertices), faces=len(mesh.faces), glb_bytes=target.stat().st_size, output_sha256=hashlib.sha256(target.read_bytes()).hexdigest(), bounds=verified.bounds.tolist(), status='Actual AI-generated geometry, untextured, not rigged; visual quality and riggability require review')
    target.with_suffix('.json').write_text(json.dumps(metadata, indent=2))
    print(f'GENERATED AND RELOADED {target}: {len(mesh.vertices)} vertices, {len(mesh.faces)} faces', flush=True)
