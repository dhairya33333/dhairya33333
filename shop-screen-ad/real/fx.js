// realistic atmosphere + Spark (canvas 2D, deterministic in t)
const R=(i,k=0)=>{const x=Math.sin(i*127.1+k*311.7)*43758.5453;return x-Math.floor(x)};
const clamp=(x,a=0,b=1)=>Math.min(b,Math.max(a,x));
function glow(c,x,y,r,col,a,mode='lighter'){c.globalCompositeOperation=mode;const g=c.createRadialGradient(x,y,0,x,y,r);g.addColorStop(0,`rgba(${col},${a})`);g.addColorStop(.35,`rgba(${col},${a*.35})`);g.addColorStop(1,`rgba(${col},0)`);c.fillStyle=g;c.fillRect(x-r,y-r,2*r,2*r)}
let BEAM=null;function makeBeam(){const b=document.createElement('canvas');b.width=128;b.height=512;const c=b.getContext('2d');const g=c.createLinearGradient(0,0,128,0);g.addColorStop(0,'rgba(130,170,255,0)');g.addColorStop(.5,'rgba(130,170,255,1)');g.addColorStop(1,'rgba(130,170,255,0)');c.fillStyle=g;c.fillRect(0,0,128,512);c.globalCompositeOperation='destination-in';const v=c.createLinearGradient(0,0,0,512);v.addColorStop(0,'rgba(0,0,0,.9)');v.addColorStop(1,'rgba(0,0,0,0)');c.fillStyle=v;c.fillRect(0,0,128,512);return b}
function ambient(c,t,W,H,sp,avoid=[]){
  // light rays
  c.globalCompositeOperation='lighter';if(!BEAM)BEAM=makeBeam();
  for(let i=0;i<4;i++){const sw=Math.sin(t*.13+i*2.1);c.save();c.globalAlpha=.07+.03*Math.sin(t*.4+i);c.translate(W*(.12+.25*i)+sw*90,-80);c.rotate(.38+sw*.05);c.drawImage(BEAM,-170-i*30,0,340+i*60,H*1.6);c.restore()}c.globalAlpha=1;
  // bokeh (slow drift)
  for(let i=0;i<22;i++){const sx=R(i,1),sy=R(i,2),sr=R(i,3),sv=R(i,4);const x=((sx*W+t*(6+sv*14))%(W+300))-150,y=(sy*H+Math.sin(t*.2+i)*30);const r=22+sr*70;const warm=R(i,5)>.7;glow(c,x,y,r,warm?'255,200,110':'110,160,255',.05+.05*R(i,6))}
  // dust motes (lit near the Spark)
  for(let i=0;i<190;i++){const d=.4+R(i,7)*1.2;const x=((R(i,8)*W+t*(8+d*18)+Math.sin(t*.7+i)*20)%(W+40))-20,y=((R(i,9)*H-t*(5+d*8)+Math.cos(t*.5+i*1.3)*14)%(H+40)+H+40)%(H+40)-20;if(avoid.some(r=>x>r[0]&&x<r[2]&&y>r[1]&&y<r[3]))continue;const dist=sp?Math.hypot(x-sp.x,y-sp.y):999;const lit=sp?clamp(1-dist/520):0;const a=.10+.12*R(i,10)+lit*.75*R(i,11);const s=.8+d*1.4;c.globalCompositeOperation='lighter';c.fillStyle=`rgba(${lit>.1?'255,215,150':'190,215,255'},${a})`;c.beginPath();c.arc(x,y,s,0,7);c.fill()}
}
function steam(c,t,x0,y0,on=1){c.globalCompositeOperation='lighter';for(let i=0;i<70;i++){const age=((t*.55+R(i,12))%1);const px=x0+(R(i,13)-.5)*90+Math.sin(age*7+i)*22*age+Math.sin(t+i)*6,py=y0-age*340;const r=14+age*55;const a=(.085)*(1-age)*Math.min(1,age*6)*on;const g=c.createRadialGradient(px,py,0,px,py,r);g.addColorStop(0,`rgba(230,240,255,${a})`);g.addColorStop(1,'rgba(230,240,255,0)');c.fillStyle=g;c.fillRect(px-r,py-r,2*r,2*r)}}
function sparkFX(c,t,pathFn,intensity=1,W=1920,H=1080){
  const p=pathFn(t);const fl=(.86+.14*Math.sin(t*37)*Math.sin(t*11.3))*intensity;
  // light cast on the whole scene
  glow(c,p.x,p.y,900,'255,190,100',.10*fl);glow(c,p.x,p.y,420,'255,200,120',.16*fl);
  // trail
  for(let k=1;k<90;k++){const q=pathFn(t-k*.016);const j=k*.35;const x=q.x+(R(k,t*0)-.5)*j*1.2+Math.sin(k*1.7+t*9)*j*.35,y=q.y+(R(k,3)-.5)*j*1.2+Math.cos(k*2.1+t*8)*j*.35;const a=Math.pow(1-k/90,2)*.5*fl;const r=(1-k/90)*9+1.5;glow(c,x,y,r*3.2,k<30?'255,210,120':'255,150,60',a)}
  // embers
  for(let k=0;k<26;k++){const age=((t*.9+R(k,20))%1);const q=pathFn(t-age*.25);const x=q.x+(R(k,21)-.5)*160*age+Math.sin(t*5+k)*14*age,y=q.y+age*90*(R(k,22)+.3)+(R(k,23)-.5)*40*age;glow(c,x,y,3+4*(1-age),'255,190,90',(1-age)*.9*fl)}
  // core + glow
  glow(c,p.x,p.y,150,'255,190,90',.55*fl);glow(c,p.x,p.y,56,'255,225,150',.9*fl);glow(c,p.x,p.y,20,'255,250,230',1*fl);
  // anamorphic streak + spikes
  c.globalCompositeOperation='lighter';c.save();c.translate(p.x,p.y);
  let g=c.createLinearGradient(-340,0,340,0);g.addColorStop(0,'rgba(255,200,110,0)');g.addColorStop(.5,`rgba(255,235,190,${.55*fl})`);g.addColorStop(1,'rgba(255,200,110,0)');c.fillStyle=g;c.fillRect(-340,-2.2,680,4.4);
  g=c.createLinearGradient(0,-120,0,120);g.addColorStop(0,'rgba(255,200,110,0)');g.addColorStop(.5,`rgba(255,235,190,${.35*fl})`);g.addColorStop(1,'rgba(255,200,110,0)');c.fillStyle=g;c.fillRect(-1.6,-120,3.2,240);
  c.rotate(t*.3+.8);g=c.createLinearGradient(-90,0,90,0);g.addColorStop(0,'rgba(255,200,110,0)');g.addColorStop(.5,`rgba(255,235,190,${.22*fl})`);g.addColorStop(1,'rgba(255,200,110,0)');c.fillStyle=g;c.fillRect(-90,-1,180,2);c.rotate(1.57);c.fillRect(-90,-1,180,2);c.restore();
  // ghost flares along the screen centre line
  const cx=W/2,cy=H/2;for(let i=0;i<4;i++){const f=-.35+i*.3;const fx=p.x+(cx-p.x)*f*1.6,fy=p.y+(cy-p.y)*f*1.6;glow(c,fx,fy,26+i*18,i%2?'120,170,255':'255,170,90',.07*fl)}
  return p}
function vignette(c,W,H,grain,t){c.globalCompositeOperation='source-over';const g=c.createRadialGradient(W/2,H/2,H*.35,W/2,H/2,H*.95);g.addColorStop(0,'rgba(0,0,0,0)');g.addColorStop(1,'rgba(0,6,22,.55)');c.fillStyle=g;c.fillRect(0,0,W,H);
  if(grain){const ox=Math.floor(R(Math.floor(t*30),9)*256),oy=Math.floor(R(Math.floor(t*30),10)*256);c.globalAlpha=.045;c.globalCompositeOperation='overlay';c.drawImage(grain,-ox,-oy,W+256,H+256);c.globalAlpha=1;c.globalCompositeOperation='source-over'}}
function makeGrain(){const g=document.createElement('canvas');g.width=g.height=256;const c=g.getContext('2d');const d=c.createImageData(256,256);for(let i=0;i<d.data.length;i+=4){const v=Math.floor(Math.random()*255);d.data[i]=d.data[i+1]=d.data[i+2]=v;d.data[i+3]=255}c.putImageData(d,0,0);return g}
