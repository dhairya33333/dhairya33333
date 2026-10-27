// node render.js <fps> <start> <end> <outDir> [workers]   |   node render.js shots <outDir> t1 t2 ...
const { chromium } = require('playwright'); const path = require('path'); const fs = require('fs');
const url = 'file://' + path.join(__dirname, 'ad.html');
async function open(b){const c=await b.newContext({viewport:{width:1920,height:1080}});const p=await c.newPage();p.on('pageerror',e=>console.log('ERR',e.message));await p.goto(url);await p.evaluate(()=>window.ready);await p.waitForFunction(()=>window.QRREADY);return p;}
(async()=>{
 const a=process.argv.slice(2);
 const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--disable-gpu','--allow-file-access-from-files']});
 if(a[0]==='shots'){fs.mkdirSync(a[1],{recursive:true});const p=await open(b);for(const ts of a.slice(2)){await p.evaluate(t=>window.render(t),+ts);await p.screenshot({path:path.join(a[1],`t${ts}.png`)});}await b.close();return;}
 const [fps,s,e,out,w='4']=a;const F=+fps,st=Math.round(+s*F),en=Math.round(+e*F);fs.mkdirSync(out,{recursive:true});let next=st;
 async function worker(){const p=await open(b);while(true){const i=next++;if(i>=en)break;await p.evaluate(t=>window.render(t),i/F);await p.screenshot({path:path.join(out,`f${String(i).padStart(5,'0')}.jpg`),type:'jpeg',quality:93});if(i%250===0)console.log('frame',i,'/',en);}}
 await Promise.all(Array.from({length:+w},worker));await b.close();
})();
