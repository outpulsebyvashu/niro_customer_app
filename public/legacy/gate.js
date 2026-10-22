/* Launch gate: loading animation, then ask for location. Allowed opens the app; denied blocks and asks again. */
(function(){
  var g=document.getElementById('gate'); if(!g||g.dataset.on)return; g.dataset.on='1';
  var t=document.getElementById('gt'),p=document.getElementById('gp'),nv=document.getElementById('gnv'),b=document.getElementById('gb'),busy=false,done=false;
  document.documentElement.style.overflow='hidden';
  var t0=Date.now(),D=2500;
  /* the app starts loading behind the gate as soon as the position is known; the gate only waits for the word animation to finish */
  function open(pos){ if(done)return; done=true; window.NIRO_POS=pos&&pos.coords?{lat:pos.coords.latitude,lng:pos.coords.longitude,acc:pos.coords.accuracy}:null; try{document.dispatchEvent(new CustomEvent('niro:location',{detail:window.NIRO_POS}))}catch(e){}
    setTimeout(function(){g.classList.add('out'); document.documentElement.style.overflow=''; setTimeout(function(){g.remove()},600)},Math.max(0,D+150-(Date.now()-t0))); }
  function block(kind){
    g.classList.add('ask'); g.classList.toggle('denied',kind==='denied'); busy=false; b.disabled=false;
    if(kind==='denied'){t.textContent='Location is needed';p.textContent='Niro can’t open without your location. Please allow it to continue.';b.textContent='Ask again'}
    else if(kind==='nogeo'){t.textContent='Location not supported';p.textContent='Open Niro in a browser that supports location, over a secure (https) connection.';b.textContent='Try again'}
    else if(kind==='fail'){t.textContent='Can’t find your location';p.textContent='Turn on GPS or Location services on your phone, then try again.';b.textContent='Try again'}
    else {t.textContent='Allow location';b.textContent='Allow location'}
  }
  function ask(){
    if(busy||done)return; busy=true; b.disabled=true; b.textContent='Waiting…';
    if(!navigator.geolocation){block('nogeo');return}
    navigator.geolocation.getCurrentPosition(open,function(e){block(e&&e.code===1?'denied':'fail')},{enableHighAccuracy:false,timeout:15000,maximumAge:60000});
  }
  b.addEventListener('click',ask);
  try{ if(navigator.permissions&&navigator.permissions.query) navigator.permissions.query({name:'geolocation'}).then(function(s){ s.onchange=function(){ if(s.state==='granted'&&!done){busy=false;ask()} } }).catch(function(){}) }catch(e){}
  (function tick(){var k=Math.min(1,(Date.now()-t0)/D); nv.textContent=Math.round(100*(1-Math.pow(1-k,2))); if(k<1)setTimeout(tick,40); else ask();})();
  /* permission already given: ask right away, no need to wait for the animation */
  try{ if(navigator.permissions&&navigator.permissions.query) navigator.permissions.query({name:'geolocation'}).then(function(s){ if(s.state==='granted')ask() }).catch(function(){}) }catch(e){}
})();
