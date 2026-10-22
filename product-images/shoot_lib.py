"""Studio rig + procedural product modelling helpers for Blender (bpy) / Cycles.

All units are metres. Run with a Python that has `bpy` installed.
"""
import math
import os
import random

import bpy
import bmesh
from mathutils import Vector, noise

ASSETS = os.environ.get('ASSETS', '')


# ----------------------------------------------------------------- scene / render
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.images):
        for b in list(coll):
            coll.remove(b)


def setup_render(res=1200, samples=48, out_quality=90, transparent=False):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    c = sc.cycles
    c.device = 'CPU'
    c.samples = samples
    c.use_adaptive_sampling = True
    c.adaptive_threshold = 0.02
    c.use_denoising = True
    c.denoiser = 'OPENIMAGEDENOISE'
    c.max_bounces = 8
    c.diffuse_bounces = 3
    c.glossy_bounces = 5
    c.transmission_bounces = 6
    c.caustics_reflective = False
    c.caustics_refractive = False
    c.sample_clamp_indirect = 4.0
    sc.render.threads_mode = 'FIXED'
    sc.render.threads = os.cpu_count() or 4
    sc.render.resolution_x = res
    sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = 'JPEG'
    sc.render.image_settings.quality = out_quality
    sc.render.film_transparent = bool(transparent)
    if transparent:
        sc.render.image_settings.file_format = 'PNG'
        sc.render.image_settings.color_mode = 'RGBA'
    for name in ('Khronos PBR Neutral', 'AgX', 'Standard'):
        try:
            sc.view_settings.view_transform = name
            break
        except TypeError:
            continue
    try:
        sc.view_settings.look = 'None'
    except TypeError:
        pass
    sc.view_settings.exposure = 0.0
    return sc


def set_world(color=(0.9, 0.9, 0.92), strength=0.6):
    w = bpy.data.worlds.new('W')
    bpy.context.scene.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (*color, 1)
    bg.inputs['Strength'].default_value = strength


# ----------------------------------------------------------------- materials
def _mat(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    return m


def _set(bsdf, key, val):
    for k in (key,) if isinstance(key, str) else key:
        if k in bsdf.inputs:
            bsdf.inputs[k].default_value = val
            return True
    return False


def principled(name, color=(0.8, 0.8, 0.8), rough=0.5, metal=0.0, **kw):
    m = _mat(name)
    b = m.node_tree.nodes['Principled BSDF']
    _set(b, 'Base Color', (*color, 1))
    _set(b, 'Roughness', rough)
    _set(b, 'Metallic', metal)
    for k, v in kw.items():
        _set(b, k.replace('_', ' '), v)
    return m


def load_img(name, colorspace='sRGB'):
    p = os.path.join(ASSETS, name)
    im = bpy.data.images.load(p, check_existing=True)
    im.colorspace_settings.name = colorspace
    return im


def textured(name, img, rough=0.45, metal=0.0, bump=0.0, scale=(1, 1), offset=(0, 0), tint=None, clearcoat=0.0, spec=0.5, alpha=False,
             emission=0.0):
    """Printed-surface material from an image on UV 0..1."""
    m = _mat(name)
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = load_img(img) if isinstance(img, str) else img
    tex.extension = 'CLIP' if alpha else 'EXTEND'
    mp = nt.nodes.new('ShaderNodeMapping')
    mp.inputs['Scale'].default_value = (scale[0], scale[1], 1)
    mp.inputs['Location'].default_value = (offset[0], offset[1], 0)
    uv = nt.nodes.new('ShaderNodeTexCoord')
    nt.links.new(uv.outputs['UV'], mp.inputs['Vector'])
    nt.links.new(mp.outputs['Vector'], tex.inputs['Vector'])
    nt.links.new(tex.outputs['Color'], b.inputs['Base Color'])
    _set(b, 'Roughness', rough)
    _set(b, 'Metallic', metal)
    _set(b, ('Specular IOR Level', 'Specular'), spec)
    if clearcoat:
        _set(b, ('Coat Weight', 'Clearcoat'), clearcoat)
        _set(b, ('Coat Roughness', 'Clearcoat Roughness'), 0.05)
    if emission:
        nt.links.new(tex.outputs['Color'], b.inputs['Emission Color'])
        _set(b, 'Emission Strength', emission)
    if alpha:
        nt.links.new(tex.outputs['Alpha'], b.inputs['Alpha'])
        m.blend_method = 'BLEND' if hasattr(m, 'blend_method') else None
    if bump:
        n = nt.nodes.new('ShaderNodeTexNoise')
        n.inputs['Scale'].default_value = 900
        n.inputs['Detail'].default_value = 6
        bm = nt.nodes.new('ShaderNodeBump')
        bm.inputs['Strength'].default_value = bump
        nt.links.new(n.outputs['Fac'], bm.inputs['Height'])
        nt.links.new(bm.outputs['Normal'], b.inputs['Normal'])
    return m


def ceramic(color=(0.93, 0.93, 0.91), rough=0.06):
    return principled('ceramic', color, rough, **{'Coat_Weight': 0.35, 'Specular_IOR_Level': 0.6})


def plastic(color, rough=0.28):
    return principled('plastic', color, rough, **{'Coat_Weight': 0.2})


def metal(color=(0.8, 0.8, 0.82), rough=0.22):
    return principled('metal', color, rough, 1.0)


def rubber(color=(0.04, 0.04, 0.045), rough=0.75):
    return principled('rubber', color, rough)


def fabric(color, rough=0.95, bump=0.35, name='fabric', weave=2200):
    m = _mat(name)
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    _set(b, 'Base Color', (*color, 1))
    _set(b, 'Roughness', rough)
    _set(b, 'Sheen Weight', 0.55)
    _set(b, 'Sheen Roughness', 0.45)
    _set(b, ('Specular IOR Level', 'Specular'), 0.2)
    # woven look: crossed sine-ish pattern + fibre noise as bump
    tc = nt.nodes.new('ShaderNodeTexCoord')
    n1 = nt.nodes.new('ShaderNodeTexNoise')
    n1.inputs['Scale'].default_value = weave * 0.05
    n1.inputs['Detail'].default_value = 8
    n1.inputs['Roughness'].default_value = 0.7
    br = nt.nodes.new('ShaderNodeTexBrick')
    br.inputs['Scale'].default_value = weave * 0.012
    br.inputs['Mortar Size'].default_value = 0.04
    br.inputs['Brick Width'].default_value = 0.5
    br.inputs['Row Height'].default_value = 0.25
    mix = nt.nodes.new('ShaderNodeMath')
    mix.operation = 'ADD'
    nt.links.new(tc.outputs['Object'], n1.inputs['Vector'])
    nt.links.new(tc.outputs['Object'], br.inputs['Vector'])
    nt.links.new(n1.outputs['Fac'], mix.inputs[0])
    nt.links.new(br.outputs['Fac'], mix.inputs[1])
    bm = nt.nodes.new('ShaderNodeBump')
    bm.inputs['Strength'].default_value = bump
    bm.inputs['Distance'].default_value = 0.002
    nt.links.new(mix.outputs['Value'], bm.inputs['Height'])
    nt.links.new(bm.outputs['Normal'], b.inputs['Normal'])
    return m


def paper(color=(0.97, 0.97, 0.95), rough=0.62, bump=0.12):
    m = _mat('paper')
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    _set(b, 'Base Color', (*color, 1))
    _set(b, 'Roughness', rough)
    _set(b, ('Specular IOR Level', 'Specular'), 0.3)
    n = nt.nodes.new('ShaderNodeTexNoise')
    n.inputs['Scale'].default_value = 2500
    n.inputs['Detail'].default_value = 5
    bm = nt.nodes.new('ShaderNodeBump')
    bm.inputs['Strength'].default_value = bump
    bm.inputs['Distance'].default_value = 0.0004
    nt.links.new(n.outputs['Fac'], bm.inputs['Height'])
    nt.links.new(bm.outputs['Normal'], b.inputs['Normal'])
    return m


def wood(color_a=(0.36, 0.2, 0.1), color_b=(0.55, 0.34, 0.18), rough=0.45, scale=6):
    m = _mat('wood')
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    tc = nt.nodes.new('ShaderNodeTexCoord')
    mp = nt.nodes.new('ShaderNodeMapping')
    mp.inputs['Scale'].default_value = (scale, scale * 0.08, scale)
    wv = nt.nodes.new('ShaderNodeTexWave')
    wv.wave_type = 'BANDS'
    wv.inputs['Scale'].default_value = 3
    wv.inputs['Distortion'].default_value = 7
    wv.inputs['Detail'].default_value = 3
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].color = (*color_a, 1)
    ramp.color_ramp.elements[1].color = (*color_b, 1)
    nt.links.new(tc.outputs['Object'], mp.inputs['Vector'])
    nt.links.new(mp.outputs['Vector'], wv.inputs['Vector'])
    nt.links.new(wv.outputs['Fac'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], b.inputs['Base Color'])
    _set(b, 'Roughness', rough)
    bm = nt.nodes.new('ShaderNodeBump')
    bm.inputs['Strength'].default_value = 0.08
    nt.links.new(wv.outputs['Fac'], bm.inputs['Height'])
    nt.links.new(bm.outputs['Normal'], b.inputs['Normal'])
    return m


def marble():
    m = _mat('marble')
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    tc = nt.nodes.new('ShaderNodeTexCoord')
    n = nt.nodes.new('ShaderNodeTexNoise')
    n.inputs['Scale'].default_value = 3.2
    n.inputs['Detail'].default_value = 12
    n.inputs['Distortion'].default_value = 1.5
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].color = (0.9, 0.9, 0.9, 1)
    ramp.color_ramp.elements[1].color = (0.99, 0.99, 0.99, 1)
    nt.links.new(tc.outputs['Object'], n.inputs['Vector'])
    nt.links.new(n.outputs['Fac'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], b.inputs['Base Color'])
    _set(b, 'Roughness', 0.18)
    return m


def masked_mix(base, top, mask_img, name='masked'):
    """Material that shows `top` where mask image is white, else `base`."""
    m = _mat(name)
    nt = m.node_tree
    nt.nodes.remove(nt.nodes['Principled BSDF'])
    out = nt.nodes['Material Output']
    mix = nt.nodes.new('ShaderNodeMixShader')
    g1 = nt.nodes.new('ShaderNodeGroup')  # placeholder replaced below
    nt.nodes.remove(g1)
    # re-create both shaders by copying node trees is awkward; use principled copies instead
    return m


# ----------------------------------------------------------------- geometry helpers
def to_obj(mesh, name, mat=None, smooth=True, loc=(0, 0, 0), rot=(0, 0, 0)):
    ob = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(ob)
    ob.location = loc
    ob.rotation_euler = rot
    if mat:
        ob.data.materials.append(mat)
    if smooth:
        for p in ob.data.polygons:
            p.use_smooth = True
    return ob


def lathe(profile, name='lathe', mat=None, seg=128, close=True, uv_h=None, loc=(0, 0, 0), rot=(0, 0, 0), mats=None, split=None):
    """profile: list of (radius, z) points. Surface of revolution around Z."""
    me = bpy.data.meshes.new(name)
    verts, faces = [], []
    n = len(profile)
    for ang_i in range(seg):
        a = 2 * math.pi * ang_i / seg
        for (r, z) in profile:
            verts.append((r * math.cos(a), r * math.sin(a), z))
    for ai in range(seg):
        aj = (ai + 1) % seg
        for pi in range(n - 1):
            faces.append((ai * n + pi, aj * n + pi, aj * n + pi + 1, ai * n + pi + 1))
    me.from_pydata(verts, [], faces)
    me.update()
    uv = me.uv_layers.new(name='UV')
    zs = [p[1] for p in profile]
    zmin, zmax = min(zs), max(zs)
    for poly in me.polygons:
        for li in poly.loop_indices:
            vi = me.loops[li].vertex_index
            a_i, p_i = divmod(vi, n)
            u = a_i / seg
            v = (profile[p_i][1] - zmin) / max(1e-6, zmax - zmin)
            uv.data[li].uv = (u, v)
    ob = to_obj(me, name, mat, True, loc, rot)
    if mats:
        ob.data.materials.clear()
        for m_ in mats:
            ob.data.materials.append(m_)
        for k, poly in enumerate(ob.data.polygons):
            pi = k % (n - 1)
            poly.material_index = 1 if (split is not None and pi < split) else 0
    return ob


def box(w, d, h, r=0.0, name='box', mat=None, loc=(0, 0, 0), rot=(0, 0, 0), seg=4):
    """Rounded box centred on origin in XY, sitting with its base at z=0."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(w, d, h), verts=bm.verts)
    bmesh.ops.translate(bm, vec=(0, 0, h / 2), verts=bm.verts)
    if r > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=r, segments=seg, profile=0.5, affect='EDGES')
    # simple box UVs
    uvl = bm.loops.layers.uv.new('UV')
    for f in bm.faces:
        for l in f.loops:
            co = l.vert.co
            n = f.normal
            if abs(n.z) > 0.5:
                l[uvl].uv = (co.x / w + 0.5, co.y / d + 0.5)
            elif abs(n.x) > 0.5:
                l[uvl].uv = (co.y / d + 0.5, co.z / h)
            else:
                l[uvl].uv = (co.x / w + 0.5, co.z / h)
    bm.to_mesh(me)
    bm.free()
    return to_obj(me, name, mat, True, loc, rot)


def grid_plane(w, d, nx=2, ny=2, name='plane', mat=None, z=0.0, loc=(0, 0, 0), rot=(0, 0, 0), fn=None, uv_scale=(1, 1), uv_off=(0, 0),
               flip_v=False):
    """Centred grid with UVs 0..1; optional fn(x,y)->z displacement (used for cloth/decals)."""
    me = bpy.data.meshes.new(name)
    verts, faces, uvs = [], [], []
    for j in range(ny + 1):
        for i in range(nx + 1):
            x = (i / nx - 0.5) * w
            y = (j / ny - 0.5) * d
            verts.append((x, y, z + (fn(x, y) if fn else 0.0)))
    for j in range(ny):
        for i in range(nx):
            a = j * (nx + 1) + i
            faces.append((a, a + 1, a + nx + 2, a + nx + 1))
    me.from_pydata(verts, [], faces)
    uv = me.uv_layers.new(name='UV')
    for poly in me.polygons:
        for li in poly.loop_indices:
            vi = me.loops[li].vertex_index
            j, i = divmod(vi, nx + 1)
            u = i / nx
            v = j / ny
            if flip_v:
                v = 1 - v
            uv.data[li].uv = (u * uv_scale[0] + uv_off[0], v * uv_scale[1] + uv_off[1])
    me.update()
    return to_obj(me, name, mat, True, loc, rot)


def tube(points, radius, name='tube', mat=None, res=12, bevel_res=8, closed=False, loc=(0, 0, 0), rot=(0, 0, 0)):
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = radius
    cu.bevel_resolution = bevel_res
    cu.resolution_u = res
    cu.use_fill_caps = True
    sp = cu.splines.new('BEZIER')
    sp.bezier_points.add(len(points) - 1)
    for p, bp in zip(points, sp.bezier_points):
        bp.co = Vector(p)
        bp.handle_left_type = bp.handle_right_type = 'AUTO'
    sp.use_cyclic_u = closed
    ob = bpy.data.objects.new(name, cu)
    bpy.context.collection.objects.link(ob)
    ob.location = loc
    ob.rotation_euler = rot
    if mat:
        cu.materials.append(mat)
    return ob


def sub(ob, levels=2):
    m = ob.modifiers.new('sub', 'SUBSURF')
    m.levels = levels
    m.render_levels = levels
    return ob


def solid(ob, t=0.002, offset=0):
    m = ob.modifiers.new('solid', 'SOLIDIFY')
    m.thickness = t
    m.offset = offset
    return ob


def parent_to(ob, parent):
    ob.parent = parent
    return ob


def group(name='group'):
    e = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(e)
    return e


# ----------------------------------------------------------------- studio
def backdrop(color=(0.93, 0.93, 0.94), rough=0.85, width=14.0, curve_r=1.3, wall_h=5.0, depth=6.0, mat=None):
    """Seamless cyclorama sweep: floor (z=0) curving up into a back wall at y=+depth."""
    me = bpy.data.meshes.new('cyc')
    prof = [(-depth + 3.0, 0.0), (0.0, 0.0)]
    cy = 0.0
    steps = 24
    for i in range(1, steps + 1):
        a = (math.pi / 2) * i / steps
        prof.append((curve_r * math.sin(a), curve_r * (1 - math.cos(a))))
    prof.append((curve_r, wall_h))
    verts, faces = [], []
    for (y, z) in prof:
        verts.append((-width / 2, y, z))
        verts.append((width / 2, y, z))
    for i in range(len(prof) - 1):
        a = i * 2
        faces.append((a, a + 1, a + 3, a + 2))
    me.from_pydata(verts, [], faces)
    me.update()
    m = mat or principled('backdrop', color, rough)
    return to_obj(me, 'cyc', m, True)


def tabletop(mat, size=(8, 6), thick=0.04, z=0.0):
    ob = box(size[0], size[1], thick, 0.003, 'table', mat, loc=(0, 0, z - thick))
    return ob


def area_light(name, loc, target, size, power, color=(1, 1, 1), shape='RECTANGLE', size_y=None, spread=None):
    ld = bpy.data.lights.new(name, 'AREA')
    ld.shape = shape
    ld.size = size
    if shape == 'RECTANGLE':
        ld.size_y = size_y or size
    ld.energy = power
    ld.color = color
    if spread is not None and hasattr(ld, 'spread'):
        ld.spread = math.radians(spread)
    ob = bpy.data.objects.new(name, ld)
    bpy.context.collection.objects.link(ob)
    ob.location = loc
    d = Vector(target) - Vector(loc)
    ob.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    return ob


def studio_lights(target=(0, 0, 0.05), scale=1.0, warm=0.0, key_power=170, mood='soft'):
    """Three-point softbox rig tuned for product photography."""
    t = Vector(target)
    k = scale
    warm_c = (1.0, 0.96 - warm * 0.05, 0.9 - warm * 0.12)
    area_light('key', (t.x - 1.7 * k, t.y - 1.4 * k, t.z + 1.9 * k), t, 1.6 * k, key_power * k * k, warm_c, size_y=1.2 * k)
    area_light('fill', (t.x + 2.0 * k, t.y - 1.0 * k, t.z + 0.9 * k), t, 2.0 * k, key_power * 0.28 * k * k, (0.92, 0.95, 1.0), size_y=1.4 * k)
    area_light('top', (t.x, t.y - 0.2 * k, t.z + 2.6 * k), t, 2.2 * k, key_power * 0.42 * k * k, (1, 1, 1), size_y=1.6 * k)
    area_light('rim', (t.x + 0.6 * k, t.y + 2.1 * k, t.z + 1.4 * k), t, 1.4 * k, key_power * 0.55 * k * k, (1, 1, 1), size_y=0.5 * k)


def camera(loc, target, lens=85, fstop=11.0, shift=(0, 0), focus=None, sensor=36):
    cd = bpy.data.cameras.new('cam')
    cd.lens = lens
    cd.sensor_width = sensor
    cd.dof.use_dof = True
    cd.dof.aperture_fstop = fstop
    cd.shift_x, cd.shift_y = shift
    ob = bpy.data.objects.new('cam', cd)
    bpy.context.collection.objects.link(ob)
    ob.location = loc
    d = Vector(target) - Vector(loc)
    ob.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    cd.dof.focus_distance = (Vector(focus) - Vector(loc)).length if focus else d.length
    bpy.context.scene.camera = ob
    return ob


def render(path):
    sc = bpy.context.scene
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)


def cloth_fn(seed=0, amp=0.006, freq=9.0, crease=None):
    """Low-frequency wrinkle field for cloth lying on a table."""
    off = Vector((seed * 7.3, seed * 3.1, seed * 1.7))

    def f(x, y):
        v = noise.fractal(Vector((x * freq, y * freq, 0.0)) + off, 0.55, 2.0, 3)
        v2 = noise.noise(Vector((x * freq * 0.35, y * freq * 0.35, 1.0)) + off)
        z = amp * (v * 0.9 + v2 * 0.6)
        if crease is not None:
            z += crease(x, y)
        return z

    return f


def shadow_catcher(size=8.0, z=0.0):
    me = bpy.data.meshes.new('catcher')
    h = size / 2
    me.from_pydata([(-h, -h, z), (h, -h, z), (h, h, z), (-h, h, z)], [], [(0, 1, 2, 3)])
    ob = bpy.data.objects.new('catcher', me)
    bpy.context.collection.objects.link(ob)
    ob.is_shadow_catcher = True
    return ob


def white_composite(png, jpg, bg=(255, 255, 255), quality=93):
    from PIL import Image
    im = Image.open(png).convert('RGBA')
    base = Image.new('RGBA', im.size, bg + (255,))
    base.alpha_composite(im)
    base.convert('RGB').save(jpg, quality=quality, subsampling=0)
