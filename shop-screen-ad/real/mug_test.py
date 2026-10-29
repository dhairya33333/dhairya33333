import bpy,bmesh,math,sys,time
from mathutils import Vector
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
reset()
sc=bpy.context.scene
sc.render.engine='CYCLES';sc.cycles.device='CPU';sc.cycles.samples=48;sc.cycles.use_denoising=True
try: sc.cycles.denoiser='OPENIMAGEDENOISE'
except Exception as e: print('denoiser',e)
sc.render.resolution_x=1920;sc.render.resolution_y=1080;sc.render.film_transparent=False
sc.render.image_settings.file_format='PNG'
sc.view_settings.view_transform='Filmic' if 'Filmic' in [x.identifier for x in bpy.types.ColorManagedViewSettings.bl_rna.properties['view_transform'].enum_items] else 'AgX'
sc.view_settings.look='None'
# world
w=bpy.data.worlds.new('w');sc.world=w;w.use_nodes=True
bg=w.node_tree.nodes['Background'];bg.inputs[0].default_value=(0.004,0.012,0.04,1);bg.inputs[1].default_value=1.0
def mat(name,col,rough=.2,metal=0,coat=0,emit=None,emit_s=0):
    m=bpy.data.materials.new(name);m.use_nodes=True;b=m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value=(*col,1);b.inputs['Roughness'].default_value=rough;b.inputs['Metallic'].default_value=metal
    for k in ('Coat Weight','Clearcoat'):
        if k in b.inputs:b.inputs[k].default_value=coat;break
    if emit:
        for k in ('Emission Color','Emission'):
            if k in b.inputs:b.inputs[k].default_value=(*emit,1);break
        if 'Emission Strength' in b.inputs:b.inputs['Emission Strength'].default_value=emit_s
    return m
# mug via revolve
prof=[(0.0,0.0),(0.36,0.0),(0.40,0.02),(0.42,0.08),(0.42,0.78),(0.43,0.80),(0.41,0.80),(0.39,0.78),(0.39,0.10),(0.0,0.10)]
me=bpy.data.meshes.new('mug');ob=bpy.data.objects.new('mug',me);sc.collection.objects.link(ob)
bm=bmesh.new();vs=[bm.verts.new((r,0,z)) for r,z in prof]
for i in range(len(vs)-1):bm.edges.new((vs[i],vs[i+1]))
bmesh.ops.spin(bm,geom=bm.verts[:]+bm.edges[:],cent=(0,0,0),axis=(0,0,1),angle=math.pi*2,steps=96)
bmesh.ops.remove_doubles(bm,verts=bm.verts,dist=1e-4)
bm.to_mesh(me);bm.free()
for p in me.polygons:p.use_smooth=True
ob.data.materials.append(mat('ceramic',(0.93,0.93,0.92),.12,0,.8))
# handle
cu=bpy.data.curves.new('h','CURVE');cu.dimensions='3D';cu.bevel_depth=0.045;cu.bevel_resolution=8
sp=cu.splines.new('BEZIER');sp.bezier_points.add(3)
pts=[(0.41,0,0.68),(0.62,0,0.70),(0.64,0,0.30),(0.40,0,0.22)]
for bp,(x,y,z) in zip(sp.bezier_points,pts):bp.co=(x,y,z);bp.handle_left_type=bp.handle_right_type='AUTO'
ho=bpy.data.objects.new('handle',cu);sc.collection.objects.link(ho);ho.data.materials.append(ob.data.materials[0])
# floor
fl=bpy.data.meshes.new('f');fo=bpy.data.objects.new('floor',fl);sc.collection.objects.link(fo)
bm=bmesh.new();bmesh.ops.create_grid(bm,x_segments=1,y_segments=1,size=12);bm.to_mesh(fl);bm.free()
fo.data.materials.append(mat('floor',(0.02,0.05,0.12),.18,.0,.3))
# camera
cam=bpy.data.cameras.new('c');cam.lens=70;cam.dof.use_dof=True;cam.dof.focus_distance=3.2;cam.dof.aperture_fstop=3.2
co=bpy.data.objects.new('cam',cam);sc.collection.objects.link(co);sc.camera=co
co.location=(0.9,-3.1,0.95);tgt=Vector((0.1,0,0.42));d=tgt-co.location;co.rotation_euler=d.to_track_quat('-Z','Y').to_euler()
# spark light
def light(name,kind,loc,energy,col,size=0.1):
    l=bpy.data.lights.new(name,kind);l.energy=energy;l.color=col
    if kind in('POINT','SPOT'):l.shadow_soft_size=size
    o=bpy.data.objects.new(name,l);o.location=loc;sc.collection.objects.link(o);return o
light('spark','POINT',(0.55,-0.55,0.75),90,(1.0,0.78,0.35),0.04)
light('rim','AREA',(-2.0,1.5,1.6),250,(0.25,0.45,1.0),1.5)
light('fill','AREA',(2.0,-2.5,2.0),40,(0.7,0.8,1.0),2.0)
sph=bpy.data.meshes.new('s');so=bpy.data.objects.new('core',sph);sc.collection.objects.link(so)
bm=bmesh.new();bmesh.ops.create_uvsphere(bm,u_segments=32,v_segments=16,radius=0.035);bm.to_mesh(sph);bm.free();so.location=(0.55,-0.55,0.75)
so.data.materials.append(mat('core',(1,.8,.4),.5,0,0,(1.0,0.75,0.3),60))
sc.render.filepath='/home/user/dhairya33333/shop-screen-ad/real/mug_test.png'
t=time.time();bpy.ops.render.render(write_still=True);print('render s',round(time.time()-t,1))
