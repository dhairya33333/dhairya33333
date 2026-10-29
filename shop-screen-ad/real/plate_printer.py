from rlib import *
import sys
N=int(sys.argv[1]) if len(sys.argv)>1 else 32
sc=setup(18,res=(1600,900));studio()
light('key','AREA',(0.6,-1.3,1.5),170,(1,.97,.92),1.2,(0,0,.25));light('top','AREA',(0,-0.2,1.6),50,(.85,.9,1),1.5,(0,0,.25))
gold=mat('gold',(1.0,0.62,0.12),.32,0,.2);alu=mat('alu',(.75,.77,.8),.28,1);dark=mat('dark',(.025,.027,.032),.4);bedm=mat('bed',(.02,.02,.022),.28,.2,.5);fil=mat('fil',(1.0,.5,.08),.45,0,0,(1.0,.4,.05),.6)
box('base',.62,.55,.05,(0,0,.025),dark,bevel=.01)
box('bed',.34,.34,.014,(0,0,.057),bedm,bevel=.003)
for sx in(-.27,.27):cyl('post',.016,.52,(sx,.0,.30),alu,seg=32)
box('topbar',.60,.05,.035,(0,0,.57),dark,bevel=.008)
for sx in(-.27,.27):box('cap',.05,.07,.04,(sx,0,.57),dark,bevel=.008)
gan=box('gantry',.56,.034,.034,(0,0,.2),alu,bevel=.006)
car=box('carriage',.085,.07,.07,(0,0,.2),mat('carm',(.35,.36,.4),.35,.6),bevel=.01)
noz=cyl('nozzle',.011,.03,(0,0,.17),mat('brass',(.9,.6,.2),.25,1),seg=24)
nt=bpy.data.objects.new('tip',bpy.data.meshes.new('tip'));link(nt)
bm=bmesh.new();bmesh.ops.create_cone(bm,cap_ends=True,segments=24,radius1=.0055,radius2=.0016,depth=.014);bm.to_mesh(nt.data);bm.free();nt.data.materials.append(mat('brass2',(.9,.6,.2),.25,1))
spool=cyl('spool',.085,.07,(.23,.19,.42),fil,rot=(math.pi/2,0,0));cyl('hub',.04,.075,(.23,.19,.42),dark,rot=(math.pi/2,0,0));cyl('rimL',.09,.006,(.23,.153,.42),dark,rot=(math.pi/2,0,0));cyl('rimR',.09,.006,(.23,.227,.42),dark,rot=(math.pi/2,0,0))
# glass-like panels (cheap): dark translucent back panel

# figurine layers
L=24;th=.006;layers=[]
for i in range(L):
    k=i/(L-1);sc_=1.0-.62*k;rot=math.radians(i*4.2)
    pts=[]
    for j in range(8):
        a=rot+j*math.pi/4;r=(.07 if j%2==0 else .026)*sc_;pts.append((r*math.cos(a),r*math.sin(a)))
    me=bpy.data.meshes.new('l%d'%i);ob=bpy.data.objects.new('l%d'%i,me);link(ob)
    bm=bmesh.new();vs=[bm.verts.new((x,y,0)) for x,y in pts];f=bm.faces.new(vs);r=bmesh.ops.extrude_face_region(bm,geom=[f]);ve=[e for e in r['geom'] if isinstance(e,bmesh.types.BMVert)];bmesh.ops.translate(bm,vec=(0,0,th*.96),verts=ve);bm.normal_update();bm.to_mesh(me);bm.free()
    ob.location=(0,0,.064+i*th);ob.data.materials.append(gold)
    for p in me.polygons:p.use_smooth=False
    layers.append(ob)
camera((1.1,-1.95,.78),(0,0,.27),55,4.0,2.3)
import json
from bpy_extras.object_utils import world_to_camera_view
COORDS=[]
for f in range(N):
    vis=min(L,f+1);top=.064+vis*th
    for i,ob in enumerate(layers):ob.hide_render=i>=vis
    g=top+.045 if f<L else top+.12+.04*min(1,(f-L)/4.0)
    gan.location.z=g;car.location=(.06*math.sin(f*1.9) if f<L else .24,0,g);noz.location=(car.location.x,0,g-.045);nt.location=(car.location.x,0,g-.067)
    if f>=L:
        for ob in layers:ob.rotation_euler.z=math.radians((f-L+1)*36)
    spool.rotation_euler.y=f*.2
    bpy.context.view_layer.update()
    uv=world_to_camera_view(sc,sc.camera,nt.matrix_world.translation);COORDS.append([round(uv.x*1920,1),round((1-uv.y)*1080,1)])
    if not (len(sys.argv)>2 and sys.argv[2]=='coords'):render(OUT+'printer_%02d.png'%f)
json.dump(COORDS,open(OUT+'printer_tip.json','w'))
