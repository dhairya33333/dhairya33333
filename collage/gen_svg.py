import base64, io
from PIL import Image
W,H=4961,3508
tiles=[]  # (name,file,x,y,w,h,feather,grow,crop,align)
def T(name,f,x,y,w,h,feather=80,grow=100,crop=None,align='xMidYMin'):
    if grow: x-=grow;y-=grow;w+=2*grow;h+=2*grow
    tiles.append((name,f,x,y,w,h,feather,crop,align))
T('hero_standing_couple','5.45.40_PM.jpeg',1450,60,2025,2700,140,0)
T('hero_pink_saree_couple','5.45.44_PM_1.jpeg',2900,1500,1200,1800,140,0)
L=['5.45.43_PM.jpeg','5.45.42_PM_2.jpeg','5.45.41_PM_1.jpeg','5.45.42_PM.jpeg','5.43.20_PM.jpeg','5.45.42_PM_1.jpeg']
for i,p in enumerate(L):
    crop=(0,160,720,1440) if p.startswith('5.43.20') else None
    T('left_%d'%(i+1),p,[40,740][i%2],[40,1200,2360][i//2],690,1108,crop=crop)
T('bottom_centre','5.45.43_PM_1.jpeg',1480,2800,1400,670,align='xMidYMid')
T('topright_1','5.45.41_PM.jpeg',3500,40,720,640)
T('topright_2','5.45.44_PM_2.jpeg',4230,40,700,640)
T('topright_3','5.45.40_PM_1.jpeg',3500,700,720,780,align='xMidYMax')
T('topright_4','5.45.43_PM_2.jpeg',4230,700,700,780)
for i,p in enumerate(['5.45.45_PM_1.jpeg','5.45.44_PM.jpeg','5.45.45_PM.jpeg']):
    T('right_%d'%(i+1),p,4120,1500+i*670,820,660)
defs=[];body=[]
for n,f,x,y,w,h,fe,crop,al in tiles:
    im=Image.open('photos/'+f).convert('RGB')
    if crop: im=im.crop(crop)
    im.thumbnail((2000,2000)); b=io.BytesIO(); im.save(b,'JPEG',quality=88)
    uri='data:image/jpeg;base64,'+base64.b64encode(b.getvalue()).decode()
    defs.append(f'<filter id="bl_{n}" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="{fe*0.55:.0f}"/></filter>'
      f'<mask id="m_{n}" maskUnits="userSpaceOnUse" x="{x}" y="{y}" width="{w}" height="{h}"><rect x="{x+fe}" y="{y+fe}" width="{w-2*fe}" height="{h-2*fe}" rx="{fe//2}" fill="#fff" filter="url(#bl_{n})"/></mask>')
    body.append(f'<g id="{n}" mask="url(#m_{n})"><image x="{x}" y="{y}" width="{w}" height="{h}" preserveAspectRatio="{al} slice" href="{uri}"/></g>')
svg=f'''<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="420mm" height="297mm" viewBox="0 0 {W} {H}">
<!-- A3 landscape collage. Each photo is its own group (id = name): move/resize the <image>, change the mask rect to change its blended edge. -->
<defs><radialGradient id="bg" cx="50%" cy="50%" r="75%"><stop offset="0" stop-color="#3e3e48"/><stop offset="1" stop-color="#0e0e12"/></radialGradient>
{chr(10).join(defs)}</defs>
<rect id="background" width="{W}" height="{H}" fill="url(#bg)"/>
{chr(10).join(body)}
</svg>'''
open('collage_A3_editable.svg','w').write(svg)
print(len(svg)//1024,'KB')
