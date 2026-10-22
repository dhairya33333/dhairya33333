"""Group B: photo frames, polaroid packs, apparel (tees, polo, kids)."""
import math
import random

import bmesh
import bpy
from mathutils import Vector

import common as C
import shoot_lib as L
from registry import register

APP = {   # fabric colours (linear) and which ink to print
    'white': ((0.56, 0.56, 0.55), 'navy'), 'black': ((0.022, 0.022, 0.025), 'white'), 'navy': ((0.025, 0.06, 0.15), 'white'),
    'red': ((0.45, 0.04, 0.05), 'white'), 'sky': ((0.30, 0.55, 0.85), 'navy'), 'yellow': ((0.85, 0.62, 0.08), 'navy'),
    'green': ((0.05, 0.30, 0.14), 'white'), 'grey': ((0.30, 0.31, 0.33), 'white'),
}


# ------------------------------------------------------------------ photo frames
FRAME_SIZES = {'a5': (0.148, 0.210), 'a4': (0.210, 0.297), 'a3': (0.297, 0.420)}


def frame_obj(size, tone='black'):
    w, h = FRAME_SIZES[size]
    rail, depth = 0.016 + 0.012 * (h / 0.3), 0.020
    wood = L.principled('framewood', (0.015, 0.015, 0.017), 0.35, **{'Coat_Weight': 0.3}) if tone == 'black' else L.wood((0.55, 0.38, 0.2), (0.75, 0.55, 0.32), 0.4, 5)
    root = L.group('frame')
    for (bw, bh, x, z) in ((w, rail, 0, rail / 2), (w, rail, 0, h - rail / 2), (rail, h - 2 * rail, -w / 2 + rail / 2, h / 2), (rail, h - 2 * rail, w / 2 - rail / 2, h / 2)):
        r_ = L.box(bw, depth, bh, 0.0012, 'rail', wood, loc=(x, 0, z - bh / 2))
        L.parent_to(r_, root)
    back = L.box(w - 0.004, 0.004, h - 0.004, 0.0005, 'back', L.principled('backb', (0.08, 0.08, 0.09), 0.7), loc=(0, depth / 2 - 0.0015, 0.002))
    L.parent_to(back, root)
    iw, ih = w - 2 * rail, h - 2 * rail
    mat_ = L.grid_plane(iw, ih, 2, 2, 'mat', L.paper((0.97, 0.97, 0.95), 0.55), loc=(0, -depth / 2 + 0.0035, h / 2), rot=(math.radians(90), 0, 0))
    L.parent_to(mat_, root)
    m = min(iw, ih) * 0.09
    pw, ph = iw - 2 * m, ih - 2 * m
    photo = L.grid_plane(pw, ph, 4, 4, 'photo', L.textured('frame_photo', 'ph_photo_%d.jpg' % (1 if size == 'a4' else (2 if size == 'a3' else 0)), rough=0.22, clearcoat=0.5),
                         loc=(0, -depth / 2 + 0.0030, h / 2), rot=(math.radians(90), 0, 0))
    L.parent_to(photo, root)
    strut = L.box(0.025, 0.004, h * 0.62, 0.0008, 'strut', L.principled('strutb', (0.05, 0.05, 0.055), 0.6), loc=(0, depth / 2 + 0.0, 0.02), rot=(math.radians(-34), 0, 0))
    L.parent_to(strut, root)
    root.rotation_euler = (math.radians(-9), 0, 0)
    return root, w, h


@register('frame')
def frame(job):
    size = job['variant'].split('-')[0]          # a5 / a4 / a3  (variant like 'a4-black')
    tone = job['variant'].split('-')[1] if '-' in job['variant'] else 'black'
    view = job['view']
    w, h = FRAME_SIZES[size]
    C.begin(job.get('bg', 'blue'), k=max(0.7, h * 2.4), target=(0, 0, h / 2))
    root, w, h = frame_obj(size, tone)
    tilt = math.radians(-9)
    tgt = (0, 0, h * 0.52)
    big = max(w, h)
    if view == 'front':
        C.cam_fit(tgt, big * 1.05, az=0, el=5, lens=100, fill=0.82)
    elif view == 'angled':
        root.rotation_euler = (tilt, 0, math.radians(-26))
        C.cam_fit(tgt, big * 1.08, az=0, el=12, lens=100, fill=0.82)
    elif view == 'detail':
        root.rotation_euler = (tilt, 0, math.radians(-22))
        C.cam_fit((-w * 0.30, 0, h * 0.80), big * 0.55, az=14, el=10, lens=100, fill=0.82, fstop=11)
    elif view == 'side':
        root.rotation_euler = (tilt, 0, math.radians(-62))
        C.cam_fit(tgt, big * 1.05, az=0, el=8, lens=100, fill=0.82)
    C.finish(job['out'], job.get('alt'))


# ------------------------------------------------------------------ polaroids
def _polaroid(root, mini=False, hue=0, loc=(0, 0, 0), rot=(0, 0, 0), name='pol'):
    s = 0.62 if mini else 1.0
    w, h, t = 0.088 * s, 0.107 * s, 0.0007
    card = L.box(w, h, t, 0.0003, name, L.principled('polpaper', (0.95, 0.94, 0.91), 0.45, **{'Coat_Weight': 0.1}), loc=(0, 0, 0))
    side = 0.079 * s
    ph = L.grid_plane(side, side, 3, 3, name + '_ph', L.textured('polph%d' % hue, 'ph_photo_%d.jpg' % (hue % 6), rough=0.18, clearcoat=0.4),
                      z=t + 0.00012, loc=(0, (h - side) / 2 - 0.0045 * s, 0))
    g = L.group(name + '_g')
    L.parent_to(card, g)
    L.parent_to(ph, g)
    g.location = loc
    g.rotation_euler = rot
    L.parent_to(g, root)
    return g


def polaroid_obj(n, root=None):
    """Pack of n polaroid prints: paper block with twine + a fan of printed cards. Returns (root, stack_h, span)."""
    mini = n == 7
    root = root or L.group('pol')
    s = 0.62 if mini else 1.0
    stack_h = max(0.008, n * 0.00034)
    body = L.box(0.088 * s, 0.107 * s, stack_h, 0.0003, 'stack', L.principled('stackm', (0.95, 0.94, 0.91), 0.55), loc=(0, 0, 0))
    L.parent_to(body, root)
    _polaroid(root, mini, 0, (0, 0, stack_h + 0.0001), (0, 0, math.radians(3)), 'top')
    fan = [(-0.092 * s - 0.010, 0.006, 0.0008, -18, 1), (0.100 * s + 0.004, 0.000, 0.0016, 14, 2), (0.004, -0.108 * s - 0.004, 0.0024, 5, 3), (-0.040 * s, 0.100 * s + 0.002, 0.0032, -8, 4)]
    for i, (x, y, z, a_, hue) in enumerate(fan):
        _polaroid(root, mini, hue, (x * 1.0, y, z), (0, 0, math.radians(a_)), 'fan%d' % i)
    twine = L.principled('twine', (0.65, 0.5, 0.32), 0.9)
    t1 = L.box(0.0035, 0.107 * s + 0.003, stack_h + 0.0016, 0.0006, 'twine1', twine, loc=(0.020 * s, 0, -0.0008))
    t2 = L.box(0.088 * s + 0.003, 0.0035, stack_h + 0.0016, 0.0006, 'twine2', twine, loc=(0, 0.0, -0.0008))
    L.parent_to(t1, root)
    L.parent_to(t2, root)
    return root, stack_h, 0.20 * s + 0.05


@register('polaroid')
def polaroid(job):
    n = int(job['variant'].split('-')[0])        # 7 / 20 / 50 / 100
    mini = n == 7
    view = job['view']
    C.begin(job.get('bg', 'blue'), k=0.8, target=(0, 0, 0.02))
    s = 0.62 if mini else 1.0
    root, stack_h, span = polaroid_obj(n)
    tgt = (0.0, 0.0, 0.012)
    if view == 'top':
        C.cam_fit(tgt, span, az=0, el=80, lens=85, fill=0.80)
    elif view == 'angled':
        root.rotation_euler = (0, 0, math.radians(-14))
        C.cam_fit(tgt, span, az=0, el=34, lens=85, fill=0.84)
    elif view == 'side':
        root.rotation_euler = (0, 0, math.radians(-14))
        C.cam_fit((0, 0, stack_h / 2), span * 0.8, az=-10, el=14, lens=100, fill=0.84, fstop=14)
    elif view == 'detail':
        C.cam_fit((0.0, 0.0, stack_h + 0.002), 0.13 * s + 0.03, az=-8, el=36, lens=100, fill=0.80, fstop=16)
    C.finish(job['out'], job.get('alt'))


# ------------------------------------------------------------------ apparel
TEE_HALF = [(9, 35.5), (24, 32.5), (47, 23), (57, 6), (46, -3.5), (27, 4), (26.5, -36)]
NECK = [(7, 34.5), (4.5, 30), (0, 27.5), (-4.5, 30), (-7, 34.5)]


def _tee_outline(scale=1.0):
    r = [(26.5, -36), (27, 11), (41, 7), (50.5, 15), (45, 25), (24, 32.5), (9, 35.5)]
    left = [(-x, y) for (x, y) in r[::-1]]
    poly = r + NECK + left
    return [(x * 0.01 * scale, y * 0.01 * scale) for (x, y) in poly]


def _slab_from_outline(poly, thick=0.0065, voxel=0.0026):
    me = bpy.data.meshes.new('tee')
    bm = bmesh.new()
    vs = [bm.verts.new((x, y, 0)) for (x, y) in poly]
    bm.faces.new(vs)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new('tee', me)
    bpy.context.collection.objects.link(ob)
    sm = ob.modifiers.new('solid', 'SOLIDIFY')
    sm.thickness = thick
    sm.offset = 1.0
    rm = ob.modifiers.new('remesh', 'REMESH')
    rm.mode = 'VOXEL'
    rm.voxel_size = voxel
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    for name in ('solid', 'remesh'):
        with bpy.context.temp_override(object=ob, active_object=ob, selected_objects=[ob]):
            bpy.ops.object.modifier_apply(modifier=name)
    return ob


def _wrinkle(seed, amp=0.0016):
    f = L.cloth_fn(seed, amp, freq=11.0)
    # two soft diagonal folds across the torso
    def g(x, y):
        z = f(x, y)
        z += 0.0028 * math.exp(-((y + 0.22 + 0.10 * x) / 0.035) ** 2) * math.sin(x * 22)
        z += 0.0022 * math.exp(-((y - 0.02 - 0.15 * x) / 0.05) ** 2)
        return z
    return g


def tee_build(kind, color_name, scale=1.0, seed=3):
    base, ink = APP[color_name]
    root = L.group('tee')
    outline = _tee_outline(scale)
    slab = _slab_from_outline(outline)
    wr = _wrinkle(seed)
    me = slab.data
    for v in me.vertices:
        v.co.z += wr(v.co.x, v.co.y)
    me.update()
    slab.data.materials.append(L.fabric(base, rough=0.95, bump=0.15, name='tee_fab', weave=1800))
    for p in slab.data.polygons:
        p.use_smooth = True
    L.parent_to(slab, root)
    # neck rib
    neck_pts = [(x * 0.01 * scale, y * 0.01 * scale - 0.0, 0.0062 + wr(x * 0.01 * scale, y * 0.01 * scale)) for (x, y) in [(9, 35.2), (7, 34.0), (4.5, 29.6), (0, 27.0), (-4.5, 29.6), (-7, 34.0), (-9, 35.2)]]
    rib = L.tube(neck_pts, 0.0048 * scale, 'rib', L.fabric(tuple(c * 0.92 for c in base), 0.95, 0.4, 'rib', 2600))
    rib.scale = (1, 1, 0.55)
    L.parent_to(rib, root)
    # sleeve hems and bottom hem (stitch lines)
    st = L.principled('stitch', tuple(c * 0.8 for c in base), 0.9)
    for pts in ([(-26.5, -34.6), (26.5, -34.6)],):
        pp = [(x * 0.01 * scale, y * 0.01 * scale, 0.0062 + wr(x * 0.01 * scale, y * 0.01 * scale)) for (x, y) in pts]
        L.parent_to(L.tube(pp, 0.0007, 'hem', st), root)
    # print
    pr = 0.26 * scale
    dec = L.grid_plane(pr, pr, 24, 24, 'print', L.textured('tee_print', 'tee_ink_%s.png' % ink, rough=0.7, alpha=True, bump=0.0),
                       loc=(0, 0.05 * scale, 0.0), fn=lambda x, y: 0.0080 + wr(x, y + 0.05 * scale))
    L.parent_to(dec, root)
    if kind == 'polo':
        # placket + buttons + collar flaps
        pl = L.principled('placket', tuple(c * 0.86 for c in base), 0.9)
        pk = L.box(0.032 * scale, 0.19 * scale, 0.0012, 0.0004, 'placket', pl, loc=(0, 0.17 * scale, 0.0052))
        L.parent_to(pk, root)
        for i in range(3):
            b = L.lathe([(0, 0), (0.0045, 0), (0.0048, 0.001), (0.0042, 0.002), (0, 0.0022)], 'btn', L.plastic((0.9, 0.9, 0.9) if color_name != 'white' else (0.55, 0.55, 0.57), 0.3), seg=24,
                        loc=(0, (0.29 - i * 0.045) * scale, 0.0068))
            L.parent_to(b, root)
        for sgn in (-1, 1):
            cp = [(sgn * 0.004, 0.285), (sgn * 0.095, 0.350), (sgn * 0.075, 0.250), (sgn * 0.008, 0.235)]
            cp = [(x * scale, y * scale) for (x, y) in (cp if sgn > 0 else cp)]
            me2 = bpy.data.meshes.new('collar')
            bm2 = bmesh.new()
            vs2 = [bm2.verts.new((x, y, 0.0060)) for (x, y) in (cp if sgn > 0 else cp[::-1])]
            bm2.faces.new(vs2)
            bm2.to_mesh(me2)
            bm2.free()
            co = L.to_obj(me2, 'collar', L.fabric(tuple(c * 0.95 for c in base), 0.95, 0.45, 'collarm', 2200), True)
            sol = co.modifiers.new('s', 'SOLIDIFY')
            sol.thickness = 0.003
            L.parent_to(co, root)
    return root


@register('tee')
def tee(job):
    # variant: <style>-<colour>, style in round|polo|kids
    style, colour = job['variant'].split('-')
    view = job['view']
    scale = 0.74 if style == 'kids' else 1.0
    C.begin(job.get('bg', 'blue'), k=0.9, target=(0, 0, 0.0))
    root = tee_build('polo' if style == 'polo' else 'tee', colour, scale, seed=sum(ord(c) for c in colour) % 7)
    tgt = (0, 0.0, 0.0)
    size = 1.12 * scale
    if view == 'front':
        C.cam_fit(tgt, size, az=0, el=84, lens=85, fill=0.84, fstop=18)
    elif view == 'angled':
        root.rotation_euler = (0, 0, math.radians(-8))
        C.cam_fit((0, 0.02, 0.0), size, az=0, el=42, lens=85, fill=0.88, fstop=14)
    elif view == 'detail':
        root.rotation_euler = (0, 0, math.radians(-6))
        C.cam_fit((0.0, 0.07 * scale, 0.004), 0.30 * scale, az=0, el=58, lens=100, fill=0.86, fstop=5)
    C.finish(job['out'], job.get('alt'))
