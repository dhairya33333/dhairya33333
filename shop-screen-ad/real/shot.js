const {chromium}=require('playwright');const path=require('path');
(async()=>{const a=process.argv.slice(2);const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--disable-gpu','--allow-file-access-from-files']});const p=await b.newPage({viewport:{width:1920,height:1080}});p.on('pageerror',e=>console.log('ERR',e.message));await p.goto('file://'+path.join(__dirname,a[0]));await p.evaluate(()=>window.ready);
for(const t of a.slice(2)){await p.evaluate(t=>window.render(t),+t);await p.screenshot({path:`${a[1]}_${t}.png`});}await b.close()})();
