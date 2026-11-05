# Library thumbnails rendered by Blender, shared by the content converters.
# render_thumbnail(scene, camera, path) draws the scene with EEVEE from
# `camera`, auto-exposing once so a dim interior and a sunlit square both read
# on a library card. Imported by the converter scripts (see lib/thumbnail.mjs).
import math

import bpy
import numpy as np


def mean_luminance(image):
    px = np.empty(len(image.pixels), dtype=np.float32)
    image.pixels.foreach_get(px)
    px = px.reshape(-1, 4)
    lum = px[:, 0] * 0.2126 + px[:, 1] * 0.7152 + px[:, 2] * 0.0722
    return float(lum.mean()) if lum.size else 0.0


def render_thumbnail(scene, camera, path, width=640, height=400):
    scene.camera = camera
    r = scene.render
    r.engine = "BLENDER_EEVEE_NEXT"
    r.resolution_x, r.resolution_y, r.resolution_percentage = width, height, 100
    r.film_transparent = False
    r.image_settings.file_format = "PNG"
    r.image_settings.color_mode = "RGB"
    r.filepath = path
    scene.eevee.taa_render_samples = 32
    scene.eevee.use_shadows = True
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "None"
    # Two passes: the artist's exposure was tuned for another renderer, so
    # measure the first frame and correct the exposure toward a mid grey of
    # 0.35 (display values) before the final frame.
    for final in (False, True):
        bpy.ops.render.render(write_still=True)
        if final:
            break
        image = bpy.data.images.load(path)
        mean = mean_luminance(image)
        bpy.data.images.remove(image)
        if mean <= 1e-4:
            break
        stop = max(-4.0, min(4.0, math.log2(0.35 / mean)))
        if abs(stop) < 0.25:
            break
        scene.view_settings.exposure += stop
