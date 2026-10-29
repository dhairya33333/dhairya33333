# consistent vignette kit: one style, one palette, one set of body/face/hand parts
import styletest as st
from styletest import *
import math
def bust(cx,hy,s,skin,hair,shirt,style='bob',collar=False,wink=False,beard=None,extra='',bodyextra='',logo=None):
    back={'bob':f'<path d="M-92 30 C-114 -100 -62 -158 0 -158 C62 -158 114 -100 92 30 C98 100 62 124 40 104 L-40 104 C-62 124 -98 100 -92 30Z" fill="{hair}"/>',
          'bun':f'<circle cx="0" cy="-138" r="30" fill="{hair}"/>','curly':''.join(f'<circle cx="{x}" cy="{y}" r="34" fill="{hair}"/>' for x,y in [(-62,-70),(-30,-110),(8,-118),(44,-100),(68,-60),(-76,-20),(78,-18)]),'short':''}[style]
    front={'bob':f'<path d="M-68 -38 C-56 -112 56 -112 68 -38 C40 -70 -40 -70 -68 -38Z" fill="{hair}"/>','short':f'<path d="M-58 -30 C-64 -104 -30 -126 0 -126 C30 -126 64 -104 58 -30 C42 -68 -42 -68 -58 -30Z" fill="{hair}"/>','bun':f'<path d="M-58 -30 C-64 -104 -30 -126 0 -126 C30 -126 64 -104 58 -30 C42 -68 -42 -68 -58 -30Z" fill="{hair}"/>','curly':f'<path d="M-56 -34 C-50 -100 50 -100 56 -34 C30 -62 -30 -62 -56 -34Z" fill="{hair}"/>'}[style]
    o=f'<g transform="translate({cx} {hy}) scale({s})">{back}<rect x="-26" y="40" width="52" height="110" rx="22" fill="{skin}"/>'
    o+=f'<path d="M-200 420 C-200 210 -110 122 0 122 C110 122 200 210 200 420Z" fill="{shirt}"/>'
    if collar:o+=f'<path d="M-36 123 L0 171 L-70 161Z" fill="{CR}"/><path d="M36 123 L0 171 L70 161Z" fill="{CR}"/><rect x="-4" y="169" width="8" height="70" rx="3" fill="{CR}"/>'
    if logo:o+=f'<circle cx="-70" cy="225" r="15" fill="{logo}"/>'
    o+=bodyextra+face(0,0,skin,wink,True,True,1,beard)+front+extra+'</g>'
    return o
def spark(x,y,s=1,col=MU):return f'<path d="M{x} {y-14*s} l{4*s} {10*s} l{10*s} {4*s} l{-10*s} {4*s} l{-4*s} {10*s} l{-4*s} {-10*s} l{-10*s} {-4*s} l{10*s} {-4*s}Z" fill="{col}"/>'
def heart(x,y,s=1,col=RD):return f'<path transform="translate({x} {y}) scale({s})" d="M0 14 C-30 -8 -18 -30 0 -16 C18 -30 30 -8 0 14Z" fill="{col}"/>'
V={}
# ---- TOP: apparel
def polo():
    o=bg(MU,255)
    o+=bust(130,270,.62,SK2,BK,OL,'bun',True,logo=CR)+bust(470,270,.62,'#E3A072',BR,TC,'curly',True,logo=CR)+bust(300,232,.78,SKD,BK,NV,'short',True,wink=True,beard=BK,logo=MU)
    o+=spark(60,120,1.6,CR)+spark(540,100,1.2,CR)
    return wrap(o)
def kids():
    o=bg(OL,255)
    o+=''.join(f'<rect x="{x}" y="{y}" width="14" height="14" rx="3" fill="{c}" transform="rotate({r} {x} {y})"/>' for x,y,c,r in [(90,150,MU,20),(480,130,RD,-30),(150,80,CR,40),(440,70,MU,10),(70,300,TC,-20),(520,300,CR,35)])
    o+=f'<g transform="translate(300 250) scale(.95)"><rect x="-26" y="40" width="52" height="110" rx="22" fill="#E3A072"/><path d="M-200 420 C-200 210 -110 130 0 130 C110 130 200 210 200 420Z" fill="{RD}"/><path d="M0 215 l12 26 l28 4 l-20 20 l5 28 l-25 -14 l-25 14 l5 -28 l-20 -20 l28 -4Z" fill="{MU}"/>'+face(0,0,'#E3A072',False,True,True,1.08)+f'<path d="M-62 -34 C-70 -112 -34 -134 0 -134 C34 -134 70 -112 62 -34 C46 -74 -46 -74 -62 -34Z" fill="{BK}"/></g>'
    o+=hand(130,360,-40,'#E3A072',1)+hand(470,360,40,'#E3A072',-1)
    return wrap(o)
V['tee']=(st.s4,'T-SHIRTS','top');V['polo']=(polo,'POLO · TEAM WEAR','top');V['kids']=(kids,'KIDS TEES','top')
# ---- RIGHT: sublimation
def magic():
    o=bg(NV)
    o+=mug(170,380,1.2,None).replace(WH,'#2a2a2a').replace('#E9E1CC','#444')
    o+=mug(430,380,1.2,'photo')+steam(430,296)+steam(470,296)
    o+=f'<path d="M240 390 h60" stroke="{MU}" stroke-width="8" stroke-linecap="round" stroke-dasharray="2 14"/><path d="M296 390 l-18 -16 v32Z" fill="{MU}" transform="rotate(180 288 390) translate(0 0)"/>'
    o+=f'<g transform="translate(300 120) rotate(-28)"><path d="M-50 0 q0 -50 50 -50 q50 0 50 50 v30 q0 20 -20 20 h-60 q-20 0 -20 -20Z" fill="{MU}"/><path d="M50 -10 q50 -10 62 -50" stroke="{MU}" stroke-width="16" fill="none" stroke-linecap="round"/><path d="M-50 -10 q-40 6 -48 40" stroke="{MU2}" stroke-width="12" fill="none" stroke-linecap="round"/></g>'
    o+=f'<path d="M388 150 q16 40 30 90" stroke="#6bb6ff" stroke-width="7" fill="none" stroke-linecap="round" stroke-dasharray="2 12"/>'+spark(530,190,1.3,CR)+spark(60,260,1,CR)
    return wrap(o)
def keychain():
    o=bg(MU)
    o+=f'<circle cx="300" cy="170" r="52" fill="none" stroke="{NV}" stroke-width="14"/>'+f'<path d="M300 222 v50" stroke="{NV}" stroke-width="10" stroke-linecap="round"/>'
    o+=f'<g><path d="M300 272 C250 262 200 300 210 360 C220 420 270 450 300 480 C330 450 380 420 390 360 C400 300 350 262 300 272Z" fill="{RD}"/><ellipse cx="300" cy="372" rx="58" ry="62" fill="{CR}"/><circle cx="300" cy="358" r="22" fill="{SK2}"/><path d="M262 412 q38 -40 76 0Z" fill="{BL}"/><animateTransform attributeName="transform" type="rotate" values="-5 300 272;5 300 272;-5 300 272" dur="2s" repeatCount="indefinite"/></g>'
    o+=''.join(f'<rect x="{150+i*72}" y="500" width="62" height="62" rx="10" fill="{CR}"/><text x="{181+i*72}" y="545" text-anchor="middle" font-family="P" font-size="38" font-weight="700" fill="{NV}">{c}</text>' for i,c in enumerate('NAME'))
    o+=f'<g transform="translate(110 380) rotate(-25)"><circle r="22" fill="none" stroke="{OL}" stroke-width="9"/><rect x="-6" y="20" width="12" height="70" fill="{OL}"/><rect x="6" y="64" width="22" height="8" fill="{OL}"/></g>'
    o+=hand(300,110,0,SK2,1)+spark(500,200,1.4,CR)+spark(90,170,1,CR)
    return wrap(o)
def mousepad():
    o=bg(BL)
    o+=f'<rect x="150" y="90" width="300" height="190" rx="22" fill="{CR}"/><rect x="168" y="108" width="264" height="150" rx="10" fill="{NV}"/><path d="M190 220 q30 -80 60 -20 t60 -30 t60 -40" fill="none" stroke="{MU}" stroke-width="8" stroke-linecap="round"/><rect x="270" y="280" width="60" height="26" fill="{CR}"/><rect x="230" y="302" width="140" height="14" rx="7" fill="{CR}"/>'
    o+=f'<rect x="90" y="360" width="420" height="190" rx="34" fill="{OL}"/><circle cx="170" cy="460" r="50" fill="{MU}" opacity=".9"/><circle cx="170" cy="460" r="28" fill="{TC}"/><path d="M250 410 h200 M250 450 h160 M250 490 h200" stroke="{CR}" stroke-width="10" stroke-linecap="round" opacity=".8"/>'
    o+=f'<path d="M300 400 q-4 -60 -30 -90" stroke="{CR}" stroke-width="5" fill="none"/><rect x="300" y="420" width="50" height="76" rx="24" fill="{CR}"/><path d="M325 420 v30" stroke="{OL}" stroke-width="4"/>'+hand(330,424,10,SK2,1)
    return wrap(o)
def frame():
    o=bg(OL)
    o+=f'<rect x="130" y="110" width="340" height="300" rx="14" fill="{MU}"/><rect x="156" y="136" width="288" height="248" rx="6" fill="{BL}"/><circle cx="380" cy="190" r="30" fill="{CR}"/><path d="M156 384 L240 270 L310 340 L360 290 L444 384Z" fill="{TC}"/><path d="M156 384 L210 316 L270 384Z" fill="{OL}"/>'
    o+=f'<path d="M300 110 l-60 -50 M300 110 l60 -50" stroke="{CR}" stroke-width="5"/><circle cx="300" cy="50" r="10" fill="{CR}"/>'
    o+=heart(470,130,1.6,RD)+spark(110,170,1.2,CR)+spark(520,380,1,CR)
    o+=f'<rect x="60" y="470" width="480" height="30" rx="10" fill="{MU2}"/><rect x="200" y="420" width="90" height="50" rx="8" fill="{CR}"/><rect x="215" y="430" width="60" height="30" fill="{TC}"/>'
    return wrap(o)
def polaroid():
    o=bg(TC)
    o+=f'<rect x="60" y="300" width="250" height="190" rx="26" fill="{NV}"/><rect x="60" y="300" width="250" height="52" rx="22" fill="{BL}"/><circle cx="185" cy="410" r="50" fill="{CR}"/><circle cx="185" cy="410" r="32" fill="{NV}"/><circle cx="185" cy="410" r="14" fill="{LB}"/><rect x="250" y="316" width="30" height="16" rx="5" fill="{MU}"/>'
    o+=f'<g transform="translate(260 240) rotate(8)"><rect width="190" height="230" fill="{WH}"/><rect x="14" y="14" width="162" height="160" fill="{BL}"/><circle cx="95" cy="80" r="26" fill="{SK2}"/><path d="M40 174 q55 -70 110 0Z" fill="{MU}"/></g>'
    o+=f'<path d="M60 90 Q300 150 540 80" stroke="{CR}" stroke-width="5" fill="none"/>'+''.join(f'<g transform="translate({90+i*140} {110+[0,20,0][i]}) rotate({[-6,4,-3][i]})"><rect width="100" height="124" fill="{WH}"/><rect x="8" y="8" width="84" height="84" fill="{[LB,MU,OL][i]}"/><rect x="38" y="-10" width="24" height="22" rx="4" fill="{MU2}"/></g>' for i in range(3))
    o+=heart(470,410,1.4,CR)+spark(540,330,1.1,CR)
    return wrap(o)
def lanyard():
    o=bg(NV)
    o+=bust(300,230,.95,SK2,BK,CR,'bob',wink=False)
    o+=f'<path d="M236 372 L300 500 L364 372" fill="none" stroke="{BL}" stroke-width="22" stroke-linejoin="round"/><path d="M244 380 L300 494 L356 380" fill="none" stroke="{MU}" stroke-width="4" stroke-dasharray="10 10"/>'
    o+=f'<g transform="translate(300 520)"><rect x="-62" y="-30" width="124" height="150" rx="14" fill="{WH}"/><circle cx="0" cy="22" r="26" fill="{SK2}"/><path d="M-26 70 q26 -30 52 0Z" fill="{OL}"/><rect x="-44" y="86" width="88" height="14" rx="6" fill="{BL}"/><rect x="-14" y="-44" width="28" height="22" rx="6" fill="{MU}"/></g>'
    o+=spark(70,200,1.4,MU)+spark(540,150,1.1,MU)
    return wrap(o)
def bottle():
    o=bg(OL)
    o+=bust(240,260,.8,'#E3A072',BR,TC,'short',wink=True)
    o+=f'<g transform="translate(430 300) rotate(18)"><rect x="-20" y="-120" width="40" height="30" rx="8" fill="{MU}"/><rect x="-44" y="-92" width="88" height="220" rx="30" fill="{BL}"/><rect x="-44" y="-20" width="88" height="70" fill="{CR}"/><text x="0" y="28" text-anchor="middle" font-family="P" font-size="22" font-weight="700" fill="{NV}">NAME</text><path d="M-44 -50 q22 -14 44 0 t44 0" stroke="{LB}" stroke-width="6" fill="none"/></g>'
    o+=hand(380,420,-10,'#E3A072',1)+''.join(f'<circle cx="{x}" cy="{y}" r="{r}" fill="{LB}"/>' for x,y,r in [(500,160,9),(530,210,6),(480,120,5)])+spark(70,150,1.3,MU)
    return wrap(o)
def calendar():
    o=bg(MU)
    o+=f'<rect x="110" y="120" width="380" height="360" rx="24" fill="{CR}"/><rect x="110" y="120" width="380" height="84" rx="24" fill="{BL}"/><rect x="110" y="170" width="380" height="34" fill="{BL}"/><text x="300" y="178" text-anchor="middle" font-family="P" font-size="40" font-weight="700" fill="#fff">JANUARY</text>'
    o+=''.join(f'<circle cx="{170+i*65}" cy="118" r="12" fill="{NV}"/>' for i in range(6))
    for i in range(28):o+=f'<text x="{150+(i%7)*50}" y="{250+(i//7)*54}" font-family="P" font-size="24" font-weight="700" fill="{NV}">{i+1}</text>'
    o+=heart(335,312,1.7,RD)+f'<g transform="translate(470 440) rotate(40)"><rect x="-8" y="-80" width="16" height="120" rx="6" fill="{OL}"/><path d="M-8 40 l8 24 l8 -24Z" fill="{NV}"/></g>'+spark(80,160,1.2,CR)+spark(540,150,1,CR)
    return wrap(o)
for k,(f,n) in {'magic':(magic,'MAGIC MUGS'),'key':(keychain,'KEYCHAINS'),'pad':(mousepad,'MOUSE PADS'),'frame':(frame,'PHOTO FRAMES'),'polaroid':(polaroid,'POLAROIDS'),'lanyard':(lanyard,'LANYARDS'),'bottle':(bottle,'BOTTLES'),'calendar':(calendar,'CALENDARS')}.items():V[k]=(f,n,'right')
V['mug']=(st.s3,'PHOTO MUGS','right');V['mugw']=(st.s1,'MUGS · COFFEE TIME','right')
# ---- BOTTOM
def printer():return st.s2()
def touch():
    o=bg(NV)
    o+=f'<rect x="150" y="470" width="300" height="60" rx="14" fill="{CR}"/><rect x="190" y="440" width="220" height="40" rx="10" fill="{LB}"/>'
    for i,(w,c) in enumerate([(70,TC),(96,TC),(120,SKD),(110,TC),(84,SKD),(62,TC),(44,TC),(30,SKD)]):o+=f'<rect x="{300-w/2}" y="{430-i*34}" width="{w}" height="32" rx="14" fill="{c}"/>'
    o+=f'<circle cx="300" cy="140" r="26" fill="{TC}"/>'
    o+=hand(470,330,60,SK2,-1)+f'<path d="M380 300 q-16 -4 -24 -20 M392 340 q-18 0 -30 -12 M384 380 q-16 6 -30 0" stroke="{MU}" stroke-width="7" fill="none" stroke-linecap="round"/>'+spark(100,170,1.5,MU)+spark(500,140,1.2,MU)
    return wrap(o)
def cards():
    o=bg(BL)
    for i,(rot,col) in enumerate([(-22,CR),(-8,LB),(6,CR),(20,MU)]):
        o+=f'<g transform="translate(300 330) rotate({rot})"><rect x="-150" y="-90" width="300" height="180" rx="14" fill="{col}"/><circle cx="-100" cy="-40" r="22" fill="{NV}"/><path d="M-110 -50 v26 q10 12 20 0 v-26" stroke="{col}" stroke-width="6" fill="none"/><rect x="-60" y="-52" width="150" height="14" rx="6" fill="{NV}"/><rect x="-60" y="-26" width="110" height="10" rx="5" fill="{NV}" opacity=".5"/><rect x="-130" y="30" width="160" height="10" rx="5" fill="{NV}" opacity=".5"/><rect x="-130" y="52" width="120" height="10" rx="5" fill="{NV}" opacity=".5"/></g>'
    o+=spark(110,150,1.6,MU)+spark(500,120,1.2,CR)+spark(520,500,1,MU)
    return wrap(o)
def invite():
    o=bg(TC)
    o+=f'<g transform="translate(300 330)"><rect x="-190" y="-30" width="380" height="230" rx="14" fill="{CR}"/><g><rect x="-150" y="-170" width="300" height="230" rx="10" fill="{WH}"/><text x="0" y="-100" text-anchor="middle" font-family="P" font-size="26" font-weight="700" fill="{NV}">You\'re invited</text><rect x="-90" y="-76" width="180" height="10" rx="5" fill="{NV}" opacity=".4"/><rect x="-70" y="-54" width="140" height="10" rx="5" fill="{NV}" opacity=".4"/><path transform="translate(0 -10) scale(1.6)" d="M0 14 C-30 -8 -18 -30 0 -16 C18 -30 30 -8 0 14Z" fill="{RD}"/></g><path d="M-190 -30 L0 110 L190 -30 L190 200 L-190 200Z" fill="{MU}"/><path d="M-190 200 L-20 60 M190 200 L20 60" stroke="{MU2}" stroke-width="8"/></g>'
    o+=heart(100,160,1.3,CR)+heart(510,200,1,CR)+spark(80,420,1.3,MU)+spark(530,430,1.4,MU)
    return wrap(o)
def book():
    o=bg(OL)
    o+=f'<path d="M80 200 L300 240 L520 200 L520 480 L300 520 L80 480Z" fill="{BR}"/><path d="M96 190 L300 226 V500 L96 464Z" fill="{CR}"/><path d="M504 190 L300 226 V500 L504 464Z" fill="{CR}" opacity=".95"/>'
    o+=f'<g transform="rotate(-6 190 320)"><rect x="130" y="250" width="110" height="110" fill="{BL}"/><circle cx="185" cy="290" r="20" fill="{SK2}"/><path d="M142 360 q43 -60 86 0Z" fill="{MU}"/></g><g transform="rotate(5 420 300)"><rect x="360" y="250" width="110" height="130" fill="{WH}"/><rect x="370" y="260" width="90" height="90" fill="{TC}"/><circle cx="415" cy="296" r="16" fill="{SK2}"/></g><rect x="140" y="390" width="100" height="14" rx="6" fill="{NV}" opacity=".4"/><rect x="370" y="400" width="90" height="14" rx="6" fill="{NV}" opacity=".4"/>'
    o+=heart(300,170,2,RD)+heart(120,140,1,CR)+heart(500,150,1.2,CR)+spark(540,330,1.2,MU)
    return wrap(o)
def stickers():
    o=bg(NV)
    o+=f'<rect x="120" y="130" width="360" height="360" rx="26" fill="{CR}"/><path d="M480 400 l-110 90 h110Z" fill="{LB}"/><path d="M370 490 q60 -20 110 -90" stroke="{MU}" stroke-width="3" fill="none"/>'
    o+=f'<path d="M210 220 l14 30 l32 4 l-24 22 l8 32 l-30 -17 l-30 17 l8 -32 l-24 -22 l32 -4Z" fill="{MU}"/><g>'+heart(360,254,3,RD)+f'</g><circle cx="220" cy="390" r="52" fill="{BL}"/><path d="M200 380 v28 q20 18 40 0 v-28" stroke="{CR}" stroke-width="9" fill="none" stroke-linecap="round"/><path d="M330 340 q40 -30 80 0 q20 40 -10 70 q-40 20 -70 -10 q-20 -30 0 -60Z" fill="{OL}"/>'
    o+=f'<path d="M450 470 q40 -80 70 -150" stroke="{SK2}" stroke-width="0"/>'+hand(500,380,-30,SK2,-1)+spark(80,180,1.4,MU)+spark(530,160,1.2,CR)
    return wrap(o)
V['printer']=(printer,'3D MODEL PRINTING','bottom');V['touch']=(touch,'3D PRINTS · TOUCH IT','bottom');V['cards']=(cards,'VISITING CARDS','bottom');V['invite']=(invite,'INVITATIONS','bottom');V['book']=(book,'MEMORY BOOKS','bottom');V['stickers']=(stickers,'STICKERS','bottom')
if __name__=='__main__':
    html='<html><body style="margin:0;background:#FFFCEB;font-family:sans-serif"><div style="display:grid;grid-template-columns:repeat(6,1fr);gap:8px;padding:8px">'+''.join(f'<div><div style="width:100%">{f()}</div><div style="font:700 12px sans-serif;color:#0A2A5E">{n} · {z}</div></div>' for k,(f,n,z) in V.items())+'</div></body></html>'
    open('vsheet.html','w').write(html)
