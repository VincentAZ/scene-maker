"""Generate genuine SDXL reference images locally; no credentials required.
Run using .data/ai-pilot/venv/bin/python with HF_HOME set inside .data/ai-pilot.
"""
import os
os.environ['HF_HUB_DISABLE_IMPLICIT_TOKEN'] = '1'
from pathlib import Path
import json
import hashlib
import torch
from diffusers import StableDiffusionXLPipeline

OUT = Path('.data/ai-pilot/references')
OUT.mkdir(parents=True, exist_ok=True)
MODEL = 'stabilityai/stable-diffusion-xl-base-1.0'
REVISION = '462165984030d82259a11f4367a4eed129e94a7b'
CASES = [
 ('bankers-lamp', 29001, 'Product photograph of one antique bankers desk lamp, emerald green curved rectangular glass lampshade, polished golden brass vertical stem, oval heavy brass base, small pull chain, elegant realistic proportions, entire lamp fully visible, isolated on pure white background, three quarter front view, studio softbox lighting, extremely detailed, realistic materials, professional catalogue photograph'),
 ('archivist-male', 29002, 'Full body studio photograph of a realistic middle aged male archivist, short brown hair, clean shaven, wearing a fitted brown tweed vest over a cream long sleeved shirt and dark brown trousers, brown leather shoes, standing facing camera in a symmetrical T pose, both arms extended straight horizontally to sides, palms facing down, fingers straight, legs straight and feet shoulder width apart, entire body visible including both hands and feet, isolated on pure white background, neutral expression, realistic human proportions, professional character reference photography'),
 ('investigator-female', 29003, 'Full body studio photograph of a realistic adult female investigator, dark tied back hair, wearing a fitted muted dark teal jacket over a cream shirt and fitted charcoal trousers, dark leather shoes, standing facing camera in a symmetrical T pose, both arms extended straight horizontally to sides, palms facing down, fingers straight, legs straight and feet shoulder width apart, entire body visible including both hands and feet, isolated on pure white background, neutral expression, realistic human proportions, professional character reference photography'),
]
pipe = StableDiffusionXLPipeline.from_pretrained(MODEL, revision=REVISION, variant='fp16', torch_dtype=torch.float16, use_safetensors=True, token=False).to('cuda')
for name, seed, prompt in CASES:
    path = OUT / f'{name}.png'
    if path.exists():
        continue
    image = pipe(prompt=prompt, negative_prompt='illustration, cartoon, anime, toy, figurine, low poly, blurry, cropped, cut off, extra limbs, extra fingers, deformed hands, text, watermark, collage, multiple views, multiple people', num_inference_steps=40, guidance_scale=7.0, width=1024, height=1024, generator=torch.Generator('cuda').manual_seed(seed)).images[0]
    image.save(path)
    metadata = dict(model=MODEL, revision=REVISION, license='CreativeML Open RAIL++-M', license_url=f'https://huggingface.co/{MODEL}/blob/main/LICENSE.md', prompt=prompt, seed=seed, steps=40, guidance_scale=7.0, width=1024, height=1024, output_sha256=hashlib.sha256(path.read_bytes()).hexdigest(), status='AI-generated reference image; not yet a 3D asset')
    path.with_suffix('.json').write_text(json.dumps(metadata, indent=2))
    print(f'GENERATED {path}', flush=True)
