"""Shared studio staging for every product shoot (consistent backdrop, lights, framing)."""
import math
import os

import bpy
from mathutils import Vector

import shoot_lib as L

RES = int(os.environ.get('RES', 1000))
SAMPLES = int(os.environ.get('SAMPLES', 48))

BGS = {   # backdrop linear colour, world colour, world strength, key power (at k=1)
    'blue': dict(col=(0.018, 0.058, 0.115), world=(0.4, 0.55, 0.8), ws=0.35, key=110),
    'sky':  dict(col=(0.20, 0.42, 0.78), world=(0.6, 0.75, 1.0), ws=0.30, key=85),
    'sand': dict(col=(0.60, 0.46, 0.33), world=(1.0, 0.88, 0.74), ws=0.30, key=85),
    'mist': dict(col=(0.50, 0.58, 0.68), world=(0.8, 0.88, 1.0), ws=0.30, key=95),
}


def begin(bg='blue', k=1.0, target=(0, 0, 0.05), res=None, samples=None, flat=0.55):
    """Reset Blender and build the studio. k = linear size of the subject area in metres (1 = mug-sized shots)."""
    L.reset()
    L.setup_render(res=res or RES, samples=samples or SAMPLES)
    cfg = BGS[bg]
    L.set_world(cfg['world'], cfg['ws'])
    kb = max(k, 1.0)
    L.backdrop(cfg['col'], rough=0.9, width=14 * kb, curve_r=1.3 * kb, wall_h=5 * kb, depth=6 * kb, flat=flat * kb)
    kp = cfg['key']
    L.studio_lights(target, scale=k, key_power=kp)
    key = bpy.data.objects['key']
    key.location = (target[0] - 1.2 * k, target[1] - 0.9 * k, target[2] + 2.5 * k)
    key.data.size, key.data.size_y = 2.4 * k, 2.0 * k
    for n in ('rim', 'fill'):
        bpy.data.objects[n].data.use_shadow = False
    s = L.area_light('strip', (target[0] - 0.9 * k, target[1] - 0.75 * k, target[2] + 0.12 * k), target, 0.22 * k, 22 * k * k, (1, 1, 1), size_y=1.1 * k)
    s.data.use_shadow = False
    L.area_light('card', (target[0], target[1] - 1.2 * k, target[2] + 0.35 * k), target, 1.0 * k, 8 * k * k, (1, 1, 1), size_y=0.7 * k)


def cam_fit(center, size, az=0.0, el=12.0, lens=85, fill=0.74, fstop=16, shift=(0, 0)):
    """Frame a subject of width `size` (m) so it fills `fill` of the frame width."""
    d = size * lens / (36.0 * fill)
    a, e = math.radians(az), math.radians(el)
    c = Vector(center)
    loc = (c.x + d * math.sin(a) * math.cos(e), c.y - d * math.cos(a) * math.cos(e), c.z + d * math.sin(e))
    return L.camera(loc, center, lens=lens, fstop=fstop, shift=shift)


def finish(path, alt=None):
    L.render(path)
    if alt:
        try:
            from PIL import Image
            im = Image.open(path)
            ex = Image.Exif()
            ex[270] = alt          # ImageDescription
            ex[315] = 'Devdha'     # Artist
            im.save(path, quality=93, exif=ex.tobytes(), subsampling=0)
        except Exception as e:   # metadata is a nicety, never fail the render for it
            print('exif skipped', e)
