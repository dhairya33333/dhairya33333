from rlib import *
sc=setup(40,world=(0.003,0.008,0.03))
# street
plane('street',60,60,(0,-6,0),mat('street',(.015,.02,.035),.12,0,.4))
plane('pave',9,3.2,(0,-1.6,0.001),mat('pave',(.045,.05,.07),.2,0,.2))
wallm=mat('wall',(.045,.07,.13),.55);trim=mat('trim',(.02,.03,.06),.4,.4)
# facade with openings
W,H,D=7.0,3.8,.25
wall=box('wall',W,D,H,(0,0,H/2),wallm)
def cut(name,sx,sz,loc):
    c=box(name,sx,1.0,sz,loc,None);md=wall.modifiers.new(name,'BOOLEAN');md.operation='DIFFERENCE';md.object=c;md.solver='EXACT';c.hide_render=True;c.hide_viewport=True
cut('win',2.6,1.7,(-1.6,0,1.55));cut('door',1.15,2.25,(1.7,0,1.125))
bpy.context.view_layer.objects.active=wall
for md in list(wall.modifiers):bpy.ops.object.modifier_apply(modifier=md.name)
# interior shell
inter=mat('inter',(.55,.42,.3),.6);box('room_back',W-.3,.1,H,(0,3.8,H/2),inter);box('room_floor',W-.3,4,.05,(0,1.9,.025),mat('rf',(.35,.22,.12),.4,0,.3));box('room_ceil',W-.3,4,.05,(0,1.9,H-.05),inter);box('room_l',.1,4,H,(-W/2+.2,1.9,H/2),inter);box('room_r',.1,4,H,(W/2-.2,1.9,H/2),inter)
# shelves + products
shelf=mat('shelf',(.5,.32,.18),.45)
for z in(.8,1.45,2.1):box('shelf',3.2,.4,.05,(-1.6,3.5,z),shelf)
white=mat('white',(.9,.9,.88),.25,0,.6);navy=mat('navyp',(.03,.07,.2),.6);gold=mat('goldp',(1,.62,.12),.3);coral=mat('coral',(.75,.12,.08),.6);blue=mat('bluep',(.05,.12,.5),.5)
for i in range(7):cyl('mug',.07,.14,(-2.9+i*.42,3.5,.855+.07),white,seg=24)
for i in range(6):box('tee',.36,.4,.07,(-2.9+i*.5,3.5,1.5+.035),[navy,coral,blue,white,gold,navy][i],bevel=.01)
for i in range(5):
    for j in range(5):cyl('pr',.09*(1-j*.14),.035,(-2.6+i*.6,3.5,2.15+j*.035),gold,seg=6)
# door (hinged right edge x=2.275)
doorm=mat('doorm',(.03,.1,.45),.35,0,.4)
hinge=bpy.data.objects.new('hinge',None);link(hinge);hinge.location=(2.275,0,0)
door=box('door',1.12,.06,2.22,(-.56,0,1.115),doorm,bevel=.01);door.parent=hinge
gl=box('dglass',.6,.07,1.2,(-.56,0,1.3),mat('dg',(1,.8,.5),.3,0,0,(1,.75,.4),1.0),bevel=.005);gl.parent=hinge
box('handle',.04,.08,.28,(-1.0,-.05,1.05),mat('hd',(.8,.7,.4),.2,1),bevel=.01).parent=hinge
# frames/trim
box('wtrim_t',2.9,.3,.1,(-1.6,-.03,2.45),trim);box('wtrim_b',2.9,.3,.1,(-1.6,-.03,.68),trim)
# awning
for i in range(14):
    aw=box('aw',W/14,1.2,.04,(-W/2+W/28+i*W/14,-.55,2.85),mat('awm',(.96,.96,.98) if i%2 else (.1,.18,.8),.6),rot=(math.radians(-14),0,0))
# sign
sb=box('sign',4.2,.12,.62,(0,-.08,3.42),mat('signb',(.02,.04,.1),.3,.3))
txt=bpy.data.curves.new('t','FONT');txt.body='Devdha';txt.extrude=.015;txt.size=.46;txt.align_x='CENTER';txt.align_y='CENTER'
try:txt.font=bpy.data.fonts.load('/usr/share/fonts/opentype/inter/Inter-ExtraBold.otf')
except Exception as e:print('font',e)
to=link(bpy.data.objects.new('txt',txt));to.location=(0.3,-.17,3.42);to.rotation_euler=(math.pi/2,0,0);to.data.materials.append(mat('neon',(1,1,1),.3,0,0,(.85,.92,1),14))
# lights
light('sign_l','AREA',(0,-1.4,3.9),110,(.8,.9,1),2.0,(0,0,3.4))
light('in1','AREA',(-1.2,2.0,3.0),220,(1,.72,.42),2.2,(-1.2,3.5,1.2));light('in2','AREA',(1.2,2.0,3.0),180,(1,.72,.42),2.2,(1.2,3.5,1.2))
light('in3','AREA',(1.7,.8,2.6),160,(1,.74,.46),1.6,(1.7,-1,0.2))
light('street','AREA',(-5,-5,4),300,(.35,.5,1),3,(0,0,1.5));light('lamp','POINT',(3.5,-3,3.2),400,(1,.85,.6),.3)
camera((.4,-9.2,1.55),(0.2,0,1.75),38,5.6,9.2)
angs=[0,5,12,24,38,52,66,78]
for k,a in enumerate(angs):
    hinge.rotation_euler.z=math.radians(a);render(OUT+'shop_%02d.png'%k)
