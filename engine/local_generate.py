"""Local SDXL -> Hunyuan3D geometry job (CUDA; never a texture or rig generator).

Usage: .data/ai-pilot/venv/bin/python engine/local_generate.py -- spec.json raw.glb reference.png provenance.json
Only spec.allowDownload=true permits Hugging Face downloads. No installs or shell commands.
Reference paths must already have been approved by the calling server.
Dependencies: torch (CUDA), diffusers, transformers, huggingface_hub, safetensors,
Pillow, numpy, scipy, trimesh and the Hunyuan3D-2 source/dependencies in ROOT.
"""
import gc
import hashlib
import json
import os
from pathlib import Path
import sys
import time

SDXL_MODEL = "stabilityai/stable-diffusion-xl-base-1.0"
SDXL_REVISION = "462165984030d82259a11f4367a4eed129e94a7b"
SHAPE_MODEL = "tencent/Hunyuan3D-2"
SHAPE_REVISION = "9cd649ba6913f7a852e3286bad86bfa9a2d83dcf"
NEGATIVE_PROMPT = ("illustration, cartoon, anime, toy, figurine, low poly, blurry, cropped, cut off, "
                   "extra limbs, extra fingers, deformed hands, text, watermark, collage, multiple views, multiple people")
MAX_SPEC_BYTES = 65536
MAX_REFERENCE_BYTES = 32 * 1024 * 1024
MAX_REFERENCE_PIXELS = 4096 * 4096


def bounded_integer(value, name, low, high):
    if type(value) is not int or not low <= value <= high:
        raise ValueError(f"{name} must be an integer between {low} and {high}")
    return value


def validate_spec(spec):
    """Pure stdlib validation; importing this module does not import torch."""
    if not isinstance(spec, dict):
        raise ValueError("spec must be a JSON object")
    prompt = spec.get("prompt")
    if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > 4000 or "\x00" in prompt:
        raise ValueError("prompt must contain 1..4000 characters without NUL")
    if spec.get("category") not in ("characters", "props"):
        raise ValueError("category must be characters or props")
    result = dict(spec)
    result["prompt"] = prompt.strip()
    result["seed"] = bounded_integer(spec.get("seed", 39004), "seed", 0, 2**32 - 1)
    result["steps"] = bounded_integer(spec.get("steps", 40), "steps", 1, 100)
    result["octreeResolution"] = bounded_integer(spec.get("octreeResolution", 384), "octreeResolution", 64, 512)
    if type(spec.get("allowDownload", False)) is not bool:
        raise ValueError("allowDownload must be a boolean")
    result["allowDownload"] = spec.get("allowDownload", False)
    reference = spec.get("reference")
    if reference is not None:
        if not isinstance(reference, str) or not reference or "\x00" in reference or "://" in reference:
            raise ValueError("reference must be a local file path")
        path = Path(reference).expanduser().resolve(strict=True)
        if not path.is_file() or not 0 < path.stat().st_size <= MAX_REFERENCE_BYTES:
            raise ValueError("reference must be a nonempty file <=32 MiB")
        result["reference"] = str(path)
    return result


def parse_arguments(argv):
    args = argv[argv.index("--") + 1:] if "--" in argv else argv
    if len(args) != 4:
        raise ValueError("usage: local_generate.py -- <spec.json> <raw-output.glb> <thumbnail.png> <provenance.json>")
    paths = [Path(arg).expanduser().resolve() for arg in args]
    source, output, thumbnail, provenance = paths
    if not source.is_file() or not 0 < source.stat().st_size <= MAX_SPEC_BYTES:
        raise ValueError("spec must be a nonempty JSON file <=64 KiB")
    spec = validate_spec(json.loads(source.read_text(encoding="utf-8")))
    if [p.suffix.lower() for p in paths[1:]] != [".glb", ".png", ".json"]:
        raise ValueError("output paths must end in .glb, .png and .json respectively")
    protected = [source] + ([Path(spec["reference"])] if spec.get("reference") else [])
    if len(set(paths)) != 4 or any(p in protected for p in paths[1:]):
        raise ValueError("input and output paths must be distinct")
    for path in paths[1:]:
        if path.exists():
            raise ValueError(f"refusing to overwrite existing output: {path}")
    return spec, paths


def reference_prompt(spec):
    if spec["category"] == "characters":
        framing = ("Full body studio photograph, realistic adult human proportions, symmetrical T pose, "
                   "both arms extended straight horizontally, palms down, straight fingers, "
                   "legs straight, feet shoulder width apart, neutral expression, "
                   "entire body including both hands and feet visible, riggable character reference")
    else:
        framing = "Realistic product catalogue photograph, one object, entire object visible, three quarter front view"
    return f"{spec['prompt']}. {framing}, isolated on pure white background, studio softbox lighting, highly detailed"


def remove_white_background(image):
    """Only border-connected near-white pixels become alpha; preserve enclosed whites and input alpha."""
    import numpy as np
    from scipy import ndimage
    from PIL import Image
    rgba = np.array(image.convert("RGBA"))
    near_white = np.min(rgba[..., :3], axis=2) > 235
    border = np.zeros(near_white.shape, dtype=bool)
    border[0, :] = border[-1, :] = True
    border[:, 0] = border[:, -1] = True
    background = ndimage.binary_propagation(border & near_white, mask=near_white)
    rgba[background, 3] = 0
    return Image.fromarray(rgba)


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def progress(stage, percent, message):
    print("PROGRESS " + json.dumps(dict(stage=stage, progress=int(percent), message=message)), flush=True)


def license_record(model, revision, identifier, filename, snapshot=None):
    path = Path(snapshot) / filename if snapshot else None
    return dict(id=identifier, url=f"https://huggingface.co/{model}/blob/{revision}/{filename}",
                local_path=str(path) if path and path.is_file() else None,
                sha256=sha256(path) if path and path.is_file() else None)


def generate(spec, paths):
    # Set offline guards BEFORE importing any model code (including transitive loaders).
    root = Path(os.environ.get("SCENE_MAKER_LOCAL_3D_ROOT", ".data/ai-pilot")).expanduser().resolve()
    os.environ.setdefault("HF_HOME", str(root / "hf"))
    os.environ.setdefault("HF_HUB_DISABLE_IMPLICIT_TOKEN", "1")
    offline = not spec["allowDownload"]
    if offline:
        os.environ["HF_HUB_OFFLINE"] = "1"
        os.environ["TRANSFORMERS_OFFLINE"] = "1"
    source = root / "Hunyuan3D-2"
    if not (source / "hy3dgen" / "shapegen" / "pipelines.py").is_file():
        raise FileNotFoundError(f"Hunyuan3D source missing: {source}")
    sys.path.insert(0, str(source))
    import numpy as np
    from PIL import Image
    import torch
    import trimesh
    from huggingface_hub import snapshot_download
    if not torch.cuda.is_available():
        raise RuntimeError("Local generation requires a CUDA GPU; no placeholder fallback is provided")
    Image.MAX_IMAGE_PIXELS = MAX_REFERENCE_PIXELS
    source_path, output, thumbnail, provenance = paths
    for path in paths[1:]:
        path.parent.mkdir(parents=True, exist_ok=True)
    start = time.monotonic()
    prompt = reference_prompt(spec)
    reference_info = dict(kind="provided" if spec.get("reference") else "sdxl-generated", preview_kind="reference-image-not-3d-render")
    progress("reference", 0, "Loading approved reference" if spec.get("reference") else "Loading pinned SDXL model")
    # Fail before spending GPU time on SDXL if the shape weights are absent.
    snapshot = Path(snapshot_download(SHAPE_MODEL, revision=SHAPE_REVISION,
                                     allow_patterns=["hunyuan3d-dit-v2-0/config.yaml", "hunyuan3d-dit-v2-0/model.fp16.safetensors", "LICENSE*", "NOTICE*"],
                                     token=False, local_files_only=offline))
    model_dir = snapshot / "hunyuan3d-dit-v2-0"
    for filename in ("config.yaml", "model.fp16.safetensors"):
        if not (model_dir / filename).is_file():
            raise FileNotFoundError(f"Required cached model file missing: {model_dir / filename}")
    if spec.get("reference"):
        with Image.open(spec["reference"]) as opened:
            if opened.format not in ("PNG", "JPEG", "WEBP") or min(opened.size) < 64 or opened.width * opened.height > MAX_REFERENCE_PIXELS:
                raise ValueError("reference must be PNG/JPEG/WEBP, at least 64px per side and <=16 megapixels")
            image = opened.convert("RGBA")
        reference_info.update(input_path=spec["reference"], input_sha256=sha256(spec["reference"]))
    else:
        from diffusers import StableDiffusionXLPipeline
        pipe = StableDiffusionXLPipeline.from_pretrained(
            SDXL_MODEL, revision=SDXL_REVISION, variant="fp16", torch_dtype=torch.float16,
            use_safetensors=True, token=False, local_files_only=offline).to("cuda")
        def reference_callback(_pipe, step, _timestep, kwargs):
            progress("reference", 10 + int(85 * (step + 1) / spec["steps"]), "SDXL diffusion")
            return kwargs
        image = pipe(prompt=prompt, negative_prompt=NEGATIVE_PROMPT, num_inference_steps=spec["steps"],
                     guidance_scale=7.0, width=1024, height=1024,
                     generator=torch.Generator("cuda").manual_seed(spec["seed"]),
                     callback_on_step_end=reference_callback).images[0]
        if not isinstance(image, Image.Image) or image.size != (1024, 1024) or np.std(np.array(image)) < 1:
            raise RuntimeError("SDXL returned an invalid/blank reference image")
        reference_info.update(model=SDXL_MODEL, revision=SDXL_REVISION, prompt=prompt,
                              negative_prompt=NEGATIVE_PROMPT, seed=spec["seed"], steps=spec["steps"],
                              guidance_scale=7.0, width=1024, height=1024,
                              license=license_record(SDXL_MODEL, SDXL_REVISION, "creativeml-openrail++-m", "LICENSE.md"))
        del pipe
        gc.collect()
        torch.cuda.empty_cache()
    image.save(thumbnail, format="PNG")
    reference_info.update(path=str(thumbnail), sha256=sha256(thumbnail))
    progress("reference", 100, "Reference image saved; this is not a 3D preview")
    progress("shape", 0, "Loading pinned Hunyuan3D shape model")
    from hy3dgen.shapegen import Hunyuan3DDiTFlowMatchingPipeline
    pipe = Hunyuan3DDiTFlowMatchingPipeline.from_single_file(
        str(model_dir / "model.fp16.safetensors"), str(model_dir / "config.yaml"),
        use_safetensors=True, device="cuda", dtype=torch.float16)
    cleaned = remove_white_background(image)
    alpha = np.array(cleaned.getchannel("A"))
    if not np.any(alpha):
        raise ValueError("Reference has no foreground after background removal")
    cleaned_path = thumbnail.with_name(thumbnail.stem + "-shape-input.png")
    if cleaned_path.exists() or cleaned_path in paths or str(cleaned_path) == spec.get("reference"):
        raise ValueError(f"Shape input path already exists or collides: {cleaned_path}")
    cleaned.save(cleaned_path)
    def shape_callback(step, *_args):
        progress("shape", 10 + int(75 * (step + 1) / spec["steps"]), "Hunyuan3D diffusion")
    mesh = pipe(image=cleaned, num_inference_steps=spec["steps"], guidance_scale=5.0,
                octree_resolution=spec["octreeResolution"], num_chunks=16000,
                generator=torch.Generator("cuda").manual_seed(spec["seed"]),
                callback=shape_callback, callback_steps=1)[0]
    if not isinstance(mesh, trimesh.Trimesh) or len(mesh.vertices) < 100 or len(mesh.faces) < 100 or not np.all(np.isfinite(mesh.vertices)):
        raise RuntimeError("Hunyuan3D returned invalid geometry")
    progress("shape", 90, "Exporting and reloading actual generated GLB")
    mesh.export(str(output), file_type="glb")
    verified = trimesh.load(str(output), force="scene")
    if not verified.geometry or verified.bounds is None or not np.all(np.isfinite(verified.bounds)) or not np.all(np.ptp(mesh.vertices, axis=0) > 0):
        output.unlink(missing_ok=True)
        raise RuntimeError("Exported GLB failed reload validation")
    commit_file = root / "Hunyuan3D-source-commit.txt"
    metadata = dict(schema_version=1, status="UNTEXTURED UNRIGGED", textured=False, rigged=False,
                    quality_review_required=True, prompt=spec["prompt"], category=spec["category"],
                    seed=spec["seed"], allow_download=spec["allowDownload"], spec_sha256=sha256(source_path),
                    reference=reference_info, shape=dict(model=SHAPE_MODEL, revision=SHAPE_REVISION,
                    source_root=str(source), source_commit=commit_file.read_text().strip() if commit_file.is_file() else None,
                    license=license_record(SHAPE_MODEL, SHAPE_REVISION, "LicenseRef-Tencent-Hunyuan3D-2-Community", "LICENSE", snapshot),
                    license_limitations="Excludes EU, UK and South Korea; >1M MAU commercial terms; review full license and acceptable-use restrictions",
                    source_license_sha256=sha256(source / "LICENSE") if (source / "LICENSE").is_file() else None,
                    seed=spec["seed"], steps=spec["steps"], guidance_scale=5.0, octree_resolution=spec["octreeResolution"],
                    num_chunks=16000, dtype="float16", device=torch.cuda.get_device_name(),
                    config_sha256=sha256(model_dir / "config.yaml"),
                    input_path=str(cleaned_path), input_sha256=sha256(cleaned_path),
                    background_cleanup="Border-connected RGB >235 made transparent; existing alpha preserved"),
                    output=dict(path=str(output), sha256=sha256(output), bytes=output.stat().st_size,
                                vertices=len(mesh.vertices), faces=len(mesh.faces), bounds=verified.bounds.tolist()),
                    elapsed_seconds=round(time.monotonic() - start, 3),
                    versions=dict(torch=torch.__version__, numpy=np.__version__, trimesh=trimesh.__version__))
    provenance.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    progress("shape", 100, "Generated real geometry: UNTEXTURED UNRIGGED; review required")
    print("STATS " + json.dumps(metadata), flush=True)


def main(argv=None):
    try:
        spec, paths = parse_arguments(sys.argv[1:] if argv is None else argv)
        generate(spec, paths)
        return 0
    except Exception as error:
        print(f"ERROR {type(error).__name__}: {error}", file=sys.stderr, flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
