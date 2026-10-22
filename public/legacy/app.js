/* Niro customer app. Everything shown here comes from the API (/api/...) and from the phone's own location.
   There is no sample data. Cafes, offers, cards, stamps and profile live in the database. */
var M_PER_PX = 3, GEO_R = 120, TZ = 17, MLAT = 110574;
var $ = function(s){return document.querySelector(s)};
var state = {tab:'home',sel:null,q:'',saved:{},savedList:[],route:null,auth:false,pend:'',me:{name:'',phone:'',photo:'',birthday:'',email:'',diet:'',fav:'',dates:[]},
  prefs:{stamps:true,offers:true,treats:true,geo:true},prev:'home',geo:{used:0,cap:2},pos:null,place:null,perm:'',nearLoaded:false,nearErr:'',photosOn:false,admin:false,wi:0};
var you = {x:0,y:0,lat:null,lng:null,acc:0};
var ORG = null;
var registry = {}, nearIds = {}, walletOrder = [];

/* ---------- small helpers ---------- */
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')}
/* Only real image data or our own media path may go in an img src. Anything else is dropped. */
function safeImg(u){u=String(u||'');return (/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+\/=]+$/.test(u)||/^\/api\/media\/[\w\/.-]+$/.test(u))?u:''}
function byId(id){return registry[id]}
function joined(){return walletOrder.map(byId).filter(function(c){return c&&c.joined})}
function fmtPh(d){d=d||'';return d.length>5?d.slice(0,5)+' '+d.slice(5):d}
function greet(){var h=new Date().getHours();return h<12?'Good morning':h<17?'Good afternoon':'Good evening'}
function fmt(m){return m<1000?(Math.max(10,Math.round(m/10)*10))+' m':(m/1000).toFixed(1)+' km'}
function dots(n,goal){var h='';for(var i=0;i<goal;i++)h+='<span class="dot'+(i<n?' on':'')+'"></span>';return '<div class="dots" aria-label="'+n+' of '+goal+' stamps">'+h+'</div>'}
function initials(n){return String(n).split(/\s+/).filter(function(w){return /^[A-Za-z0-9]/.test(w)}).slice(0,2).map(function(w){return w.charAt(0).toUpperCase()}).join('')}
function bvars(b){return '--b-bg:'+b.bg+';--b-ink:'+b.ink+';--b-acc:'+b.acc}
function brandOf(c){return c.brand}
var MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'], DAYS=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
function istNow(){return new Date(Date.now()+5.5*3600*1000)}
function hm(t){var p=String(t||'').split(':'),h=+p[0],m=+p[1]||0,ap=h>=12?'pm':'am';h=h%12||12;return h+(m?':'+String(m).padStart(2,'0'):'')+' '+ap}
function hoursOf(c){
  if(!c.opens||!c.closes)return {open:null,text:'Hours not set'};
  var n=istNow(),now=n.getUTCHours()*60+n.getUTCMinutes(),a=c.opens.split(':'),b=c.closes.split(':'),o=+a[0]*60+ +a[1],cl=+b[0]*60+ +b[1];
  var open=o<=cl?(now>=o&&now<cl):(now>=o||now<cl);
  return {open:open,text:open?'Open till '+hm(c.closes):'Opens '+hm(c.opens)};
}
function expText(iso){
  if(!iso)return 'Ongoing';
  var e=new Date(Date.parse(iso)+5.5*3600*1000),n=istNow(),d0=Date.UTC(n.getUTCFullYear(),n.getUTCMonth(),n.getUTCDate()),d1=Date.UTC(e.getUTCFullYear(),e.getUTCMonth(),e.getUTCDate()),k=Math.round((d1-d0)/864e5);
  return k<=0?'Ends today':k===1?'Ends tomorrow':k<7?'Ends '+DAYS[e.getUTCDay()]:'Ends '+e.getUTCDate()+' '+MON[e.getUTCMonth()];
}
function dayMon(iso){var d=new Date(Date.parse(iso)+5.5*3600*1000);return d.getUTCDate()+' '+MON[d.getUTCMonth()]}

/* ---------- talking to the server ---------- */
function api(method,path,body){
  var o={method:method,headers:{},credentials:'same-origin'};
  if(body!==undefined){o.headers['content-type']='application/json';o.body=JSON.stringify(body)}
  else if(method==='POST'||method==='PUT'||method==='PATCH'||method==='DELETE'){o.headers['content-type']='application/json'}
  return fetch(path,o).then(function(r){
    return r.text().then(function(t){
      var d=null;try{d=t?JSON.parse(t):null}catch(e){}
      if(!r.ok){var er=new Error((d&&d.error)||'Something went wrong. Try again.');er.status=r.status;throw er}
      return d;
    });
  },function(){var er=new Error('No connection. Check your internet and try again.');er.status=0;throw er});
}

/* ---------- places on the map: real coordinates turned into map units (1 unit = 3 m) ---------- */
function mlng(){return 111320*Math.cos(ORG.lat*Math.PI/180)}
function toXY(lat,lng){return {x:(lng-ORG.lng)*mlng()/M_PER_PX,y:-(lat-ORG.lat)*MLAT/M_PER_PX}}
function fromXY(x,y){return {lat:ORG.lat-y*M_PER_PX/MLAT,lng:ORG.lng+x*M_PER_PX/mlng()}}
function hav(a,b,c,d){var r=function(x){return x*Math.PI/180},q=Math.sin(r(c-a)/2)*Math.sin(r(c-a)/2)+Math.cos(r(a))*Math.cos(r(c))*Math.sin(r(d-b)/2)*Math.sin(r(d-b)/2);return 2*6371000*Math.asin(Math.sqrt(q))}
function distOf(p){return you.lat==null?0:hav(you.lat,you.lng,p.lat,p.lng)}
function upsertCafe(a){
  var c=registry[a.id]||{id:a.id,joined:false,stamps:0,mid:'',mem:'',optin:true,offers:[],rewards:0}, b=a.brand||{};
  c.name=a.name; c.area=a.area||a.city||''; c.city=a.city||''; c.kind=a.kind==='restaurant'?'Restaurant':'Cafe'; c.lat=a.lat; c.lng=a.lng;
  c.opens=a.opens; c.closes=a.closes; c.goal=a.stamp_goal||8; c.reward=a.reward_text||'Free reward'; c.photos=a.photos||[];
  c.brand={bg:b.bg||'#0b0b0b',ink:b.ink||'#fafafa',acc:b.acc||'#d9a066',pat:b.pattern||'dots'};
  if(a.offers)c.offers=a.offers;
  if(ORG){var p=toXY(c.lat,c.lng);c.x=p.x;c.y=p.y}
  registry[c.id]=c; return c;
}
function rebase(lat,lng){
  ORG={lat:lat,lng:lng};
  Object.keys(registry).forEach(function(k){var c=registry[k],p=toXY(c.lat,c.lng);c.x=p.x;c.y=p.y});
}
function nearList(){return Object.keys(nearIds).map(byId).filter(Boolean).sort(function(a,b){return distOf(a)-distOf(b)})}
function offerOf(c){var o=c.offers[0];return o?o.title:'Collect '+c.goal+' stamps for '+c.reward}
function expOf(c){var o=c.offers[0];return o?expText(o.ends_at):c.reward}

/* ---------- loading data ---------- */
function loadNearby(){
  if(!you.lat==null&&false)return Promise.resolve();
  return api('GET','/api/cafes/nearby?lat='+you.lat.toFixed(5)+'&lng='+you.lng.toFixed(5)+'&limit=50').then(function(d){
    nearIds={}; d.cafes.forEach(function(a){nearIds[a.id]=1;upsertCafe(a)});
    state.nearLoaded=true; state.nearErr=''; state.nearAt={lat:you.lat,lng:you.lng};
  }).catch(function(e){state.nearErr=e.message;state.nearLoaded=true}).then(function(){renderHome();refreshMap()});
}
function applyMe(m){
  state.auth=true;
  state.me={name:m.name||'',phone:String(m.phone||'').replace(/^\+91/,''),photo:safeImg(m.photo_url),birthday:m.birthday||'',email:m.email||'',diet:m.diet||'',fav:m.fav_order||'',
    dates:(m.special_dates||[]).map(function(d){return {l:d.label,d:d.on_date}})};
  state.prefs=Object.assign({stamps:true,offers:true,treats:true,geo:true},m.prefs||{});
  state.geo.used=m.geo_used_today||0; state.geo.cap=m.geo_cap||2; state.photosOn=!!m.photos_enabled; state.admin=!!m.is_admin;
}
function loadCards(){
  return api('GET','/api/memberships').then(function(d){
    Object.keys(registry).forEach(function(k){registry[k].joined=false});
    walletOrder=[];
    d.cards.forEach(function(x){
      var c=upsertCafe(x.cafe); c.joined=true; c.stamps=x.stamps; c.mid=x.member_code; c.mem=x.id; c.optin=!!x.offers_opt_in; c.rewards=x.rewards_redeemed; walletOrder.push(c.id);
    });
  });
}
function loadSaved(){
  return api('GET','/api/saved-offers').then(function(d){state.saved={};d.ids.forEach(function(i){state.saved[i]=true});state.savedList=d.offers});
}
function loadAccount(){
  return api('GET','/api/me').then(function(m){applyMe(m);return Promise.all([loadCards(),loadSaved()])}).then(function(){afterAccount()},function(e){
    if(e.status!==401){toast(e.message)} state.auth=false; afterAccount();
  });
}
function afterAccount(){updateHeader();renderHome();renderWallet();if(state.tab==='profile')renderProfile();refreshMap()}

/* ---------- home ---------- */
function offerFeed(){
  var out=[]; nearList().forEach(function(c){c.offers.forEach(function(o){out.push({o:o,c:c})})}); return out;
}
function renderHome(){
  var s='';
  if(!state.auth)s+='<div class="hero"><span class="k">Loyalty cards</span><h3>Earn rewards at partner cafes</h3><p>Sign up with your mobile number. It takes under a minute.</p><button class="btn" data-act="profile">Sign up or log in</button></div>';
  var h=joined().filter(function(c){return c.stamps<c.goal}).sort(function(a,b){return b.stamps/b.goal-a.stamps/a.goal})[0];
  if(h)s+='<div class="hero hb pt-'+h.brand.pat+'" style="'+bvars(h.brand)+'"><span class="k">Closest reward</span><h3>'+esc(h.name)+'</h3>'+dots(h.stamps,h.goal)+
    '<p>'+(h.goal-h.stamps)+' more stamp'+(h.goal-h.stamps>1?'s':'')+' to earn: '+esc(h.reward)+'.</p><button class="btn" data-act="sheet" data-id="'+h.id+'">Show card</button></div>';
  if(!state.nearLoaded){
    s+='<div class="hero"><span class="k">Nearby</span><h3>Finding cafes near you…</h3><p>This takes a moment.</p></div>';
  } else if(state.nearErr){
    s+='<div class="hero"><span class="k">Nearby</span><h3>Couldn’t load cafes</h3><p>'+esc(state.nearErr)+'</p><button class="btn" data-act="retry">Try again</button></div>';
  } else {
    var near=nearList();
    if(!near.length){
      s+='<div class="hero"><span class="k">Nearby</span><h3>No partner cafes near you yet</h3><p>Partner cafes will appear here as they join Niro. Check again later.</p><button class="btn" data-act="retry">Check again</button></div>';
    } else {
      s+='<h2 class="sec">Nearby <small>'+near.length+' partner '+(near.length>1?'cafes':'cafe')+'</small></h2><div class="rail">';
      near.forEach(function(c){var hr=hoursOf(c);
        s+='<button class="near" data-act="pin" data-id="'+c.id+'"><span class="pic">'+photo(c)+(hr.open==null?'':'<span class="badge'+(hr.open?' open':'')+'"><i></i>'+(hr.open?'Open':'Closed')+'</span>')+'</span><span class="nt"><b>'+esc(c.name)+'</b><span class="m">'+esc(c.area)+' · '+fmt(distOf(c))+'</span></span></button>';
      });
      s+='</div>';
      var feed=offerFeed();
      s+='<h2 class="sec">Offers for you</h2><div class="offers">';
      if(!feed.length)s+='<div class="hero"><span class="k">No offers right now</span><p>Cafes add their offers here. Check back soon.</p></div>';
      feed.forEach(function(f){
        s+='<div class="offer"><div><b>'+esc(f.o.title)+'</b><small>'+esc(f.c.name)+' · '+esc(expText(f.o.ends_at))+'</small></div><button class="chip" data-act="save" data-id="'+f.o.id+'" aria-pressed="'+(!!state.saved[f.o.id])+'">'+(state.saved[f.o.id]?'Saved':'Save')+'</button></div>';
      });
      s+='</div>';
    }
  }
  $('#home').innerHTML=s;
}

/* ---------- wallet ---------- */
function renderWallet(){
  var list=joined(), s='';
  if(!list.length){
    $('#wallet').innerHTML='<h2 class="sec">Your cards</h2><div class="hero"><span class="k">'+(state.auth?'No cards yet':'Not signed in')+'</span><h3>'+(state.auth?'Join a partner cafe':'Sign up to get your cards')+'</h3><p>'+(state.auth?'Find a cafe on the map and tap Join Loyalty to start earning stamps.':'Join a cafe’s loyalty card and your stamps will show up here.')+'</p>'+(state.auth?'<button class="btn" data-tab="map">Open map</button>':'<button class="btn" data-act="profile">Sign up or log in</button>')+'</div>';
    return;
  }
  s='<h2 class="sec">Your cards <small>'+list.length+(list.length>1?' cafes':' cafe')+'</small></h2><div class="carousel" id="wscroll" tabindex="0" aria-label="Your loyalty cards, scroll to browse"><div class="track" id="wtrack"><div class="layer" id="wlayer">';
  list.forEach(function(c,i){
    var ready=c.stamps>=c.goal, b=c.brand;
    s+='<button class="wc pt-'+b.pat+'" style="'+bvars(b)+'" data-i="'+i+'" data-act="sheet" data-id="'+c.id+'" aria-label="'+esc(c.name)+', '+c.stamps+' of '+c.goal+' stamps">'+
      '<div class="wc-top"><div><b>'+esc(c.name)+'</b><small>'+esc(c.area)+'</small></div><div class="wc-r">'+(ready?'<span class="tag"><span>Reward ready</span></span>':'')+'<span class="mono">'+esc(initials(c.name))+'</span></div></div>'+
      '<div class="wc-bot">'+dots(c.stamps,c.goal)+'<div class="cnt">'+c.stamps+'<small>/ '+c.goal+'</small></div></div></button>';
  });
  s+='</div>';
  list.forEach(function(c,k){s+='<span class="snap" style="top:'+(k*WS.step)+'px"></span>'});
  s+='</div></div><p class="foot hint">Scroll to browse · tap the front card to show your QR</p>';
  $('#wallet').innerHTML=s;
  var sc=$('#wscroll');
  sc.addEventListener('scroll',function(){state.wi=Math.round(sc.scrollTop/WS.step);if(!wraf)wraf=requestAnimationFrame(function(){wraf=0;updateWallet()})});
  layoutWallet();
}
/* wallet carousel: one card always sits fully in the middle, the rest peek out above and below as stacks */
var WS={step:120,p:62,gap:10,h:204,A:0}, wraf=0;
function layoutWallet(){
  var sc=$('#wscroll'); if(!sc)return; var A=sc.clientHeight; if(!A)return;
  var n=sc.querySelectorAll('.wc').length; WS.A=A; WS.h=Math.min(204,A-24);
  $('#wtrack').style.height=(A+Math.max(0,n-1)*WS.step)+'px'; $('#wlayer').style.height=A+'px';
  sc.scrollTop=Math.min(state.wi||0,Math.max(0,n-1))*WS.step; updateWallet();
}
function updateWallet(){
  var sc=$('#wscroll'); if(!sc||!WS.A)return;
  var pos=sc.scrollTop/WS.step, ft=(WS.A-WS.h)/2, front=Math.round(pos);
  sc.querySelectorAll('.wc').forEach(function(el,i){
    var d=i-pos, y;
    if(d<0) y=ft+d*WS.p; else if(d<=1) y=ft+d*(WS.h+WS.gap); else y=ft+(WS.h+WS.gap)+(d-1)*WS.p;
    el.style.height=WS.h+'px'; el.style.transform='translateY('+y+'px)'; el.style.zIndex=i;
    el.setAttribute('aria-current',i===front?'true':'false');
  });
}

var X_ICON='<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5 5l14 14M19 5L5 19"/></svg>';
function closeSheet(){ $('#scrim').hidden=true; $('#scrim').classList.remove('center'); stopOtpWatch() }
function showSheet(html){$('#scrim').classList.remove('center');$('#sheet').innerHTML=html;$('#scrim').hidden=false;$('#sheet').scrollTop=0}
function sheetHead(t,p){return '<div class="grab"></div><div class="sh-head"><div><h3>'+t+'</h3>'+(p?'<p>'+p+'</p>':'')+'</div><button class="x" data-act="close" aria-label="Close">'+X_ICON+'</button></div>'}

/* the card: a real QR code of the member code, and the stamp history from the server */
function openSheet(id){
  var c=byId(id), b=c.brand, s='';
  $('#scrim').classList.remove('center');
  s+='<div class="grab"></div><div class="bn pt-'+b.pat+'" style="'+bvars(b)+'"><span class="mono">'+esc(initials(c.name))+'</span><div class="bn-t"><h3>'+esc(c.name)+'</h3><p>'+esc(c.area)+' · '+(c.stamps>=c.goal?'Reward ready':(c.goal-c.stamps)+' stamps to your next reward')+'</p></div><button class="x" data-act="close" aria-label="Close">'+X_ICON+'</button></div>';
  s+=QR.svg(c.mid,'Member QR code')+'<div class="mid">MEMBER '+esc(c.mid)+'</div>';
  s+='<div class="brand-scope" style="'+bvars(b)+'"><div class="grid8">';
  for(var i=0;i<c.goal;i++)s+='<div class="st'+(i<c.stamps?' on':'')+'">'+(i<c.stamps?'✓':(i+1))+'</div>';
  s+='</div></div><ul class="hist" id="hist"><li>Loading history…<span></span></li></ul>';
  $('#sheet').innerHTML=s; $('#scrim').hidden=false; $('#sheet').scrollTop=0;
  $('#sheet').querySelector('.x').focus();
  api('GET','/api/memberships/'+c.mem+'/history').then(function(d){
    var h=$('#hist'); if(!h)return; var rows='';
    d.events.slice(0,6).forEach(function(e){rows+='<li>'+esc(dayMon(e.created_at))+'<span>'+(e.kind==='redeem'?'Reward redeemed':'+'+e.qty+' stamp'+(e.qty>1?'s':''))+'</span></li>'});
    rows+='<li>'+esc(dayMon(d.joined_at))+'<span>Joined</span></li>';
    h.innerHTML=rows;
  }).catch(function(){var h=$('#hist');if(h)h.innerHTML='<li>History unavailable<span>Try again later</span></li>'});
}

/* join loyalty */
function openJoin(id){
  if(!state.auth){openAuth(id);return}
  var c=byId(id);
  showSheet(sheetHead('Join '+esc(c.name),'Collect '+c.goal+' stamps and earn: '+esc(c.reward)+'.')+
    '<form id="joinform" class="jf" data-id="'+id+'" novalidate><label class="chk" for="jc"><input type="checkbox" id="jc"><span>Send me offers from '+esc(c.name)+'</span></label>'+
    '<p class="err" id="jerr" hidden></p><button class="submit" type="submit">Join Loyalty</button><p class="fine">You can turn offers off any time in Profile.</p></form>');
}
function showJoined(id){
  var c=byId(id);
  $('#sheet').innerHTML='<div class="done"><div class="ok"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div><h3>You’re in!</h3><p>To start earning stamps, show your card at the counter when you pay at '+esc(c.name)+'.</p><div class="acts"><button class="s" data-act="close">Later</button><button class="p" data-act="sheet" data-id="'+id+'">Show my card</button></div></div>';
  $('#scrim').classList.add('center'); $('#scrim').hidden=false;
  $('#sheet').querySelector('.p').focus();
}
document.addEventListener('input',function(e){
  if(e.target.id==='ao'){e.target.value=e.target.value.replace(/\D/g,'').slice(0,6);return}
  if(e.target.id!=='ap')return;
  var d=e.target.value.replace(/\D/g,'').slice(0,10);
  e.target.value=d.length>5?d.slice(0,5)+' '+d.slice(5):d;
});
document.addEventListener('submit',function(e){
  if(e.target.id!=='joinform')return; e.preventDefault();
  var id=e.target.dataset.id, btn=e.target.querySelector('.submit'), er=$('#jerr'); btn.disabled=true; er.hidden=true;
  api('POST','/api/cafes/'+id+'/join',{offers:$('#jc').checked}).then(loadCards).then(function(){renderWallet();renderHome();refreshMap();showJoined(id)}).catch(function(x){btn.disabled=false;er.textContent=x.message;er.hidden=false});
});

/* ---------- the map: real OpenStreetMap pictures under our own pins ---------- */
var tiles={}, tileN=0, tileDark=null;
function darken(img){
  var c=document.createElement('canvas'); c.width=c.height=256; var x=c.getContext('2d');
  x.filter='invert(1) hue-rotate(180deg) brightness(.9) contrast(.9)'; x.drawImage(img,0,0); return c;
}
function tileImg(tx,ty,dark){
  if(tileDark!==dark){tileDark=dark;Object.keys(tiles).forEach(function(k){if(tiles[k].ok)tiles[k].src=dark?darken(tiles[k].img):tiles[k].img})}
  var k=tx+'/'+ty, t=tiles[k]; if(t)return t;
  if(tileN>600){tiles={};tileN=0}
  t=tiles[k]={ok:false,img:new Image(),src:null,g:null}; tileN++;
  t.img.onload=function(){t.src=dark?darken(t.img):t.img;t.ok=true;invalidate()}; t.img.onerror=function(){t.err=true};
  t.img.src='https://tile.openstreetmap.org/'+TZ+'/'+k+'.png'; return t;
}
var NT=Math.pow(2,TZ);
function tileLng(tx){return tx/NT*360-180}
function tileLat(ty){var n=Math.PI-2*Math.PI*ty/NT;return 180/Math.PI*Math.atan(0.5*(Math.exp(n)-Math.exp(-n)))}
function lngTile(lng){return Math.floor((lng+180)/360*NT)}
function latTile(lat){var r=lat*Math.PI/180;return Math.floor((1-Math.log(Math.tan(r)+1/Math.cos(r))/Math.PI)/2*NT)}

var cv=$('#mapcv'), ctx=null, W=0, H=0, DPR=1, cam={x:0,y:0}, vel={x:0,y:0}, drag=null, fly=null, raf=0, hits=[];
var ICON_C=new Path2D('M-6 -4h9v5a4.5 4.5 0 0 1-9 0zM3 -3h2a2.2 2.2 0 0 1 0 4.4H3');
var ICON_R=new Path2D('M-4.5 -7v5a2.5 2.5 0 0 0 5 0v-5M-2 -7v14M6 7v-14c-3.2 2-3.2 7.5 0 9.5');
var _C=null,_CK='';function colors(){var k=document.documentElement.getAttribute('data-theme')+isDark();if(_C&&_CK===k)return _C;_CK=k;return _C=colors0()}
function colors0(){var s=getComputedStyle(document.documentElement);function g(n){return s.getPropertyValue(n).trim()}
  return {land:g('--m-land'),ink:g('--ink'),bg:g('--bg'),you:g('--you')}}
function isDark(){var t=document.documentElement.getAttribute('data-theme');return t?t==='dark':(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches)}
function matches(c){var q=state.q.trim().toLowerCase();return !q||(c.name+' '+c.area+' '+c.kind).toLowerCase().indexOf(q)>-1}
function found(){return Object.keys(registry).map(byId).filter(matches).sort(function(a,b){return distOf(a)-distOf(b)}).slice(0,5)}

function draw(){
  if(!ctx||!W)return;
  var C=colors(), l=cam.x-W/2, t=cam.y-H/2, r=cam.x+W/2, b=cam.y+H/2;
  ctx.setTransform(DPR,0,0,DPR,0,0);
  ctx.fillStyle=C.land; ctx.fillRect(0,0,W,H);
  if(ORG){
    var tl=fromXY(l-256,t-256), br=fromXY(r+256,b+256), x0=lngTile(tl.lng), x1=lngTile(br.lng), y0=latTile(tl.lat), y1=latTile(br.lat), tx, ty;
    if((x1-x0+1)*(y1-y0+1)<=80){
      var dk=isDark(); ctx.imageSmoothingEnabled=true;
      for(ty=y0;ty<=y1;ty++)for(tx=x0;tx<=x1;tx++){
        var tt=tileImg(tx,ty,dk); if(!tt.ok)continue;
        if(!tt.g||tt.g.o!==ORG){var a=toXY(tileLat(ty),tileLng(tx)), z=toXY(tileLat(ty+1),tileLng(tx+1));tt.g={o:ORG,x:a.x,y:a.y,w:z.x-a.x+0.8,h:z.y-a.y+0.8}}
        ctx.drawImage(tt.src,tt.g.x-l-0.4,tt.g.y-t-0.4,tt.g.w,tt.g.h);
      }
    }
  }
  /* you are here */
  if(you.lat!=null){
    var ux=you.x-l, uy=you.y-t, ar=Math.max(12,Math.min(you.acc/M_PER_PX,90));
    ctx.fillStyle=C.you; ctx.globalAlpha=0.18; ctx.beginPath(); ctx.arc(ux,uy,ar,0,6.2832); ctx.fill(); ctx.globalAlpha=1;
    ctx.beginPath(); ctx.arc(ux,uy,9,0,6.2832); ctx.fillStyle=C.you; ctx.fill(); ctx.lineWidth=3; ctx.strokeStyle='#fff'; ctx.stroke();
  }
  hits=[];
  var pts=Object.keys(registry).map(byId);
  pts.sort(function(a,b){return (a.id===state.sel)-(b.id===state.sel)||a.y-b.y});
  pts.forEach(function(p){
    var sx=p.x-l, sy=p.y-t; if(sx<-30||sx>W+30||sy<-30||sy>H+30)return;
    drawPin(C,p,sx,sy,state.sel===p.id,!matches(p)); hits.push({p:p,x:sx,y:sy});
  });
}
function drawPin(C,p,x,y,sel,dim){
  ctx.save(); ctx.translate(x,y); var s=sel?1.3:1; ctx.scale(s,s); ctx.globalAlpha=dim?0.25:1;
  if(sel){ctx.shadowColor='rgba(0,0,0,.35)';ctx.shadowBlur=10;ctx.shadowOffsetY=3}
  ctx.beginPath(); ctx.arc(0,0,17,0,6.2832); ctx.fillStyle=p.joined?C.ink:C.bg; ctx.fill();
  ctx.shadowColor='transparent'; ctx.lineWidth=3; ctx.strokeStyle=p.joined?C.bg:C.ink; ctx.stroke();
  ctx.lineWidth=2; ctx.lineCap='round'; ctx.lineJoin='round'; ctx.stroke(p.kind==='Restaurant'?ICON_R:ICON_C);
  ctx.restore();
}
function invalidate(){ if(!raf) raf=requestAnimationFrame(frame) }
function updateArea(){$('#area').textContent=areaName()}
function areaName(){var p=state.place;return p?(p.locality||p.city||'Near you'):'Near you'}
function frame(now){
  raf=0; if(state.tab!=='map')return;
  var again=false;
  if(fly){var k=Math.min(1,(now-fly.t0)/fly.dur), e=1-Math.pow(1-k,3); cam.x=fly.sx+(fly.tx-fly.sx)*e; cam.y=fly.sy+(fly.ty-fly.sy)*e; if(k<1)again=true;else fly=null}
  else if(!drag&&(Math.abs(vel.x)>0.2||Math.abs(vel.y)>0.2)){cam.x+=vel.x;cam.y+=vel.y;vel.x*=0.94;vel.y*=0.94;again=true}
  draw(); if(again)invalidate();
}
function flyTo(x,y){fly={sx:cam.x,sy:cam.y,tx:x,ty:y,t0:performance.now(),dur:450};vel.x=vel.y=0;invalidate()}
function resizeMap(){
  var r=cv.getBoundingClientRect(); if(!r.width)return;
  DPR=Math.min(window.devicePixelRatio||1,2); W=r.width; H=r.height; cv.width=Math.round(W*DPR); cv.height=Math.round(H*DPR); ctx=cv.getContext('2d'); invalidate();
}
function tapAt(e){
  var r=cv.getBoundingClientRect(), px=e.clientX-r.left, py=e.clientY-r.top, best=null, bd=26;
  hits.forEach(function(h){var d=Math.hypot(h.x-px,h.y-py);if(d<bd){bd=d;best=h}});
  if(best){selectPlace(best.p.id)}
  else if(state.sel){state.sel=null;refreshMap()}
}
cv.addEventListener('pointerdown',function(e){
  cv.setPointerCapture(e.pointerId); drag={lx:e.clientX,ly:e.clientY,lt:performance.now(),moved:0}; vel.x=vel.y=0; fly=null;
});
cv.addEventListener('pointermove',function(e){
  if(!drag)return;
  var dx=e.clientX-drag.lx, dy=e.clientY-drag.ly, now=performance.now(), dt=Math.max(1,now-drag.lt);
  drag.moved+=Math.abs(dx)+Math.abs(dy); cam.x-=dx; cam.y-=dy;
  vel.x=vel.x*0.6+(-dx/dt*16)*0.4; vel.y=vel.y*0.6+(-dy/dt*16)*0.4;
  drag.lx=e.clientX; drag.ly=e.clientY; drag.lt=now; invalidate();
});
function endDrag(e){
  if(!drag)return; var moved=drag.moved; drag=null;
  if(moved<8){vel.x=vel.y=0;tapAt(e)} else invalidate();
}
cv.addEventListener('pointerup',endDrag);
cv.addEventListener('pointercancel',function(){drag=null;vel.x=vel.y=0});
cv.addEventListener('wheel',function(e){e.preventDefault();fly=null;cam.x+=e.deltaX;cam.y+=e.deltaY;invalidate()},{passive:false});
cv.addEventListener('keydown',function(e){
  var m={ArrowLeft:[-80,0],ArrowRight:[80,0],ArrowUp:[0,-80],ArrowDown:[0,80]}[e.key];
  if(m){e.preventDefault();flyTo(cam.x+m[0],cam.y+m[1])}
});
window.addEventListener('resize',function(){if(state.tab==='map')resizeMap();if(state.tab==='wallet')layoutWallet()});
try{window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change',invalidate)}catch(err){}

function selectPlace(id){
  state.sel=id; state.q=''; $('#q').value=''; state.route=null;
  var p=byId(id);
  if(state.tab!=='map')setTab('map'); else refreshMap();
  flyTo(p.x,p.y+90);
}
/* swipe the place card left or right to move to the next or previous nearby place */
var NEAR_N=12;
function swipeList(){return nearList().slice(0,NEAR_N)}
function pager(id){
  var l=swipeList(), i=l.findIndex(function(p){return p.id===id}); if(i<0)return '';
  return '<div class="pg" aria-hidden="true">'+l.map(function(p,k){return '<i'+(k===i?' class="on"':'')+'></i>'}).join('')+'</div>';
}
function swipePlace(dir){
  var l=swipeList(), i=l.findIndex(function(p){return p.id===state.sel}); if(i<0)i=dir>0?-1:l.length;
  var n=i+dir; if(n<0||n>=l.length){var pp=$('#dockin .pop'); if(pp){pp.classList.remove('bump');void pp.offsetWidth;pp.classList.add('bump')} return}
  selectPlace(l[n].id);
  var p=$('#dockin .pop'); if(p)p.classList.add(dir>0?'sl':'sr');
}
(function(){
  var dk=$('#dockin'), sx=0, sy=0, on=false, swiped=false;
  dk.addEventListener('pointerdown',function(e){if(!dk.querySelector('.acts'))return; on=true; swiped=false; sx=e.clientX; sy=e.clientY});
  function check(e){
    if(!on)return; var dx=e.clientX-sx, dy=e.clientY-sy;
    if(Math.abs(dx)>45&&Math.abs(dx)>Math.abs(dy)*1.3){on=false; swiped=true; swipePlace(dx<0?1:-1)}
  }
  dk.addEventListener('pointermove',check);
  dk.addEventListener('pointerup',function(e){check(e);on=false});
  dk.addEventListener('pointercancel',function(){on=false});
  dk.addEventListener('click',function(e){if(swiped){e.stopPropagation();e.preventDefault();swiped=false}},true);
})();
function refreshMap(){
  var cur=state.sel?byId(state.sel):null, any=state.q.trim()!=='', d=$('#dock'), h='';
  updateArea();
  if(state.tab==='map'){
    if(any){
      var res=found();
      h='<div class="pop"><div class="res">'+(res.length?res.map(function(c){return '<button data-act="pin" data-id="'+c.id+'"><b style="font-size:16px">'+esc(c.name)+'</b><span>'+c.kind+' · '+fmt(distOf(c))+'</span></button>'}).join(''):'<span style="padding:6px 4px">No cafe or restaurant matches that search.</span>')+'</div></div>';
    } else if(cur){
      var hr=hoursOf(cur);
      h='<div class="pop"><span class="pic wide">'+photo(cur)+'</span><div class="row">'+(hr.open==null?'':'<span class="badge'+(hr.open?' open':'')+'"><i></i>'+esc(hr.text)+'</span>')+'<span class="mt">'+cur.kind+' · '+fmt(distOf(cur))+'</span></div><b>'+esc(cur.name)+'</b><p>'+esc(offerOf(cur))+'</p>'+
        '<div class="acts">'+(cur.joined?'<button class="p" data-act="sheet" data-id="'+cur.id+'">Show Card</button>':'<button class="p" data-act="join" data-id="'+cur.id+'">Join Loyalty</button>')+
        '<button class="s" data-act="route" data-id="'+cur.id+'">Direction</button></div>'+pager(cur.id)+'</div>';
    }
  }
  d.hidden=!h; $('#dockin').innerHTML=h; invalidate();
}
function openDirections(c){
  window.open('https://www.google.com/maps/dir/?api=1&destination='+c.lat+','+c.lng+'&travelmode=walking','_blank','noopener');
}

var tabBusy=false;
function reduced(){try{return window.matchMedia('(prefers-reduced-motion: reduce)').matches}catch(e){return false}}
function avaCenter(){var r=$('#ava').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,w:r.width,h:r.height}}
/* a ring spreads out from the button, like the screen waking up */
function pulse(){
  if(reduced())return; var c=avaCenter(), d=document.createElement('div');
  d.style.cssText='position:fixed;left:'+(c.x-c.w/2)+'px;top:'+(c.y-c.h/2)+'px;width:'+c.w+'px;height:'+c.h+'px;border-radius:18px;border:2px solid var(--ink);pointer-events:none;z-index:60';
  document.body.appendChild(d);
  var a=d.animate([{transform:'scale(1)',opacity:.55},{transform:'scale(2.8)',opacity:0}],{duration:560,easing:'cubic-bezier(.2,.7,.2,1)'});
  a.onfinish=function(){d.remove()};
}
function circ(sc,c,r){var b=sc.getBoundingClientRect();return 'circle('+r+'px at '+(c.x-b.left)+'px '+(c.y-b.top)+'px)'}
function setTab(t){
  if(tabBusy)return;
  var from=state.tab, sc=$('#profile-screen'), R=Math.hypot(innerWidth,innerHeight)+40;
  if(reduced()||t===from){setTab0(t);return}
  if(from==='profile'){
    var c=avaCenter(); pulse(); tabBusy=true;
    var a=sc.animate({clipPath:[circ(sc,c,R),circ(sc,c,0)],opacity:[1,.6]},{duration:380,easing:'cubic-bezier(.5,0,.7,.3)',fill:'forwards'});
    a.onfinish=function(){tabBusy=false;setTab0(t);a.cancel()};
    return;
  }
  setTab0(t);
  if(t==='profile'){
    var c2=avaCenter(); pulse();
    sc.animate({clipPath:[circ(sc,c2,0),circ(sc,c2,R)],opacity:[.6,1]},{duration:560,easing:'cubic-bezier(.25,.8,.25,1)'});
  }
}
function setTab0(t){
  if(t==='profile'&&state.tab!=='profile')state.prev=state.tab;
  state.tab=t;
  ['home','wallet','map','profile'].forEach(function(n){$('#'+n+'-screen').hidden=(n!==t)});
  document.querySelectorAll('.nb').forEach(function(b){b.setAttribute('aria-current',b.dataset.tab===t?'page':'false')});
  $('#nav').classList.toggle('mapmode',t==='map');
  $('.nmid').setAttribute('aria-current',t==='map'?'page':'false');
  $('#top').classList.toggle('over',t==='map');
  if(t!=='map'){state.q='';$('#q').value=''}
  if(t==='home')renderHome(); if(t==='wallet')renderWallet(); if(t==='profile')renderProfile(); updateHeader();
  if(t==='map')resizeMap();
  refreshMap();
}

/* ---------- taps ---------- */
function saveOffer(id){
  if(!state.auth){openAuth('');return}
  var on=!state.saved[id]; state.saved[id]=on; renderHome();
  api(on?'POST':'DELETE','/api/saved-offers/'+id).then(loadSaved).then(function(){if(state.tab==='profile')renderProfile()}).catch(function(e){state.saved[id]=!on;renderHome();toast(e.message)});
}
function setPref(key,val){
  var old=state.prefs[key]; state.prefs[key]=val; renderProfile();
  var p={}; p[key]=val;
  api('PATCH','/api/me',{prefs:p}).catch(function(e){state.prefs[key]=old;renderProfile();toast(e.message)});
}
document.addEventListener('click',function(e){
  var wcEl=e.target.closest('.wc');
  if(wcEl){var sc=$('#wscroll'), wi=+wcEl.dataset.i; if(Math.round(sc.scrollTop/WS.step)!==wi){sc.scrollTo({top:wi*WS.step,behavior:'smooth'});return}}
  var tb=e.target.closest('[data-tab]');
  if(tb){setTab(tb.dataset.tab); return}
  var a=e.target.closest('[data-act]');
  if(a){
    var id=a.dataset.id, act=a.dataset.act;
    if(act==='sheet')openSheet(id);
    else if(act==='close')closeSheet();
    else if(act==='pin')selectPlace(id);
    else if(act==='save')saveOffer(id);
    else if(act==='savedgo')openSaved();
    else if(act==='unsave'){state.saved[id]=false;api('DELETE','/api/saved-offers/'+id).then(loadSaved).then(function(){renderHome();renderProfile();openSaved()}).catch(function(x){toast(x.message)})}
    else if(act==='join')openJoin(id);
    else if(act==='route'){var q=byId(id); if(q)openDirections(q)}
    else if(act==='recenter'){if(you.lat!=null)flyTo(you.x,you.y)}
    else if(act==='geodir'){closeSheet();var g=byId(id);if(g)openDirections(g)}
    else if(act==='retry'){state.nearLoaded=false;state.nearErr='';renderHome();loadNearby()}
    else if(act==='loc')openLoc();
    else if(act==='detect')detect(true);
    else if(act==='profile'){if(state.auth)setTab('profile');else openAuth('')}
    else if(act==='authback'){stopOtpWatch();openAuth(state.pend)}
    else if(act==='quickauth'){var sa=savedAcct();if(sa){state.me.name=sa.name;state.me.phone=sa.phone;sendCode(true)}}
    else if(act==='resend')sendCode(false,true);
    else if(act==='back')setTab(state.prev||'home');
    else if(act==='tgl')setPref(id,!state.prefs[id]);
    else if(act==='cafeoffer'){var q2=byId(id);if(q2){var nv=!q2.optin;q2.optin=nv;renderProfile();api('PATCH','/api/memberships/'+q2.mem,{offers:nv}).catch(function(x){q2.optin=!nv;renderProfile();toast(x.message)})}}
    else if(act==='toast')toast(a.dataset.msg);
    else if(act==='theme')setTheme(id);
    else if(act==='edit')openEdit();
    else if(act==='photo')$('#ep').click();
    else if(act==='rmphoto'){edP='';edPDirty=true;paintPv()}
    else if(act==='adddate'){syncD();if(edD.length<5){edD.push({l:'',d:''});$('#sd').innerHTML=dRows();paintAdd()}}
    else if(act==='rmdate'){syncD();edD.splice(+id,1);$('#sd').innerHTML=dRows();paintAdd()}
    else if(act==='del')openConfirm('del');
    else if(act==='logout')openConfirm('out');
    else if(act==='confirm')confirmAction(id);
    else if(act==='download')downloadData();
    else if(act==='legal')openLegal();
    else if(act==='support')openSupport();
    else if(act==='go'){location.assign(a.dataset.href)}
    return;
  }
  if(e.target===$('#scrim'))closeSheet();
});
document.addEventListener('keydown',function(e){ if(e.key==='Escape')closeSheet() });
$('#q').addEventListener('input',function(e){state.q=e.target.value;refreshMap()});

/* ---------- location: the phone's real position ---------- */
function setLoc(name,busy){$('#locname').textContent=name;$('#loc').classList.toggle('busy',!!busy)}
function permLabel(){return state.perm==='granted'?'Allowed':state.perm==='denied'?'Blocked':state.perm==='prompt'?'Ask each time':(you.lat!=null?'Allowed':'Unknown')}
function watchPerm(){
  try{navigator.permissions.query({name:'geolocation'}).then(function(s){state.perm=s.state;s.onchange=function(){state.perm=s.state;if(state.tab==='profile')renderProfile()};if(state.tab==='profile')renderProfile()}).catch(function(){})}catch(e){}
}
var lastGeocode=null;
function lookupPlace(){
  if(you.lat==null)return;
  if(lastGeocode&&hav(lastGeocode.lat,lastGeocode.lng,you.lat,you.lng)<400)return;
  lastGeocode={lat:you.lat,lng:you.lng};
  api('GET','/api/geo/reverse?lat='+you.lat.toFixed(4)+'&lng='+you.lng.toFixed(4)).then(function(p){state.place=p;setLoc(p.locality||p.city||'Near you',false);updateArea();if(state.tab==='profile')renderProfile()}).catch(function(){setLoc('Near you',false)});
}
function onFix(pos,first){
  var la=pos.coords.latitude, ln=pos.coords.longitude;
  if(!ORG)rebase(la,ln); else if(hav(ORG.lat,ORG.lng,la,ln)>40000){rebase(la,ln);cam.x=cam.y=0}
  var p=toXY(la,ln); you.x=p.x; you.y=p.y; you.lat=la; you.lng=ln; you.acc=pos.coords.accuracy||0;
  state.pos={lat:la,lng:ln};
  if(first){cam.x=you.x;cam.y=you.y}
  lookupPlace();
  if(state.nearLoaded&&(!state.nearAt||hav(state.nearAt.lat,state.nearAt.lng,la,ln)>1500))loadNearby();
  geoCheck(); invalidate(); if(state.tab==='home'&&state.nearLoaded)renderHome();
}
function detect(manual){
  closeSheet(); setLoc('Locating…',true);
  if(!navigator.geolocation){setLoc('Near you',false);return}
  navigator.geolocation.getCurrentPosition(function(p){onFix(p,false);if(manual){flyTo(you.x,you.y);toast('Location updated')}},function(e){setLoc(areaName(),false);toast(e&&e.code===1?'Location is blocked. Allow it in your browser settings.':'Could not get your location.')},{enableHighAccuracy:true,timeout:15000,maximumAge:0});
}
function openLoc(){
  var p=state.place, blocked=state.perm==='denied';
  showSheet(sheetHead('Your location','Read from your phone’s GPS while Niro is open.')+
    '<div class="grp" style="margin-top:12px"><div class="pr"><span class="pt">Area</span><span class="pv">'+esc(p&&p.label?p.label:(you.lat!=null?'Looking up…':'Unknown'))+'</span></div>'+
    '<div class="pr"><span class="pt">Position</span><span class="pv">'+(you.lat!=null?you.lat.toFixed(4)+', '+you.lng.toFixed(4):'Not available')+'</span></div>'+
    '<div class="pr"><span class="pt">Accuracy</span><span class="pv">'+(you.lat!=null&&you.acc?'about '+Math.round(you.acc)+' m':'Not available')+'</span></div>'+
    '<div class="pr"><span class="pt">Permission</span><span class="pv">'+permLabel()+'</span></div></div>'+
    (blocked?'<p class="fine" style="margin-top:12px">Location is blocked for this site. Tap the lock icon next to the address bar, set Location to Allow, then tap Update.</p>':'')+
    '<div class="acts" style="margin-top:16px"><button class="p" data-act="detect">Update my location</button></div>');
}

/* ---------- nearby alerts: a real check against your real position, limited by the server to 2 a day ---------- */
var lastIn={};
function todayKey(){return 'cl-geo-'+istNow().toISOString().slice(0,10)}
function askedToday(id){try{return (JSON.parse(localStorage.getItem(todayKey())||'[]')).indexOf(id)>-1}catch(e){return false}}
function markAsked(id){try{var l=JSON.parse(localStorage.getItem(todayKey())||'[]');l.push(id);localStorage.setItem(todayKey(),JSON.stringify(l))}catch(e){}}
function geoCheck(){
  if(!state.auth||!state.prefs.geo||you.lat==null)return;
  nearList().forEach(function(c){
    var inside=distOf(c)<=GEO_R;
    if(inside&&!lastIn[c.id]&&!askedToday(c.id)&&$('#scrim').hidden){
      markAsked(c.id);
      api('POST','/api/geo-alerts',{cafe_id:c.id}).then(function(r){
        state.geo.used=r.used||state.geo.used;
        if(r.allowed&&$('#scrim').hidden)showGeoPopup(c);
      }).catch(function(){});
    }
    lastIn[c.id]=inside;
  });
}
function showGeoPopup(c){
  var b=c.brand;
  showSheet('<div class="geo"><div class="bn pt-'+b.pat+'" style="'+bvars(b)+'"><span class="mono">'+esc(initials(c.name))+'</span><div class="bn-t"><h3>'+esc(c.name)+'</h3><p>You’re '+fmt(distOf(c))+' away</p></div><button class="x" data-act="close" aria-label="Dismiss">'+X_ICON+'</button></div>'+
    '<p class="gp">'+esc(offerOf(c))+'</p><p class="gc">Nearby alert '+state.geo.used+' of '+state.geo.cap+' today</p>'+
    '<div class="acts">'+(c.joined?'<button class="p" data-act="sheet" data-id="'+c.id+'">Show Card</button>':'<button class="p" data-act="join" data-id="'+c.id+'">Join Loyalty</button>')+'<button class="s" data-act="geodir" data-id="'+c.id+'">Direction</button></div></div>');
  $('#scrim').classList.add('center');
}
function startWatch(){
  if(!navigator.geolocation)return;
  navigator.geolocation.watchPosition(function(p){onFix(p,false)},function(){},{enableHighAccuracy:true,maximumAge:10000,timeout:30000});
}

/* ---------- cafe look ---------- */
/* Each cafe's own colours come from the database. A cafe with photos shows its first photo; otherwise a storefront drawn in its colours. */
function hs(str,s){var h=2166136261^s;for(var i=0;i<str.length;i++){h^=str.charCodeAt(i);h=Math.imul(h,16777619)}return ((h>>>0)%1000)/1000}
function photo(c){
  var ph=safeImg(c.photos&&c.photos[0]);
  if(ph)return '<img src="'+esc(ph)+'" alt="Photo of '+esc(c.name)+'" style="width:100%;height:100%;object-fit:cover" loading="lazy">';
  var b=c.brand, v=hs(c.id,5), v2=hs(c.id,9), rest=c.kind==='Restaurant', i, s='', n=6, aw='';
  for(i=0;i<n;i++)aw+='<rect x="'+(34+i*26.7)+'" y="30" width="26.8" height="16" fill="'+(i%2?b.ink:b.acc)+'"/>';
  var left=v>0.5, px=left?18:190;
  s+='<svg viewBox="0 0 224 108" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Illustration of '+esc(c.name)+'">';
  s+='<rect width="224" height="108" fill="'+b.acc+'"/><rect width="224" height="108" fill="#fff" opacity=".38"/>';
  s+='<circle cx="'+(v2>0.5?30:196)+'" cy="20" r="11" fill="#fff" opacity=".7"/>';
  s+='<rect x="26" y="26" width="172" height="70" fill="'+b.bg+'"/>';
  s+='<rect x="26" y="20" width="172" height="12" fill="'+b.bg+'"/><rect x="48" y="9" width="128" height="19" rx="4" fill="'+b.ink+'"/>';
  s+='<text x="112" y="23" text-anchor="middle" font-size="12" font-weight="800" letter-spacing="1.5" fill="'+b.bg+'" font-family="system-ui,sans-serif">'+esc(initials(c.name))+(rest?' · KITCHEN':' · CAFE')+'</text>';
  s+=aw;
  s+='<rect x="42" y="52" width="76" height="40" rx="3" fill="#ffe3a3"/><rect x="42" y="52" width="76" height="40" rx="3" fill="none" stroke="'+b.ink+'" stroke-width="2"/><path d="M80 52v40M42 72h76" stroke="'+b.ink+'" stroke-width="1.5" opacity=".7"/>';
  if(rest){s+='<path d="M54 52v8M96 52v8" stroke="'+b.ink+'" stroke-width="1.5"/><ellipse cx="54" cy="64" rx="7" ry="4" fill="'+b.acc+'"/><ellipse cx="96" cy="64" rx="7" ry="4" fill="'+b.acc+'"/>';}
  else{s+='<path d="M52 92v-11h16v11z" fill="'+b.bg+'" opacity=".85"/><path d="M68 84h4a3 3 0 0 1 0 6h-4" fill="none" stroke="'+b.bg+'" stroke-width="1.6" opacity=".85"/><path d="M56 78c-2-3 2-4 0-7M62 78c-2-3 2-4 0-7" fill="none" stroke="'+b.bg+'" stroke-width="1.4" opacity=".6"/>';}
  s+='<rect x="136" y="52" width="46" height="44" rx="3" fill="'+b.ink+'" opacity=".92"/><circle cx="174" cy="76" r="2.2" fill="'+b.bg+'"/><rect x="144" y="60" width="30" height="10" rx="2" fill="'+b.acc+'"/>';
  s+='<rect x="0" y="92" width="224" height="16" fill="'+b.bg+'" opacity=".92"/><rect x="0" y="92" width="224" height="2" fill="'+b.ink+'" opacity=".25"/>';
  s+='<rect x="'+(px-5)+'" y="80" width="10" height="12" rx="2" fill="'+b.ink+'"/><circle cx="'+px+'" cy="76" r="8" fill="#5da56a"/><circle cx="'+(px-5)+'" cy="81" r="5" fill="#4a8f58"/><circle cx="'+(px+5)+'" cy="81" r="5" fill="#4a8f58"/>';
  return s+'</svg>';
}

/* ---------- profile ---------- */
var USER_ICON='<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/></svg>';
function updateHeader(){
  var p=state.tab==='profile', a=$('#ava');
  $('#top').classList.toggle('prof',p);
  $('#hi').textContent=p?'Profile':(state.auth?'Hi, '+state.me.name:greet());
  a.dataset.act=p?'back':'profile'; a.setAttribute('aria-label',p?'Close profile':(state.auth?'Profile':'Sign up or log in'));
  a.innerHTML=p?X_ICON:(!state.auth?USER_ICON:safeImg(state.me.photo)?'<img src="'+esc(safeImg(state.me.photo))+'" alt="">':esc(state.me.name.charAt(0).toUpperCase()));
}
setInterval(function(){if(!state.auth&&state.tab!=='profile')updateHeader()},60000);
var toastT=0;
function toast(msg){var t=$('#toast');t.textContent=msg;t.hidden=false;clearTimeout(toastT);toastT=setTimeout(function(){t.hidden=true},2800)}
var CHV='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';
function sw(on,act,id,label,dis){return '<button class="sw" role="switch" aria-checked="'+on+'" aria-label="'+esc(label)+'" data-act="'+act+'" data-id="'+id+'"'+(dis?' disabled':'')+'><i></i></button>'}
function swRow(title,sub,on,key){return '<div class="pr"><span class="pt">'+title+(sub?'<small>'+sub+'</small>':'')+'</span>'+sw(on,'tgl',key,title,false)+'</div>'}
function navRow(title,right,attrs){return '<button class="pr" '+attrs+'><span class="pt">'+title+'</span><span class="pv">'+right+CHV+'</span></button>'}
function openSaved(){
  var sv=state.savedList||[];
  showSheet(sheetHead('Saved offers',sv.length?'Offers you saved from partner cafes.':'Nothing saved yet. Tap Save on an offer on the Home screen.')+
    sv.map(function(o){return '<div class="offer"><div><b>'+esc(o.title)+'</b><small>'+esc(o.cafe_name)+' · '+esc(expText(o.ends_at))+'</small></div><button class="chip" data-act="unsave" data-id="'+esc(o.id)+'">Remove</button></div>'}).join(''));
}
function renderProfile(){
  if(!state.auth){$('#profile').innerHTML='<div class="hero"><span class="k">Profile</span><h3>Sign up or log in</h3><p>Your cards, saved offers and settings live in your account.</p><button class="btn" data-act="profile">Sign up or log in</button></div>';return}
  var list=joined(), m=state.me, off=!state.prefs.offers;
  var stamps=list.reduce(function(a,c){return a+c.stamps},0), ready=list.filter(function(c){return c.stamps>=c.goal}).length;
  var ph=m.phone?'+91 ••••• •••'+m.phone.slice(-2):'+91 ••••• •••••';
  var s='<div class="me"><div class="mav">'+(safeImg(m.photo)?'<img src="'+esc(safeImg(m.photo))+'" alt="">':esc(m.name.charAt(0).toUpperCase()))+'</div><div class="mt2"><h2>'+esc(m.name)+'</h2><p>'+ph+' · verified</p></div><button class="edit" data-act="edit">Edit</button></div>';
  s+='<div class="stats"><div><b>'+list.length+'</b><span>Cards</span></div><div><b>'+stamps+'</b><span>Stamps</span></div><div><b>'+ready+'</b><span>Rewards ready</span></div></div>';
  var sd=[]; if(m.birthday)sd.push({l:'Birthday',d:m.birthday}); (m.dates||[]).forEach(function(x){sd.push({l:x.l,d:x.d})});
  sd.forEach(function(x){x.n=inDays(x.d)}); sd.sort(function(a,b){return a.n-b.n});
  var nsv=(state.savedList||[]).length;
  s+='<h3 class="gh">Offers</h3><div class="grp">'+navRow('Saved offers',nsv?String(nsv):'None yet','data-act="savedgo"')+'</div>';
  s+='<h3 class="gh">Special days</h3><div class="grp">'+(sd.length?sd.map(function(x){return '<div class="pr"><span class="pt">'+esc(x.l)+'<small>'+dm(x.d)+'</small></span><span class="pv">'+inTxt(x.n)+'</span></div>'}).join('')+navRow('Add or edit dates','','data-act="edit"'):navRow('Add your birthday and special dates','','data-act="edit"'))+
    swRow('Treats on special days','Cafes you joined may send you a treat',state.prefs.treats,'treats')+'</div>';
  var ab=[]; if(m.email)ab.push(['Email',m.email]); if(m.diet)ab.push(['Food preference',m.diet]); if(m.fav)ab.push(['Usual order',m.fav]);
  if(ab.length)s+='<h3 class="gh">About you</h3><div class="grp">'+ab.map(function(r){return '<div class="pr"><span class="pt">'+esc(r[0])+'</span><span class="pv">'+esc(r[1])+'</span></div>'}).join('')+'</div>';
  s+='<h3 class="gh">Appearance</h3><div class="grp pad"><div class="seg" role="radiogroup" aria-label="Theme">'+[['system','System'],['light','Light'],['dark','Dark']].map(function(o){return '<button role="radio" aria-checked="'+(state.theme===o[0])+'" data-act="theme" data-id="'+o[0]+'">'+o[1]+'</button>'}).join('')+'</div></div>';
  s+='<h3 class="gh">Notifications</h3><div class="grp">'+swRow('Stamps and rewards','When you earn a stamp or a reward is ready',state.prefs.stamps,'stamps')+swRow('Offers from cafes','Deals from the cafes you joined',state.prefs.offers,'offers')+'</div>';
  if(list.length){
    s+='<h3 class="gh">Offers by cafe</h3><div class="grp">';
    list.forEach(function(c){s+='<div class="pr'+(off?' off':'')+'"><span class="pt">'+esc(c.name)+'<small>'+esc(c.area)+'</small></span>'+sw(c.optin!==false,'cafeoffer',c.id,'Offers from '+c.name,off)+'</div>'});
    s+='</div>';
  }
  s+='<h3 class="gh">Nearby alerts</h3><div class="grp">'+swRow('Nearby cafe alerts','A popup when you pass a partner cafe, up to '+state.geo.cap+' a day. Works while Niro is open.',state.prefs.geo,'geo')+
    '<div class="pr"><span class="pt">Popups today</span><span class="pv">'+state.geo.used+' of '+state.geo.cap+'</span></div></div>';
  s+='<h3 class="gh">Location</h3><div class="grp">'+navRow('Current location',esc(state.place&&(state.place.locality||state.place.city)||(you.lat!=null?'Near you':'Not available')),'data-act="loc"')+navRow('Nearby cafes',permLabel(),'data-act="loc"')+'</div>';
  s+='<h3 class="gh">Privacy</h3><div class="grp">'+navRow('Download my data','','data-act="download"')+navRow('Delete my data','','data-act="del"')+'</div>';
  s+='<h3 class="gh">Help</h3><div class="grp">'+navRow('Help centre','','data-act="go" data-href="/help.html"')+navRow('Contact support','','data-act="support"')+navRow('Terms and privacy policy','','data-act="legal"')+'</div>';
  if(state.admin)s+='<h3 class="gh">Admin</h3><div class="grp">'+navRow('Manage cafes','','data-act="go" data-href="/admin.html"')+'</div>';
  s+='<button class="logout" data-act="logout">Log out</button><p class="foot" style="text-align:center">Niro</p>';
  $('#profile').innerHTML=s;
}
var edP='', edPDirty=false, edD=[];
function pd(s){var p=s.split('-');return new Date(+p[0],+p[1]-1,+p[2])}
function dm(s){var d=pd(s);return d.getDate()+' '+MON[d.getMonth()]}
function inDays(s){var d=pd(s),n=new Date(),t=new Date(n.getFullYear(),n.getMonth(),n.getDate()),x=new Date(t.getFullYear(),d.getMonth(),d.getDate());if(x<t)x=new Date(t.getFullYear()+1,d.getMonth(),d.getDate());return Math.round((x-t)/864e5)}
function inTxt(n){return n===0?'Today':n===1?'Tomorrow':'in '+n+' days'}
function todayISO(){var n=new Date();return n.getFullYear()+'-'+String(n.getMonth()+1).padStart(2,'0')+'-'+String(n.getDate()).padStart(2,'0')}
function dRows(){return edD.map(function(d,i){return '<div class="dr"><input class="dl" type="text" placeholder="e.g. Anniversary" maxlength="24" value="'+esc(d.l)+'" aria-label="Name of special day"><input class="dd" type="date" value="'+esc(d.d)+'" aria-label="Date"><button type="button" class="x" data-act="rmdate" data-id="'+i+'" aria-label="Remove date">'+X_ICON+'</button></div>'}).join('')}
function syncD(){var rows=document.querySelectorAll('#sd .dr');edD=[].map.call(rows,function(r){return {l:r.querySelector('.dl').value,d:r.querySelector('.dd').value}})}
function paintAdd(){var b=$('#addd');if(b)b.hidden=edD.length>=5}
function paintPv(){var v=$('#epv');if(!v)return;v.innerHTML=safeImg(edP)?'<img src="'+esc(safeImg(edP))+'" alt="Your photo">':esc(($('#en').value.trim()||state.me.name).charAt(0).toUpperCase());var r=$('#rmp');if(r)r.hidden=!edP}
function openEdit(){
  var m=state.me; edP=m.photo||''; edPDirty=false; edD=(m.dates||[]).map(function(d){return {l:d.l,d:d.d}});
  var diets=['','Vegetarian','Eggetarian','Non-vegetarian','Vegan'];
  showSheet(sheetHead('Edit profile','Your mobile number is verified and can’t be changed here.')+
    '<form id="editform" class="jf" novalidate>'+
    (state.photosOn?'<div class="phr"><div class="mav big" id="epv"></div><div class="phb"><button type="button" class="s" data-act="photo">Change photo</button><button type="button" class="s" id="rmp" data-act="rmphoto" hidden>Remove</button></div><input id="ep" type="file" accept="image/jpeg,image/png,image/webp" hidden></div>':'')+
    '<label for="en">Name</label><input id="en" type="text" autocomplete="given-name" maxlength="60" value="'+esc(m.name)+'"><p class="err" id="eerr" hidden>Enter your name to continue.</p>'+
    '<label for="eb">Birthday</label><input id="eb" type="date" max="'+todayISO()+'" value="'+esc(m.birthday)+'"><p class="hint">Cafes can send you a treat on the day. Only day and month are shown.</p>'+
    '<label for="em">Email (optional)</label><input id="em" type="email" autocomplete="email" maxlength="120" placeholder="you@example.com" value="'+esc(m.email)+'"><p class="err" id="mer" hidden>Enter a valid email address.</p>'+
    '<label>Special days</label><div id="sd">'+dRows()+'</div><button type="button" class="addd" id="addd" data-act="adddate">+ Add a special day</button>'+
    '<label for="ed">Food preference</label><select id="ed">'+diets.map(function(x){return '<option value="'+x+'"'+(m.diet===x?' selected':'')+'>'+(x||'Not set')+'</option>'}).join('')+'</select>'+
    '<label for="ef">Usual order (optional)</label><input id="ef" type="text" maxlength="40" placeholder="e.g. Oat flat white" value="'+esc(m.fav)+'">'+
    '<p class="err" id="eserr" hidden></p><button class="submit" type="submit">Save</button></form>');
  paintPv(); paintAdd();
}
document.addEventListener('change',function(e){
  if(e.target.id!=='ep')return; var f=e.target.files&&e.target.files[0]; if(!f)return;
  if(!/^image\/(png|jpeg|webp)$/.test(f.type)){toast('Choose a JPEG, PNG or WebP photo');return}
  var fr=new FileReader();
  fr.onload=function(){var img=new Image();img.onload=function(){var s=256,c=document.createElement('canvas');c.width=c.height=s;var k=Math.min(img.width,img.height);c.getContext('2d').drawImage(img,(img.width-k)/2,(img.height-k)/2,k,k,0,0,s,s);edP=c.toDataURL('image/jpeg',0.85);edPDirty=true;paintPv()};img.onerror=function(){toast('Could not read that image')};img.src=fr.result};
  fr.readAsDataURL(f);
});
document.addEventListener('input',function(e){if(e.target.id==='en'&&!edP)paintPv()});
document.addEventListener('submit',function(e){
  if(e.target.id!=='editform')return; e.preventDefault();
  var v=$('#en').value.trim(); $('#eerr').hidden=!!v; if(!v){$('#en').focus();return}
  var em=$('#em').value.trim(), okm=!em||/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em); $('#mer').hidden=okm; if(!okm){$('#em').focus();return}
  syncD(); var btn=e.target.querySelector('.submit'), er=$('#eserr'); btn.disabled=true; er.hidden=true;
  var dates=edD.filter(function(d){return d.d}).map(function(d){return {label:d.l.trim()||'Special day',on_date:d.d}});
  var p=api('PATCH','/api/me',{name:v,birthday:$('#eb').value||null,email:em||null,diet:$('#ed').value||null,fav_order:$('#ef').value.trim()||null})
    .then(function(){return api('PUT','/api/me/special-dates',{dates:dates})});
  if(edPDirty&&state.photosOn){
    p=p.then(function(){
      if(!edP)return api('DELETE','/api/me/photo');
      return fetch(edP).then(function(r){return r.blob()}).then(function(b){return fetch('/api/me/photo',{method:'PUT',credentials:'same-origin',headers:{'content-type':'image/jpeg'},body:b}).then(function(r){if(!r.ok)throw new Error('Could not save the photo.')})});
    });
  }
  p.then(function(){return api('GET','/api/me')}).then(function(m){applyMe(m);updateHeader();closeSheet();renderProfile();toast('Saved')}).catch(function(x){btn.disabled=false;er.textContent=x.message;er.hidden=false});
});

/* delete, log out, download, help */
function openConfirm(kind){
  var d=kind==='del';
  showSheet(sheetHead(d?'Delete your data?':'Log out?',d?'This removes your account, cards and stamps for good. It can’t be undone.':'You will need your mobile number to sign back in.')+
    '<p class="err" id="cferr" hidden></p><div class="acts" style="margin-top:20px"><button class="s" data-act="close">Cancel</button><button class="p" id="cfgo" data-act="confirm" data-id="'+kind+'">'+(d?'Delete my data':'Log out')+'</button></div>');
}
function confirmAction(kind){
  var b=$('#cfgo'); if(b)b.disabled=true;
  api(kind==='del'?'DELETE':'POST',kind==='del'?'/api/me':'/api/auth/logout').then(function(){closeSheet();signOut();toast(kind==='del'?'Your data was deleted':'Logged out')}).catch(function(e){if(b)b.disabled=false;var er=$('#cferr');if(er){er.textContent=e.message;er.hidden=false}});
}
function downloadData(){
  api('GET','/api/me/export').then(function(d){
    var blob=new Blob([JSON.stringify(d,null,2)],{type:'application/json'}), a=document.createElement('a');
    a.href=URL.createObjectURL(blob); a.download='niro-my-data.json'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function(){URL.revokeObjectURL(a.href)},5000); toast('Your data file was saved');
  }).catch(function(e){toast(e.message)});
}
function openLegal(){
  showSheet(sheetHead('Terms and privacy','The rules and how we handle your data.')+
    '<div class="grp" style="margin-top:12px">'+navRow('Terms of use','','data-act="go" data-href="/terms.html"')+navRow('Privacy policy','','data-act="go" data-href="/privacy.html"')+'</div>');
}
function openSupport(){
  var m=state.me;
  showSheet(sheetHead('Contact support','Tell us what happened. We will reply as soon as we can.')+
    '<form id="supportform" class="jf" novalidate><label for="sm">Message</label><textarea id="sm" rows="5" maxlength="1000" placeholder="How can we help?" style="width:100%;font:inherit;padding:12px 14px;border-radius:14px;border:1px solid var(--line);background:var(--card);color:var(--ink);resize:vertical"></textarea>'+
    '<label for="sc">'+(state.auth?'Phone or email to reply on':'Your phone or email')+'</label><input id="sc" type="text" maxlength="120" autocomplete="email" placeholder="98765 43210 or you@example.com" value="'+esc(state.auth?(m.email||m.phone):'')+'">'+
    '<p class="err" id="sserr" hidden></p><button class="submit" type="submit">Send message</button></form>');
}
document.addEventListener('submit',function(e){
  if(e.target.id!=='supportform')return; e.preventDefault();
  var msg=$('#sm').value.trim(), ct=$('#sc').value.trim(), er=$('#sserr'), btn=e.target.querySelector('.submit'); er.hidden=true;
  if(msg.length<5){er.textContent='Write a little more so we can help.';er.hidden=false;$('#sm').focus();return}
  btn.disabled=true;
  api('POST','/api/support',{message:msg,contact:ct||undefined}).then(function(){
    $('#sheet').innerHTML='<div class="done"><div class="ok"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div><h3>Message sent</h3><p>Thanks. We will get back to you as soon as we can.</p><div class="acts"><button class="p" data-act="close">Done</button></div></div>';
    $('#scrim').classList.add('center');
  }).catch(function(x){btn.disabled=false;er.textContent=x.message;er.hidden=false});
});

/* ---------- sign up / log in (name, mobile number, OTP by SMS) ---------- */
var otpT=0, otpAbort=null;
function savedAcct(){try{var a=JSON.parse(localStorage.getItem('cl-acct')||'null');return a&&a.name&&/^\d{10}$/.test(a.phone)?a:null}catch(e){return null}}
function saveAcct(){try{localStorage.setItem('cl-acct',JSON.stringify({name:state.me.name,phone:state.me.phone}))}catch(e){}}
function stopOtpWatch(){clearInterval(otpT);if(otpAbort){try{otpAbort.abort()}catch(e){}otpAbort=null}}
function openAuth(pend){
  state.pend=pend||''; var sv=savedAcct();
  showSheet(sheetHead('Sign up or log in','Enter your name and mobile number. We’ll text you a code to confirm it.')+
    (sv?'<button type="button" class="qa" data-act="quickauth"><span class="qav">'+esc(sv.name.charAt(0).toUpperCase())+'</span><span class="qat"><b>Continue as '+esc(sv.name)+'</b><small>+91 '+esc(sv.phone.slice(0,5))+' •••'+esc(sv.phone.slice(-2))+'</small></span>'+CHV+'</button><p class="or">or use a different number</p>':'')+
    '<form id="authform" class="jf" novalidate><label for="an">Name</label><input id="an" name="name" type="text" autocomplete="name" autocapitalize="words" maxlength="60" value="'+esc(state.me.name)+'"><p class="err" id="aner" hidden>Enter your name to continue.</p>'+
    '<label for="ap">Mobile number</label><div class="ph"><span>+91</span><input id="ap" name="phone" type="tel" inputmode="numeric" autocomplete="tel-national" placeholder="98765 43210" maxlength="11" value="'+fmtPh(state.me.phone)+'"></div><p class="err" id="aper" hidden>Enter a valid 10-digit mobile number.</p>'+
    '<p class="err" id="aserr" hidden></p><button class="submit" type="submit">Send OTP</button><p class="fine">By continuing you agree to the <a href="/terms.html">Terms</a> and <a href="/privacy.html">Privacy Policy</a>.</p></form>');
}
function sendCode(fromQuick,resend){
  var btn=document.querySelector('#authform .submit'), er=$('#aserr'); if(btn)btn.disabled=true; if(er)er.hidden=true;
  var rs=$('#rsd'); if(resend&&rs)rs.disabled=true;
  api('POST','/api/auth/request-otp',{phone:state.me.phone,name:state.me.name}).then(function(){if(resend)toast('Code sent again');openOtp()}).catch(function(e){
    if(btn)btn.disabled=false;
    if(resend){toast(e.message);if(rs)rs.disabled=false;return}
    if(fromQuick){openAuth(state.pend)}
    var er2=$('#aserr'); if(er2){er2.textContent=e.message;er2.hidden=false} else toast(e.message);
  });
}
function openOtp(){
  stopOtpWatch();
  showSheet(sheetHead('Enter the code','We sent a 6-digit code to +91 '+fmtPh(state.me.phone)+'. <button type="button" class="lnk" data-act="authback">Change</button>')+
    '<form id="otpform" class="jf" novalidate><label for="ao">6-digit code</label><input id="ao" name="otp" class="otp" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="••••••"><p class="err" id="aoer" hidden>Enter the 6-digit code.</p>'+
    '<button class="submit" type="submit">Verify and continue</button><button type="button" class="rs" id="rsd" data-act="resend" disabled>Resend code in 30s</button></form>');
  var n=30;
  otpT=setInterval(function(){var b=$('#rsd');if(!b){clearInterval(otpT);return} n--; if(n<=0){clearInterval(otpT);b.disabled=false;b.textContent='Resend code'}else b.textContent='Resend code in '+n+'s'},1000);
  if('OTPCredential' in window){
    otpAbort=new AbortController();
    navigator.credentials.get({otp:{transport:['sms']},signal:otpAbort.signal}).then(function(o){
      var i=$('#ao'); if(o&&o.code&&i){i.value=o.code;var f=$('#otpform');if(f&&f.requestSubmit)f.requestSubmit()}
    }).catch(function(){});
  }
}
function signIn(user){
  stopOtpWatch(); applyMe(user); saveAcct();
  var pend=state.pend; state.pend='';
  Promise.all([loadCards(),loadSaved()]).catch(function(){}).then(function(){
    afterAccount();
    if(pend){var c=byId(pend); if(c&&c.joined){openSheet(pend)}else if(c){openJoin(pend)}else closeSheet()}
    else{closeSheet(); toast('Welcome, '+state.me.name)}
  });
}
function signOut(){
  state.auth=false; state.pend=''; state.route=null; state.sel=null; state.saved={}; state.savedList=[]; state.admin=false; state.geo.used=0;
  Object.keys(registry).forEach(function(k){var c=registry[k];c.joined=false;c.stamps=0;c.mid='';c.mem=''}); walletOrder=[];
  state.me={name:'',phone:'',photo:'',birthday:'',email:'',diet:'',fav:'',dates:[]};
  setTab('home'); renderWallet(); refreshMap();
}
document.addEventListener('submit',function(e){
  if(e.target.id==='authform'){
    e.preventDefault();
    var nm=$('#an').value.trim(), ph=$('#ap').value.replace(/\D/g,''), okn=nm!=='', okp=/^[6-9]\d{9}$/.test(ph);
    $('#aner').hidden=okn; $('#aper').hidden=okp;
    if(!okn){$('#an').focus();return} if(!okp){$('#ap').focus();return}
    state.me.name=nm; state.me.phone=ph; sendCode(false);
  } else if(e.target.id==='otpform'){
    e.preventDefault();
    var code=$('#ao').value, ok=/^\d{6}$/.test(code), er=$('#aoer'), btn=e.target.querySelector('.submit');
    if(!ok){er.textContent='Enter the 6-digit code.';er.hidden=false;$('#ao').focus();return}
    er.hidden=true; btn.disabled=true;
    api('POST','/api/auth/verify',{phone:state.me.phone,code:code}).then(function(d){signIn(d.user)}).catch(function(x){btn.disabled=false;er.textContent=x.message;er.hidden=false;$('#ao').focus()});
  }
});

/* ---------- theme: System follows the phone; Light and Dark override it and are remembered on this device ---------- */
function getTheme(){try{return localStorage.getItem('cl-theme')||'system'}catch(err){return 'system'}}
function applyTheme(t){var r=document.documentElement;if(t==='system')r.removeAttribute('data-theme');else r.setAttribute('data-theme',t)}
function setTheme(t){state.theme=t;try{localStorage.setItem('cl-theme',t)}catch(err){}applyTheme(t);renderProfile();invalidate()}
state.theme=getTheme(); if(state.theme!=='system')applyTheme(state.theme);

/* ---------- start ---------- */
try{['cl-sess','cl-saved'].forEach(function(k){localStorage.removeItem(k)})}catch(e){}
function start(pos){
  watchPerm();
  if(pos&&pos.lat!=null){
    onFix({coords:{latitude:pos.lat,longitude:pos.lng,accuracy:pos.acc||0}},true);
    startWatch();
  } else { setLoc('Near you',false) }
  loadAccount();
  if(you.lat!=null)loadNearby(); else {state.nearLoaded=true;renderHome()}
}
renderHome(); renderWallet(); setTab('home'); setLoc('Locating…',true);
if(window.NIRO_POS!==undefined)start(window.NIRO_POS);
else document.addEventListener('niro:location',function(e){start(e.detail)},{once:true});

if('serviceWorker' in navigator&&(location.protocol==='https:'||location.hostname==='localhost')){
  var regSw=function(){navigator.serviceWorker.register('/sw.js').catch(function(){})};
  if(document.readyState==='complete')regSw(); else window.addEventListener('load',regSw);
}
