import bpy,bmesh,math,time,os
from mathutils import Vector
OUT='/home/user/dhairya33333/shop-screen-ad/real/plates/'
def setup(samples=28,res=(1920,1080),world=(0.004,0.012,0.04),ws=1.0):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc=bpy.context.scene;sc.render.engine='CYCLES';sc.cycles.device='CPU';sc.cycles.samples=samples;sc.cycles.use_denoising=True
    try:sc.cycles.denoiser='OPENIMAGEDENOISE'
    except Exception:pass
    sc.render.resolution_x,sc.render.resolution_y=res;sc.render.resolution_percentage=100;sc.render.film_transparent=False
    sc.render.image_settings.file_format='PNG'
    ids=[x.identifier for x in bpy.types.ColorManagedViewSettings.bl_rna.properties['view_transform'].enum_items]
    sc.view_settings.view_transform='Filmic' if 'Filmic' in ids else 'AgX';sc.view_settings.look='None'
    w=bpy.data.worlds.new('w');sc.world=w;w.use_nodes=True;b=w.node_tree.nodes['Background'];b.inputs[0].default_value=(*world,1);b.inputs[1].default_value=ws
    return sc
def mat(name,col,rough=.3,metal=0,coat=0,emit=None,es=0,trans=0,alpha=1):
    m=bpy.data.materials.new(name);m.use_nodes=True;b=m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value=(*col,1);b.inputs['Roughness'].default_value=rough;b.inputs['Metallic'].default_value=metal
    for k in ('Coat Weight','Clearcoat'):
        if k in b.inputs:b.inputs[k].default_value=coat;break
    if emit:
        for k in ('Emission Color','Emission'):
            if k in b.inputs:b.inputs[k].default_value=(*emit,1);break
        if 'Emission Strength' in b.inputs:b.inputs['Emission Strength'].default_value=es
    if trans:
        for k in ('Transmission Weight','Transmission'):
            if k in b.inputs:b.inputs[k].default_value=trans;break
    return m
def link(ob):bpy.context.scene.collection.objects.link(ob);return ob
def box(name,sx,sy,sz,loc,m=None,rot=(0,0,0),bevel=0.0):
    me=bpy.data.meshes.new(name);ob=bpy.data.objects.new(name,me);link(ob)
    bm=bmesh.new();bmesh.ops.create_cube(bm,size=1.0);bm.to_mesh(me);bm.free()
    ob.scale=(sx,sy,sz);ob.location=loc;ob.rotation_euler=rot
    if bevel>0:
        bpy.context.view_layer.objects.active=ob;md=ob.modifiers.new('b','BEVEL');md.width=bevel;md.segments=3
    if m:ob.data.materials.append(m)
    return ob
def cyl(name,r,h,loc,m=None,rot=(0,0,0),seg=48):
    me=bpy.data.meshes.new(name);ob=bpy.data.objects.new(name,me);link(ob)
    bm=bmesh.new();bmesh.ops.create_cone(bm,cap_ends=True,segments=seg,radius1=r,radius2=r,depth=h);bm.to_mesh(me);bm.free()
    ob.location=loc;ob.rotation_euler=rot
    for p in me.polygons:p.use_smooth=True
    if m:ob.data.materials.append(m)
    return ob
def plane(name,w,d,loc,m,rot=(0,0,0)):
    me=bpy.data.meshes.new(name);ob=bpy.data.objects.new(name,me);link(ob)
    bm=bmesh.new();bmesh.ops.create_grid(bm,x_segments=1,y_segments=1,size=1);bm.to_mesh(me);bm.free();ob.scale=(w/2,d/2,1);ob.location=loc;ob.rotation_euler=rot;ob.data.materials.append(m);return ob
def light(name,kind,loc,energy,col,size=1.0,target=None,sy=None):
    l=bpy.data.lights.new(name,kind);l.energy=energy;l.color=col
    if kind=='AREA':l.size=size;l.size_y=sy or size
    elif kind in('POINT','SPOT'):l.shadow_soft_size=size
    o=link(bpy.data.objects.new(name,l));o.location=loc
    if kind=='AREA':o.visible_glossy=False;o.visible_camera=False
    if target:o.rotation_euler=(Vector(target)-Vector(loc)).to_track_quat('-Z','Y').to_euler()
    return o
def camera(loc,target,lens=50,fstop=4.0,focus=None):
    c=bpy.data.cameras.new('c');c.lens=lens;c.dof.use_dof=True;c.dof.aperture_fstop=fstop
    o=link(bpy.data.objects.new('cam',c));o.location=loc;t=Vector(target);d=t-Vector(loc);o.rotation_euler=d.to_track_quat('-Z','Y').to_euler();c.dof.focus_distance=focus or d.length;bpy.context.scene.camera=o;return o
def fabric(name,col,rough=.9):
    m=bpy.data.materials.new(name);m.use_nodes=True;nt=m.node_tree;b=nt.nodes['Principled BSDF'];b.inputs['Base Color'].default_value=(*col,1);b.inputs['Roughness'].default_value=rough
    for k in ('Sheen Weight',):
        if k in b.inputs:b.inputs[k].default_value=.6
    n1=nt.nodes.new('ShaderNodeTexNoise');n1.inputs['Scale'].default_value=420;n1.inputs['Detail'].default_value=3
    n2=nt.nodes.new('ShaderNodeTexNoise');n2.inputs['Scale'].default_value=18;n2.inputs['Detail'].default_value=6
    mx=nt.nodes.new('ShaderNodeMath');mx.operation='ADD';nt.links.new(n1.outputs['Fac'],mx.inputs[0]);nt.links.new(n2.outputs['Fac'],mx.inputs[1])
    bp=nt.nodes.new('ShaderNodeBump');bp.inputs['Strength'].default_value=.25;nt.links.new(mx.outputs[0],bp.inputs['Height']);nt.links.new(bp.outputs['Normal'],b.inputs['Normal']);return m
def studio(floor_col=(0.02,0.05,0.12),floor_rough=.18,size=80):
    plane('floor',size,size,(0,0,0),mat('floor',floor_col,floor_rough,0,.3))
    light('rim','AREA',(-2.0,1.8,1.8),260,(0.25,0.45,1.0),1.5,(0,0,.3))
    light('fill','AREA',(2.2,-2.6,2.2),45,(0.7,0.8,1.0),2.0,(0,0,.3))
    light('warm','POINT',(-0.9,-1.4,1.1),25,(1.0,0.8,0.5),0.3)
def render(path):
    bpy.context.scene.render.filepath=path;t=time.time();bpy.ops.render.render(write_still=True);print('rendered',os.path.basename(path),round(time.time()-t,1),'s',flush=True)
