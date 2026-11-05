# Library thumbnails rendered by Blender, shared by the content converters.
# render_thumbnail(scene, camera, path) draws the scene with EEVEE from
# `camera`, auto-exposing once so a dim interior and a sunlit square both read
# on a library card. Imported by the converter scripts (see lib/thumbnail.mjs).
import math

import bpy
import numpy as np


def luminances(image):
    px = np.empty(len(image.pixels), dtype=np.float32)
    image.pixels.foreach_get(px)
    px = px.reshape(-1, 4)
    return px[:, 0] * 0.2126 + px[:, 1] * 0.7152 + px[:, 2] * 0.0722


def render_thumbnail(scene, camera, path, width=640, height=400):
    scene.camera = camera
    r = scene.render
    # Blender 4.2–4.5 calls its EEVEE "EEVEE Next"; 4.1 and 5.x plain EEVEE.
    engines = {item.identifier for item in r.bl_rna.properties["engine"].enum_items}
    r.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in engines else "BLENDER_EEVEE"
    r.resolution_x, r.resolution_y, r.resolution_percentage = width, height, 100
    r.film_transparent = False
    r.image_settings.file_format = "PNG"
    r.image_settings.color_mode = "RGB"
    r.filepath = path
    scene.eevee.taa_render_samples = 32
    scene.eevee.use_shadows = True
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "None"
    # The artist's compositing (glare, lens distortion), grading curves and
    # motion blur were made for their own renders, not a library card.
    r.use_compositing = False
    r.use_sequencer = False
    r.use_motion_blur = False
    scene.view_settings.use_curve_mapping = False
    # Two passes: the artist's exposure was tuned for another renderer, so
    # measure the first frame and correct the exposure toward a mid grey of
    # 0.35 (display values) before the final frame, without pushing the
    # brightest 3 % past 90 % white (a sunlit wall beside a dark roof).
    for final in (False, True):
        bpy.ops.render.render(write_still=True)
        if final:
            break
        image = bpy.data.images.load(path)
        lum = luminances(image)
        bpy.data.images.remove(image)
        if lum.size == 0 or lum.mean() <= 1e-4:
            break
        bright = max(float(np.percentile(lum, 97)), 1e-4)
        stop = max(-4.0, min(4.0, math.log2(0.35 / float(lum.mean())), math.log2(0.9 / bright)))
        if abs(stop) < 0.25:
            break
        scene.view_settings.exposure += stop
