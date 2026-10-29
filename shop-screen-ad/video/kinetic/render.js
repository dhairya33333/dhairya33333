const {chromium}=require('playwright');const path=require('path');const fs=require('fs');
(async()=>{const a=process.argv.slice(2);const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--disable-gpu','--allow-file-access-from-files']});
const open=async()=>{const c=await b.newContext({viewport:{width:1080,height:1920}});const p=await c.newPage();p.on('pageerror',e=>console.log('ERR',e.message));await p.goto('file://'+path.join(__dirname,'kinetic.html'));await p.evaluate(()=>window.ready);return p};
if(a[0]==='shots'){fs.mkdirSync(a[1],{recursive:true});const p=await open();for(const t of a.slice(2)){await p.evaluate(t=>window.render(t),+t);await p.screenshot({path:path.join(a[1],`t${t}.png`)});}await b.close();return}
const [fps,out,w='4']=a;const F=+fps;fs.mkdirSync(out,{recursive:true});const N=Math.round(25*F);let nx=0;
async function work(){const p=await open();while(true){const i=nx++;if(i>=N)break;await p.evaluate(t=>window.render(t),i/F);await p.screenshot({path:path.join(out,`f${String(i).padStart(5,'0')}.jpg`),type:'jpeg',quality:93});}}
await Promise.all(Array.from({length:+w},work));await b.close()})();
