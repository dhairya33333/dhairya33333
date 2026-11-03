from PIL import Image, ImageDraw, ImageFilter, ImageOps, ImageChops
import random
random.seed(3)
W,H=4961,3508; P='photos/'
# smoky grey/white background
bg=Image.new('L',(W//8,H//8))
px=bg.load()
rnd=random.Random(5)
bgs=Image.effect_noise((W//16,H//16),90).resize((W,H),Image.BICUBIC).filter(ImageFilter.GaussianBlur(60))
base=Image.new('RGB',(W,H),(14,14,18)); light=Image.new('RGB',(W,H),(62,62,72))
canvas=Image.composite(light,base,bgs.point(lambda v:max(0,min(255,(v-70)*3)))).convert('RGBA')
def load(path,crop=None):
    im=Image.open(P+path).convert('RGB')
    return im.crop(crop) if crop else im
def fill(im,w,h,bx=0.5,by=0.25):
    s=max(w/im.width,h/im.height); im=im.resize((round(im.width*s)+1,round(im.height*s)+1),Image.LANCZOS)
    x=int((im.width-w)*bx); y=int((im.height-h)*by); return im.crop((x,y,x+w,y+h))
def shadow(c,x,y):
    sh=Image.new('RGBA',(c.width+200,c.height+200),(0,0,0,0)); sh.paste((0,0,0,255),(100,100),c.getchannel('A').point(lambda v:int(v*.45)))
    sh=sh.filter(ImageFilter.GaussianBlur(26)); canvas.paste(sh,(x-100+8,y-100+16),sh)
def tile(path,x,y,w,h,r=46,feather=80,crop=None,by=0.25,bx=.5,grow=100):
    if feather<=80 and grow: x-=grow;y-=grow;w+=2*grow;h+=2*grow
    im=fill(load(path,crop),w,h,bx,by).convert('RGBA')
    m=Image.new('L',(w,h),0)
    if feather:
        ImageDraw.Draw(m).rounded_rectangle((feather,feather,w-feather,h-feather),feather//2,fill=255); m=m.filter(ImageFilter.GaussianBlur(feather*0.55))
    else:
        ImageDraw.Draw(m).rounded_rectangle((0,0,w-1,h-1),r,fill=255)
    im.putalpha(m)
    canvas.paste(im,(x,y),im)


tile('5.45.40_PM.jpeg',1450,60,2025,2700,feather=140,by=0)
tile('5.45.44_PM_1.jpeg',2900,1500,1200,1800,feather=140,by=0)
L=['5.45.43_PM.jpeg','5.45.42_PM_2.jpeg','5.45.41_PM_1.jpeg','5.45.42_PM.jpeg','5.43.20_PM.jpeg','5.45.42_PM_1.jpeg']
for i,p in enumerate(L):
    x=[40,740][i%2]; y=[40,1200,2360][i//2]
    crop=(0,160,720,1440) if p.startswith('5.43.20') else None
    tile(p,x,y,690,1108,crop=crop)
tile('5.45.43_PM_1.jpeg',1480,2800,1400,670,by=.5)
tile('5.45.41_PM.jpeg',3500,40,720,640)
tile('5.45.44_PM_2.jpeg',4230,40,700,640,by=.3)
tile('5.45.40_PM_1.jpeg',3500,700,720,780)
tile('5.45.43_PM_2.jpeg',4230,700,700,780)
for i,p in enumerate(['5.45.45_PM_1.jpeg','5.45.44_PM.jpeg','5.45.45_PM.jpeg']):
    tile(p,4120,1500+i*670,820,660)
out=canvas.convert('RGB'); out.save('collage_A3_v8.png',dpi=(300,300)); out.save('collage_A3_v8.pdf',resolution=300)
out.resize((1240,877)).save('/tmp/claude-0/prev8.png')
