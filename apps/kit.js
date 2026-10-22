/* Shared by the three Niro business apps (partner, workforce, admin). Talks to the same API and database as the customer app. */
var $=function(s,r){return (r||document).querySelector(s)};
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function api(m,p,b){
  var o={method:m,headers:{},credentials:'same-origin'};
  if(b!==undefined||m!=='GET'){o.headers['content-type']='application/json';if(b!==undefined)o.body=JSON.stringify(b)}
  return fetch(p,o).then(function(r){return r.text().then(function(t){var d=null;try{d=t?JSON.parse(t):null}catch(e){}
    if(!r.ok){var e=new Error((d&&d.error)||'Something went wrong. Try again.');e.status=r.status;throw e}return d})},
    function(){var e=new Error('No connection. Check your internet.');e.status=0;throw e});
}
var _tt=0;function toast(m){var t=$('#toast');if(!t){t=document.createElement('div');t.id='toast';t.className='toast';t.setAttribute('role','status');document.body.appendChild(t)}t.textContent=m;t.hidden=false;clearTimeout(_tt);_tt=setTimeout(function(){t.hidden=true},3000)}
function sheet(html){closeSheet();var s=document.createElement('div');s.className='scrim';s.id='scrim';s.innerHTML='<div class="sheet" role="dialog" aria-modal="true">'+html+'</div>';s.addEventListener('click',function(e){if(e.target===s)closeSheet()});document.body.appendChild(s);return s.firstChild}
function closeSheet(){var s=$('#scrim');if(s)s.remove()}
function money(n){return '₹'+(Math.round(n*100)/100).toLocaleString('en-IN')}
function hm(t){return t?String(t).slice(0,5):''}
function when(iso){var d=new Date(iso);return d.toLocaleTimeString('en-IN',{hour:'numeric',minute:'2-digit'})}
function dayt(iso){var d=new Date(iso);return d.toLocaleDateString('en-IN',{day:'numeric',month:'short'})+', '+when(iso)}
function here(latEl,lngEl,btn){
  btn.disabled=true;
  navigator.geolocation.getCurrentPosition(function(p){latEl.value=p.coords.latitude.toFixed(6);lngEl.value=p.coords.longitude.toFixed(6);btn.disabled=false},function(){btn.disabled=false;toast('Could not get location. Allow location for this site.')},{enableHighAccuracy:true,timeout:15000});
}

/* Sign in with a mobile number and a code sent by SMS. Calls onDone() after a successful sign in. */
function loginView(root,title,sub,onDone){
  var step=0,phone='',name='';
  function draw(){
    root.innerHTML='<div class="login"><div class="brandmark">niro</div><h1 style="margin-top:22px">'+esc(title)+'</h1><p>'+esc(sub)+'</p>'+
      (step===0?'<form id="lf"><label for="ln">Your name</label><input id="ln" autocomplete="name" maxlength="60" value="'+esc(name)+'"><label for="lp">Mobile number</label><input id="lp" type="tel" inputmode="numeric" maxlength="10" placeholder="9876543210" value="'+esc(phone)+'" autocomplete="tel-national"><p class="err" id="le" hidden></p><div class="acts"><button class="full">Send code</button></div></form>'
      :'<form id="lf"><label for="lo">6-digit code sent to +91 '+esc(phone)+'</label><input id="lo" inputmode="numeric" maxlength="6" autocomplete="one-time-code"><p class="err" id="le" hidden></p><div class="acts"><button class="full">Verify and continue</button><button type="button" class="s full" id="lb">Change number</button></div></form>')+'</div>';
    var f=$('#lf'),er=$('#le');
    if(step===1)$('#lb').onclick=function(){step=0;draw()};
    f.onsubmit=function(e){
      e.preventDefault();er.hidden=true;var b=f.querySelector('button');b.disabled=true;
      var req=step===0?(function(){name=$('#ln').value.trim();phone=$('#lp').value.replace(/\D/g,'');if(!name||!/^[6-9]\d{9}$/.test(phone))return Promise.reject(new Error('Enter your name and a valid 10-digit mobile number.'));return api('POST','/api/auth/request-otp',{phone:phone,name:name}).then(function(){step=1;draw()})})()
        :api('POST','/api/auth/verify',{phone:phone,code:$('#lo').value}).then(function(){onDone()});
      req.catch(function(x){b.disabled=false;er.textContent=x.message;er.hidden=false});
    };
  }
  draw();
}
/* Loads data; shows the sign-in screen on 401; calls render(data). */
function boot(root,cfg){
  function go(){
    cfg.load().then(function(d){cfg.render(d)}).catch(function(e){
      if(e.status===401)loginView(root,cfg.title,cfg.sub,go);
      else root.innerHTML='<div class="login"><div class="brandmark">niro</div><h1 style="margin-top:22px">'+esc(e.status===403?'Not allowed':'Something went wrong')+'</h1><p>'+esc(e.message)+'</p><div class="acts"><button id="rt">Try again</button><button class="s" id="lo2">Log out</button></div></div>',
        $('#rt').onclick=go,$('#lo2').onclick=function(){api('POST','/api/auth/logout').then(function(){location.reload()})};
    });
  }
  go();return go;
}
function logout(){api('POST','/api/auth/logout').then(function(){location.reload()})}
