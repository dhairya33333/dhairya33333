const {chromium}=require('playwright');const path=require('path');const fs=require('fs');
(async()=>{const a=process.argv.slice(2);const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--disable-gpu','--allow-file-access-from-files']});
const open=async()=>{const c=await b.newContext({viewport:{width:1920,height:1080}});const p=await c.newPage();p.on('pageerror',e=>console.log('ERR',e.message));p.on('console',m=>{if(m.type()==='error')console.log('CE',m.text())});await p.goto('file://'+path.join(__dirname,'film.html'));await p.evaluate(()=>window.ready);await p.waitForFunction(()=>window.QR);return p};
if(a[0]==='shots'){fs.mkdirSync(a[1],{recursive:true});const p=await open();for(const t of a.slice(2)){await p.evaluate(t=>window.render(t),+t);await p.screenshot({path:path.join(a[1],`t${t}.png`)});}await b.close();return}
const [fps,s,e,out,w='3']=a;const F=+fps;fs.mkdirSync(out,{recursive:true});let nx=Math.round(+s*F);const N=Math.round(+e*F);
async function work(){const p=await open();while(true){const i=nx++;if(i>=N)break;await p.evaluate(t=>window.render(t),i/F);await p.screenshot({path:path.join(out,`f${String(i).padStart(5,'0')}.jpg`),type:'jpeg',quality:92});if(i%150===0)console.log('frame',i,'/',N)}}
await Promise.all(Array.from({length:+w},work));await b.close()})();
