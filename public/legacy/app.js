var GOAL = 8, TILE = 300, M_PER_PX = 3, GEO_R = 50, GEO_CAP = 2;
var cafes = [
  {id:'agr',name:'Agrahara Roasters',area:'Saraswathipuram',open:true,hours:'Open till 10 pm',offer:'Free pastry with any 2 coffees',exp:'Ends Sunday',x:150,y:330,stamps:7,joined:true,mid:'AG4F-71C2'},
  {id:'kaa',name:'Kaapi Kutir',area:'Vijayanagar',open:true,hours:'Open till 9:30 pm',offer:'Double stamps before 11 am',exp:'Ends Friday',x:270,y:470,stamps:3,joined:true,mid:'KK09-B3E8'},
  {id:'cru',name:'Crumb &amp; Co',area:'Kuvempunagar',open:true,hours:'Open till 11 pm',offer:'Second slice at half price',exp:'Ends today',x:90,y:560,stamps:8,joined:true,mid:'CC52-9D0A'},
  {id:'cha',name:'Chamundi Chai Bar',area:'Jayalakshmipuram',open:false,hours:'Opens 7 am',offer:'Masala chai at ₹49 for members',exp:'This week',x:300,y:250,stamps:1,joined:true,mid:'CH77-3F61'},
  {id:'waf',name:'Waffle Lane',area:'Gokulam',open:true,hours:'Open till 10 pm',offer:'Free topping on your first visit',exp:'New',x:200,y:645,stamps:0,joined:false,mid:'WL18-A4D5'}
];
var hist = [['21 Oct','+1 stamp'],['18 Oct','+2 stamps (double day)'],['12 Oct','+1 stamp'],['05 Oct','Joined']];
var state = {tab:'home',sel:null,q:'',saved:{},city:'Mysuru',route:null,auth:false,pend:'',me:{name:'',phone:'',photo:'',birthday:'',email:'',diet:'',fav:'',dates:[]},prefs:{stamps:true,offers:true,treats:true},prev:'home',geo:{on:true,count:0,day:''},simN:0};
var you = {x:0,y:0};
var registry = {}, tileCache = {}, walletOrder = ['agr','kaa','cru','cha'];
cafes.forEach(function(c){c.x-=200;c.y-=400;c.kind='Cafe';registry[c.id]=c});
var $ = function(s){return document.querySelector(s)};
function byId(id){return registry[id]}
function joined(){return walletOrder.map(byId).filter(function(c){return c&&c.joined})}
function distOf(p){return Math.hypot(p.x-you.x,p.y-you.y)*M_PER_PX}
function routeM(p){return (Math.abs(p.x-you.x)+Math.abs(p.y-you.y))*M_PER_PX}
function fmt(m){return m<1000?(Math.max(10,Math.round(m/10)*10))+' m':(m/1000).toFixed(1)+' km'}
function walkMin(m){return Math.max(1,Math.round(m/80))}
function dots(n){var h='';for(var i=0;i<GOAL;i++)h+='<span class="dot'+(i<n?' on':'')+'"></span>';return '<div class="dots" aria-label="'+n+' of '+GOAL+' stamps">'+h+'</div>'}

/* ---------- home ---------- */
function renderHome(){
  if(state.city!=='Mysuru'){
    $('#home').innerHTML='<div class="hero"><span class="k">'+state.city+'</span><h3>No partner cafes here yet</h3><p>Partner cafes will appear here when they join.</p><button class="btn" data-act="loc">Change location</button></div>';
    return;
  }
  var h = joined().filter(function(c){return c.stamps<GOAL}).sort(function(a,b){return b.stamps-a.stamps})[0];
  var s = '';
  if(!state.auth) s += '<div class="hero"><span class="k">Loyalty cards</span><h3>Earn a free coffee at partner cafes</h3><p>Sign up with your mobile number. It takes under a minute.</p><button class="btn" data-act="profile">Sign up or log in</button></div>';
  if(h) s +='<div class="hero hb pt-'+brandOf(h).pat+'" style="'+bvars(brandOf(h))+'"><span class="k">Closest reward</span><h3>'+h.name+'</h3>'+dots(h.stamps)+
    '<p>'+(GOAL-h.stamps)+' more stamp'+(GOAL-h.stamps>1?'s':'')+' to a free filter coffee.</p><button class="btn" data-act="sheet" data-id="'+h.id+'">Show card</button></div>';
  var near = cafes.slice().sort(function(a,b){return distOf(a)-distOf(b)});
  s += '<h2 class="sec">Nearby <small>'+near.length+' partner cafes</small></h2><div class="rail">';
  near.forEach(function(c){
    s += '<button class="near" data-act="pin" data-id="'+c.id+'"><span class="pic">'+photo(c)+'<span class="badge'+(c.open?' open':'')+'"><i></i>'+(c.open?'Open':'Closed')+'</span></span><span class="nt"><b>'+c.name+'</b><span class="m">'+c.area+' · '+fmt(distOf(c))+'</span></span></button>';
  });
  s += '</div><h2 class="sec">Offers for you</h2><div class="offers">';
  cafes.forEach(function(c){
    s += '<div class="offer"><div><b>'+c.offer+'</b><small>'+c.name+' · '+c.exp+'</small></div><button class="chip" data-act="save" data-id="'+c.id+'" aria-pressed="'+(!!state.saved[c.id])+'">'+(state.saved[c.id]?'Saved':'Save')+'</button></div>';
  });
  s += '</div><p class="foot">Example cafes and offers, for this mock only.</p>';
  $('#home').innerHTML = s;
}

/* ---------- wallet ---------- */
function renderWallet(){
  var list = joined(), s = '';
  if(!list.length){
    $('#wallet').innerHTML='<h2 class="sec">Your cards</h2><div class="hero"><span class="k">'+(state.auth?'No cards yet':'Not signed in')+'</span><h3>'+(state.auth?'Join a partner cafe':'Sign up to get your cards')+'</h3><p>'+(state.auth?'Find a cafe on the map and tap Join Loyalty to start earning stamps.':'Join a cafe’s loyalty card and your stamps will show up here.')+'</p>'+(state.auth?'<button class="btn" data-tab="map">Open map</button>':'<button class="btn" data-act="profile">Sign up or log in</button>')+'</div>';
    return;
  }
  s ='<h2 class="sec">Your cards <small>'+list.length+' cafes</small></h2><div class="carousel" id="wscroll" tabindex="0" aria-label="Your loyalty cards, scroll to browse"><div class="track" id="wtrack"><div class="layer" id="wlayer">';
  list.forEach(function(c,i){
    var ready = c.stamps>=GOAL, b = brandOf(c);
    s += '<button class="wc pt-'+b.pat+'" style="'+bvars(b)+'" data-i="'+i+'" data-act="sheet" data-id="'+c.id+'" aria-label="'+c.name.replace('&amp;','and')+', '+c.stamps+' of '+GOAL+' stamps">'+
      '<div class="wc-top"><div><b>'+c.name+'</b><small>'+c.area+'</small></div><div class="wc-r">'+(ready?'<span class="tag"><span>Reward ready</span></span>':'')+'<span class="mono">'+initials(c.name)+'</span></div></div>'+
      '<div class="wc-bot">'+dots(c.stamps)+'<div class="cnt">'+c.stamps+'<small>/ '+GOAL+'</small></div></div></button>';
  });
  s += '</div>';
  list.forEach(function(c,k){s+='<span class="snap" style="top:'+(k*WS.step)+'px"></span>'});
  s += '</div></div><p class="foot hint">Scroll to browse · tap the front card to show your QR</p>';
  $('#wallet').innerHTML = s;
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

function qrSvg(seed){
  var n=21, h=2166136261;
  for(var i=0;i<seed.length;i++){h^=seed.charCodeAt(i);h=Math.imul(h,16777619)}
  function rnd(){h^=h<<13;h^=h>>>17;h^=h<<5;return (h>>>0)/4294967296}
  function finder(x,y){return x<7&&y<7||x>=n-7&&y<7||x<7&&y>=n-7}
  var r='';
  for(var y=0;y<n;y++)for(var x=0;x<n;x++){
    var on;
    if(finder(x,y)){
      var fx=x>=n-7?x-(n-7):x, fy=y>=n-7?y-(n-7):y;
      on = fx===0||fx===6||fy===0||fy===6||(fx>=2&&fx<=4&&fy>=2&&fy<=4);
    } else if(x===7||y===7||x===n-8||y===n-8){ on=false; rnd(); }
    else on = rnd()>0.52;
    if(on) r+='<rect x="'+x+'" y="'+y+'" width="1.02" height="1.02"/>';
  }
  return '<svg class="qr" viewBox="0 0 '+n+' '+n+'" fill="#0b0b0b" role="img" aria-label="Member QR code">'+r+'</svg>';
}

function openSheet(id){
  var c=byId(id), s='';
  $('#scrim').classList.remove('center');
  var b=brandOf(c);
  s += '<div class="grab"></div><div class="bn pt-'+b.pat+'" style="'+bvars(b)+'"><span class="mono">'+initials(c.name)+'</span><div class="bn-t"><h3>'+c.name+'</h3><p>'+c.area+' · '+(c.stamps>=GOAL?'Reward ready':(GOAL-c.stamps)+' stamps to your next reward')+'</p></div><button class="x" data-act="close" aria-label="Close"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5 5l14 14M19 5L5 19"/></svg></button></div>';
  s += qrSvg(c.mid)+'<div class="mid">MEMBER '+c.mid+'</div>';
  s += '<div class="brand-scope" style="'+bvars(b)+'"><div class="grid8">';
  for(var i=0;i<GOAL;i++) s+='<div class="st'+(i<c.stamps?' on':'')+'">'+(i<c.stamps?'✓':(i+1))+'</div>';
  s += '</div></div><ul class="hist">';
  if(c.stamps>0) hist.slice(0,4).forEach(function(r){s+='<li>'+r[0]+'<span>'+r[1]+'</span></li>'});
  else s+='<li>No visits yet<span>Show this QR at the counter</span></li>';
  s += '</ul>';
  $('#sheet').innerHTML=s; $('#scrim').hidden=false; $('#sheet').scrollTop=0;
  $('#sheet').querySelector('.x').focus();
}
function closeSheet(){ $('#scrim').hidden=true; $('#scrim').classList.remove('center') }

/* join loyalty: signup form, then a confirmation popup that tells the customer how to start earning */
var X_ICON='<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5 5l14 14M19 5L5 19"/></svg>';
function openJoin(id){
  if(!state.auth){openAuth(id);return}
  var c=byId(id),s='<div class="grab"></div><div class="sh-head"><div><h3>Join '+c.name+'</h3><p>Takes 10 seconds. Your number stays private.</p></div><button class="x" data-act="close" aria-label="Close">'+X_ICON+'</button></div>';
  s+='<form id="joinform" class="jf" data-id="'+id+'" novalidate><label for="jn">Name</label><input id="jn" name="name" type="text" autocomplete="given-name" value="'+esc(state.me.name)+'" required>'+
    '<p class="err" id="jerr" hidden>Enter your name to continue.</p>'+
    '<label for="jp">Mobile number</label><div class="ph"><span>+91</span><input id="jp" name="phone" type="tel" inputmode="numeric" autocomplete="tel-national" placeholder="98765 43210" maxlength="11" value="'+fmtPh(state.me.phone)+'" required></div>'+
    '<p class="err" id="jperr" hidden>Enter a 10-digit mobile number.</p>'+
    '<label class="chk" for="jc"><input type="checkbox" id="jc"><span>Send me offers from '+c.name+'</span></label>'+
    '<button class="submit" type="submit">Join Loyalty</button><p class="fine">You can turn offers off any time in Profile.</p></form>';
  $('#scrim').classList.remove('center'); $('#sheet').innerHTML=s; $('#scrim').hidden=false; $('#sheet').scrollTop=0;
  $('#jn').focus();
}
function showJoined(id){
  var c=byId(id);
  $('#sheet').innerHTML='<div class="done"><div class="ok"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div><h3>You’re in!</h3><p>To start earning stamps, show your card at the counter when you pay at '+c.name+'.</p><div class="acts"><button class="s" data-act="close">Later</button><button class="p" data-act="sheet" data-id="'+id+'">Show my card</button></div></div>';
  $('#scrim').classList.add('center'); $('#scrim').hidden=false;
  $('#sheet').querySelector('.p').focus();
}
document.addEventListener('input',function(e){
  if(e.target.id==='ao'){clearTimeout(autoT);var oa=$('#oauto');if(oa)oa.hidden=true;e.target.value=e.target.value.replace(/\D/g,'').slice(0,6);return}
  if(e.target.id!=='jp'&&e.target.id!=='ap')return;
  var d=e.target.value.replace(/\D/g,'').slice(0,10);
  e.target.value=d.length>5?d.slice(0,5)+' '+d.slice(5):d;
});
document.addEventListener('submit',function(e){
  if(e.target.id!=='joinform')return; e.preventDefault();
  var okName=$('#jn').value.trim()!=='', okPhone=/^[6-9]\d{9}$/.test($('#jp').value.replace(/\D/g,''));
  $('#jerr').hidden=okName; $('#jperr').hidden=okPhone;
  if(!okName){$('#jn').focus();return}
  if(!okPhone){$('#jp').focus();return}
  state.me.name=$('#jn').value.trim(); state.me.phone=$('#jp').value.replace(/\D/g,''); updateHeader();
  var id=e.target.dataset.id, p=byId(id); p.joined=true; p.offers=$('#jc').checked;
  if(walletOrder.indexOf(id)<0)walletOrder.push(id);
  refreshMap(); renderWallet(); showJoined(id);
});

/* ---------- endless map ---------- */
/* Everything is generated from tile coordinates, so the map can be dragged forever and looks the same every time you return. */
function hh(x,y,s){var h=(Math.imul(x|0,374761393)+Math.imul(y|0,668265263)+Math.imul(s|0,2147483647))|0;h=Math.imul(h^(h>>>13),1274126177);h^=h>>>16;return (h>>>0)/4294967296}
var AREAS=['Saraswathipuram','Vijayanagar','Kuvempunagar','Jayalakshmipuram','Gokulam','Hebbal','Bogadi','Lakshmipuram','Yadavagiri','Ramakrishna Nagar','Siddharthanagar','Chamundipuram'];
function areaAt(x,y){return AREAS[Math.floor(hh(Math.floor((x+300)/600),Math.floor((y+300)/600),3)*AREAS.length)]}
var C_PRE=['Bean','Kaapi','Brew','Crumb','Chai','Roast','Sugar','Filter','Cocoa','Toast','Waffle','Mango'], C_SUF=['House','Corner','Lane','Kitchen','Bar','Studio','Cart','Works'];
var R_PRE=['Palace','Royal','Annapoorna','Green Leaf','Spice','Saffron','Lalitha','Ganesh','Curry','Malnad'], R_SUF=['Tiffin Room','Dhaba','Grill','Biryani House','Thali Co.','Kitchen'];
var OFF_C=['Free pastry with any 2 coffees','Double stamps before 11 am','Second slice at half price','Free topping on your first visit','Filter coffee at ₹30 for members'];
var OFF_R=['Free dessert on bills above ₹500','10% off for members on weekdays','Free lassi with any thali','Double stamps at lunch'];
var EXPS=['Ends today','Ends Friday','Ends Sunday','This week','New'];
function pick(a,x,y,s){return a[Math.floor(hh(x,y,s)*a.length)%a.length]}
function makePlace(tx,ty,i){
  var rest=hh(tx,ty,30+i)>0.7, x=tx*TILE+30+hh(tx,ty,10+i)*(TILE-60), y=ty*TILE+30+hh(tx,ty,20+i)*(TILE-60);
  var name=rest?pick(R_PRE,tx,ty,50+i)+' '+pick(R_SUF,tx,ty,60+i):pick(C_PRE,tx,ty,50+i)+' '+pick(C_SUF,tx,ty,60+i);
  var open=hh(tx,ty,40+i)>0.2;
  var mid=name.replace(/[^A-Za-z]/g,'').slice(0,2).toUpperCase()+Math.floor(hh(tx,ty,70+i)*90+10)+'-'+Math.floor(hh(tx,ty,80+i)*65535).toString(16).toUpperCase().padStart(4,'0');
  return {id:'t'+tx+'_'+ty+'_'+i,name:name,kind:rest?'Restaurant':'Cafe',area:areaAt(x,y),open:open,hours:open?'Open till '+(9+Math.floor(hh(tx,ty,90+i)*3))+' pm':'Opens '+(7+Math.floor(hh(tx,ty,91+i)*3))+' am',
    offer:pick(rest?OFF_R:OFF_C,tx,ty,92+i),exp:pick(EXPS,tx,ty,93+i),stamps:0,joined:false,mid:mid,x:x,y:y,generated:true};
}
function tilePlaces(tx,ty){
  var k=tx+','+ty; if(tileCache[k])return tileCache[k];
  var q=hh(tx,ty,9), n=q<0.25?0:(q<0.7?1:2), list=[];
  for(var i=0;i<n;i++){var p=makePlace(tx,ty,i);registry[p.id]=p;list.push(p)}
  tileCache[k]=list; return list;
}
for(var gy=-3;gy<=3;gy++)for(var gx=-3;gx<=3;gx++)tilePlaces(gx,gy);

var cv=$('#mapcv'), ctx=null, W=0, H=0, DPR=1, cam={x:0,y:0}, vel={x:0,y:0}, drag=null, fly=null, raf=0, hits=[], lastArea='';
var ICON_C=new Path2D('M-6 -4h9v5a4.5 4.5 0 0 1-9 0zM3 -3h2a2.2 2.2 0 0 1 0 4.4H3');
var ICON_R=new Path2D('M-4.5 -7v5a2.5 2.5 0 0 0 5 0v-5M-2 -7v14M6 7v-14c-3.2 2-3.2 7.5 0 9.5');
function colors(){var s=getComputedStyle(document.documentElement);function g(n){return s.getPropertyValue(n).trim()}
  return {land:g('--m-land'),park:g('--m-park'),water:g('--m-water'),road:g('--m-road'),line:g('--m-line'),ink:g('--ink'),bg:g('--bg'),you:g('--you')}}
function rr(x,y,w,h,r){ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath()}
function riverX(y){return 1100+Math.sin(y*0.0031)*600+Math.sin(y*0.0087+1.3)*140}
function matches(c){var q=state.q.trim().toLowerCase();return !q||(c.name+' '+c.area+' '+c.kind).toLowerCase().indexOf(q)>-1}
function found(){return Object.keys(registry).map(byId).filter(matches).sort(function(a,b){return distOf(a)-distOf(b)}).slice(0,5)}

function draw(){
  if(!ctx||!W)return;
  var C=colors(), l=cam.x-W/2, t=cam.y-H/2, r=cam.x+W/2, b=cam.y+H/2;
  ctx.setTransform(DPR,0,0,DPR,0,0);
  ctx.fillStyle=C.land; ctx.fillRect(0,0,W,H);
  var tx0=Math.floor(l/TILE)-1, tx1=Math.floor(r/TILE)+1, ty0=Math.floor(t/TILE)-1, ty1=Math.floor(b/TILE)+1, tx, ty;
  for(ty=ty0;ty<=ty1;ty++)for(tx=tx0;tx<=tx1;tx++){
    if(hh(tx,ty,1)<0.4){
      var pw=70+hh(tx,ty,2)*90, ph=60+hh(tx,ty,3)*90, px=tx*TILE+hh(tx,ty,4)*(TILE-pw), py=ty*TILE+hh(tx,ty,5)*(TILE-ph);
      ctx.fillStyle=C.park; rr(px-l,py-t,pw,ph,18); ctx.fill();
    }
    if(hh(tx,ty,7)<0.12){
      ctx.fillStyle=C.water; ctx.beginPath();
      ctx.ellipse(tx*TILE+hh(tx,ty,8)*TILE-l,ty*TILE+hh(tx,ty,6)*TILE-t,30+hh(tx,ty,11)*30,22+hh(tx,ty,12)*22,0,0,6.2832); ctx.fill();
    }
  }
  ctx.strokeStyle=C.water; ctx.lineWidth=54; ctx.lineJoin='round'; ctx.lineCap='round'; ctx.beginPath();
  for(var ry=Math.floor((t-80)/40)*40, first=true; ry<=b+80; ry+=40){var rx=riverX(ry)-l; if(first){ctx.moveTo(rx,ry-t);first=false}else ctx.lineTo(rx,ry-t)}
  ctx.stroke();

  var major=new Path2D(), minor=new Path2D(), k;
  for(tx=tx0;tx<=tx1;tx++){
    var vx=[tx*TILE+TILE*0.12+hh(tx,0,1)*TILE*0.25, tx*TILE+TILE*0.58+hh(tx,0,2)*TILE*0.27];
    vx.forEach(function(x,i){var p=(i===0&&(((tx%3)+3)%3)===0)?major:minor;p.moveTo(x-l,-10);p.lineTo(x-l,H+10)});
  }
  for(ty=ty0;ty<=ty1;ty++){
    var hy=[ty*TILE+TILE*0.15+hh(0,ty,1)*TILE*0.25, ty*TILE+TILE*0.6+hh(0,ty,2)*TILE*0.25];
    hy.forEach(function(y,i){var p=(i===0&&(((ty%3)+3)%3)===0)?major:minor;p.moveTo(-10,y-t);p.lineTo(W+10,y-t)});
  }
  for(k=Math.floor((l-b)/1000)-1;k<=Math.ceil((r-t)/1000)+1;k++){
    var c1=k*1000+hh(k,0,5)*400; major.moveTo(c1+(t-40)-l,-40); major.lineTo(c1+(b+40)-l,H+40);
  }
  for(k=Math.floor((l+t)/1700)-1;k<=Math.ceil((r+b)/1700)+1;k++){
    var d1=k*1700+hh(k,0,6)*600; major.moveTo(d1-(t-40)-l,-40); major.lineTo(d1-(b+40)-l,H+40);
  }
  ctx.lineCap='butt'; ctx.strokeStyle=C.road; ctx.lineWidth=7; ctx.stroke(minor);
  ctx.lineWidth=13; ctx.stroke(major);
  ctx.strokeStyle=C.line; ctx.lineWidth=1.4; ctx.setLineDash([8,8]); ctx.stroke(major); ctx.setLineDash([]);

  var pts=[], rp=state.route?byId(state.route):null;
  if(rp){
    ctx.lineCap='round'; ctx.lineJoin='round'; ctx.beginPath(); ctx.moveTo(you.x-l,you.y-t); ctx.lineTo(rp.x-l,you.y-t); ctx.lineTo(rp.x-l,rp.y-t);
    ctx.strokeStyle=C.bg; ctx.lineWidth=10; ctx.stroke(); ctx.strokeStyle=C.you; ctx.lineWidth=5; ctx.stroke();
  }
  /* you are here */
  var ux=you.x-l, uy=you.y-t;
  ctx.fillStyle=C.you; ctx.globalAlpha=0.18; ctx.beginPath(); ctx.arc(ux,uy,24,0,6.2832); ctx.fill(); ctx.globalAlpha=1;
  ctx.beginPath(); ctx.arc(ux,uy,9,0,6.2832); ctx.fillStyle=C.you; ctx.fill(); ctx.lineWidth=3; ctx.strokeStyle='#fff'; ctx.stroke();

  hits=[];
  if(state.city==='Mysuru'){
    for(ty=ty0;ty<=ty1;ty++)for(tx=tx0;tx<=tx1;tx++)tilePlaces(tx,ty).forEach(function(p){pts.push(p)});
    cafes.forEach(function(c){if(pts.indexOf(c)<0)pts.push(c)});
    pts.sort(function(a,b){return (a.id===state.sel)-(b.id===state.sel)||a.y-b.y});
    if(state.simRing){
      ctx.save(); ctx.setLineDash([6,6]); ctx.lineWidth=1.5; ctx.strokeStyle=C.you; ctx.fillStyle=C.you;
      pts.forEach(function(p){var gx=p.x-l,gy=p.y-t;if(gx<-80||gx>W+80||gy<-80||gy>H+80)return;
        ctx.globalAlpha=0.1;ctx.beginPath();ctx.arc(gx,gy,GEO_R,0,6.2832);ctx.fill();ctx.globalAlpha=0.7;ctx.stroke()});
      ctx.restore();
    }
    pts.forEach(function(p){
      var sx=p.x-l, sy=p.y-t; if(sx<-30||sx>W+30||sy<-30||sy>H+30)return;
      var sel=state.sel===p.id; drawPin(C,p,sx,sy,sel,!matches(p)); hits.push({p:p,x:sx,y:sy});
    });
  }
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
function updateArea(force){
  var none=state.city!=='Mysuru', txt=none?'No partner cafes in '+state.city:areaAt(cam.x,cam.y);
  if(force||txt!==lastArea){lastArea=txt;$('#area').textContent=txt}
}
function frame(now){
  raf=0; if(state.tab!=='map')return;
  var again=false;
  if(fly){var k=Math.min(1,(now-fly.t0)/fly.dur), e=1-Math.pow(1-k,3); cam.x=fly.sx+(fly.tx-fly.sx)*e; cam.y=fly.sy+(fly.ty-fly.sy)*e; if(k<1)again=true;else fly=null}
  else if(!drag&&(Math.abs(vel.x)>0.2||Math.abs(vel.y)>0.2)){cam.x+=vel.x;cam.y+=vel.y;vel.x*=0.94;vel.y*=0.94;again=true}
  draw(); updateArea(false); if(again)invalidate();
}
function flyTo(x,y){fly={sx:cam.x,sy:cam.y,tx:x,ty:y,t0:performance.now(),dur:450};vel.x=vel.y=0;invalidate()}
function resizeMap(){
  var r=cv.getBoundingClientRect(); if(!r.width)return;
  DPR=window.devicePixelRatio||1; W=r.width; H=r.height; cv.width=Math.round(W*DPR); cv.height=Math.round(H*DPR); ctx=cv.getContext('2d'); invalidate();
}
function tapAt(e){
  var r=cv.getBoundingClientRect(), px=e.clientX-r.left, py=e.clientY-r.top, best=null, bd=26;
  hits.forEach(function(h){var d=Math.hypot(h.x-px,h.y-py);if(d<bd){bd=d;best=h}});
  if(best){selectPlace(best.p.id)}
  else if(state.sel){state.sel=null;state.route=null;refreshMap()}
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
function nearList(){
  var all=Object.keys(registry).map(function(k){return registry[k]});
  return all.sort(function(a,b){return distOf(a)-distOf(b)}).slice(0,NEAR_N);
}
function pager(id){
  var l=nearList(), i=l.findIndex(function(p){return p.id===id}); if(i<0)return '';
  return '<div class="pg" aria-hidden="true">'+l.map(function(p,k){return '<i'+(k===i?' class="on"':'')+'></i>'}).join('')+'</div>';
}
function swipePlace(dir){
  var l=nearList(), i=l.findIndex(function(p){return p.id===state.sel}); if(i<0)i=dir>0?-1:l.length;
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
  var none=state.city!=='Mysuru', cur=(state.sel&&!none)?byId(state.sel):null, any=state.q.trim()!=='', d=$('#dock'), h='';
  updateArea(true);
  if(state.tab==='map'&&!none){
    if(any){
      var res=found();
      h='<div class="pop"><div class="res">'+(res.length?res.map(function(c){return '<button data-act="pin" data-id="'+c.id+'"><b style="font-size:16px">'+c.name+'</b><span>'+c.kind+' · '+fmt(distOf(c))+'</span></button>'}).join(''):'<span style="padding:6px 4px">No cafe or restaurant matches that search.</span>')+'</div></div>';
    } else if(cur){
      var rt=state.route===cur.id;
      h='<div class="pop"><span class="pic wide">'+photo(cur)+'</span><div class="row"><span class="badge'+(cur.open?' open':'')+'"><i></i>'+cur.hours+'</span><span class="mt">'+cur.kind+' · '+fmt(distOf(cur))+'</span></div><b>'+cur.name+'</b><p>'+cur.offer+'</p>'+
        (rt?'<p class="route">Route · '+fmt(routeM(cur))+' · '+walkMin(routeM(cur))+' min walk</p>':'')+
        '<div class="acts">'+(cur.joined?'<button class="p" data-act="sheet" data-id="'+cur.id+'">Show Card</button>':'<button class="p" data-act="join" data-id="'+cur.id+'">Join Loyalty</button>')+
        '<button class="s" data-act="route" data-id="'+cur.id+'" aria-pressed="'+rt+'">Direction</button></div>'+pager(cur.id)+'</div>';
    }
  }
  d.hidden=!h; $('#dockin').innerHTML=h; invalidate();
}

function setTab(t){
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

document.addEventListener('click',function(e){
  var wcEl=e.target.closest('.wc');
  if(wcEl){var sc=$('#wscroll'), wi=+wcEl.dataset.i; if(Math.round(sc.scrollTop/WS.step)!==wi){sc.scrollTo({top:wi*WS.step,behavior:'smooth'});return}}
  var tb=e.target.closest('[data-tab]');
  if(tb){setTab(tb.dataset.tab); if(tb.dataset.tab==='map')setTimeout(function(){$('#q').focus()},250); return}
  var a=e.target.closest('[data-act]');
  if(a){
    var id=a.dataset.id, act=a.dataset.act;
    if(act==='sheet')openSheet(id);
    else if(act==='close')closeSheet();
    else if(act==='pin')selectPlace(id);
    else if(act==='save'){state.saved[id]=!state.saved[id];renderHome()}
    else if(act==='join')openJoin(id);
    else if(act==='route'){
      state.route=state.route===id?null:id; refreshMap();
      if(state.route){var q=byId(id); if(Math.abs(q.x)<W-90&&Math.abs(q.y)<H-300)flyTo(q.x/2,q.y/2+90);else flyTo(q.x,q.y+90)}
    }
    else if(act==='recenter'){flyTo(you.x,you.y)}
    else if(act==='sim')startSim();
    else if(act==='geodir')geoDirection(id);
    else if(act==='georeset'){state.geo.count=0;renderProfile();toast('Today’s count reset')}
    else if(act==='loc')openLoc();
    else if(act==='detect')detect();
    else if(act==='city')setCity(a.dataset.name);
    else if(act==='profile'){if(state.auth)setTab('profile');else openAuth('')}
    else if(act==='authback'){clearTimeout(autoT);openAuth(state.pend)}
    else if(act==='quickauth'){var sa=savedAcct();if(sa){state.me.name=sa.name;state.me.phone=sa.phone;openOtp()}}
    else if(act==='resend'){toast('Code sent again');openOtp()}
    else if(act==='back')setTab(state.prev||'home');
    else if(act==='tgl'){if(id==='geo')state.geo.on=!state.geo.on;else state.prefs[id]=!state.prefs[id];renderProfile()}
    else if(act==='cafeoffer'){var q2=byId(id);q2.offers=(q2.offers===false);renderProfile()}
    else if(act==='toast')toast(a.dataset.msg);
    else if(act==='theme')setTheme(id);
    else if(act==='edit')openEdit();
    else if(act==='photo')$('#ep').click();
    else if(act==='rmphoto'){edP='';paintPv()}
    else if(act==='adddate'){syncD();if(edD.length<5){edD.push({l:'',d:''});$('#sd').innerHTML=dRows();paintAdd()}}
    else if(act==='rmdate'){syncD();edD.splice(+id,1);$('#sd').innerHTML=dRows();paintAdd()}
    else if(act==='del')openConfirm('del');
    else if(act==='logout')openConfirm('out');
    else if(act==='confirm'){closeSheet();signOut();toast(id==='del'?'Your data was deleted (mock)':'Logged out')}
    return;
  }
  if(e.target===$('#scrim'))closeSheet();
});
document.addEventListener('keydown',function(e){ if(e.key==='Escape')closeSheet() });
$('#q').addEventListener('input',function(e){state.q=e.target.value;refreshMap()});

/* location: this mock only simulates detection. The real app asks for permission, reads GPS, then reverse-geocodes to a city. */
var CITIES=['Mysuru','Bengaluru','Raipur','Bhilai','Jaipur'];
function setLoc(name,busy){$('#locname').textContent=name;$('#loc').classList.toggle('busy',!!busy)}
function applyCity(name){state.city=name;state.sel=null;state.route=null;setLoc(name,false);renderHome();refreshMap()}
function detect(){
  closeSheet(); setLoc('Locating…',true);
  setTimeout(function(){applyCity('Mysuru')},1400);
}
function setCity(name){closeSheet();applyCity(name)}
function openLoc(){
  var s='<div class="grab"></div><div class="sh-head"><div><h3>Your location</h3><p>Detected from your phone. Change it if it is wrong.</p></div><button class="x" data-act="close" aria-label="Close"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5 5l14 14M19 5L5 19"/></svg></button></div>';
  s+='<div class="res" style="margin-top:12px"><button data-act="detect"><b style="font-size:16px">Use my current location</b><span>Auto-detect</span></button>';
  CITIES.forEach(function(c){s+='<button data-act="city" data-name="'+c+'"><b style="font-size:16px">'+c+'</b><span>'+(c===state.city?'Selected':'')+'</span></button>'});
  s+='</div>';
  $('#sheet').innerHTML=s; $('#scrim').hidden=false; $('#sheet').scrollTop=0;
  $('#sheet').querySelector('.x').focus();
}

/* ---------- cafe-designed cards ---------- */
/* In the real app each cafe sets these in its own app (colours, pattern, logo). Cafes without a design get a stable one. */
var BRANDS={
  agr:{bg:'#3b2418',ink:'#f6e7d4',acc:'#d9a066',pat:'rings'},
  kaa:{bg:'#1f4d3a',ink:'#f3ecd9',acc:'#e7b84a',pat:'stripes'},
  cru:{bg:'#f4e3c3',ink:'#4a2c14',acc:'#c8553d',pat:'dots'},
  cha:{bg:'#c2410c',ink:'#fff4e6',acc:'#ffd8a8',pat:'rings'},
  waf:{bg:'#2b2f6b',ink:'#ffe9f1',acc:'#ff8fb3',pat:'grid'}
};
var PAL=[
  {bg:'#2f3e2c',ink:'#eef3e3',acc:'#b7d36b',pat:'stripes'},
  {bg:'#7a1f2b',ink:'#ffeef0',acc:'#ffb4a2',pat:'dots'},
  {bg:'#13343b',ink:'#e6f4f1',acc:'#6fd6c5',pat:'rings'},
  {bg:'#f2e6d0',ink:'#2d2a26',acc:'#d1495b',pat:'grid'},
  {bg:'#2a2a2a',ink:'#fafafa',acc:'#ffd166',pat:'dots'}
];
/* Illustrated storefront in the cafe's brand colours. The real app would show the cafe's own photos from Supabase Storage. */
function photo(c){
  var b=brandOf(c), v=hh(c.id.length,c.id.charCodeAt(0)||0,5), v2=hh(c.id.charCodeAt(1)||0,c.id.length,9), rest=c.kind==='Restaurant', i, s='', n=6, aw='';
  for(i=0;i<n;i++)aw+='<rect x="'+(34+i*26.7)+'" y="30" width="26.8" height="16" fill="'+(i%2?b.ink:b.acc)+'"/>';
  var left=v>0.5, px=left?18:190;
  s+='<svg viewBox="0 0 224 108" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Illustration of '+plain(c.name)+'">';
  s+='<rect width="224" height="108" fill="'+b.acc+'"/><rect width="224" height="108" fill="#fff" opacity=".38"/>';
  s+='<circle cx="'+(v2>0.5?30:196)+'" cy="20" r="11" fill="#fff" opacity=".7"/>';
  s+='<rect x="26" y="26" width="172" height="70" fill="'+b.bg+'"/>';
  s+='<rect x="26" y="20" width="172" height="12" fill="'+b.bg+'"/><rect x="48" y="9" width="128" height="19" rx="4" fill="'+b.ink+'"/>';
  s+='<text x="112" y="23" text-anchor="middle" font-size="12" font-weight="800" letter-spacing="1.5" fill="'+b.bg+'" font-family="system-ui,sans-serif">'+initials(c.name)+(rest?' · KITCHEN':' · CAFE')+'</text>';
  s+=aw;
  s+='<rect x="42" y="52" width="76" height="40" rx="3" fill="#ffe3a3"/><rect x="42" y="52" width="76" height="40" rx="3" fill="none" stroke="'+b.ink+'" stroke-width="2"/><path d="M80 52v40M42 72h76" stroke="'+b.ink+'" stroke-width="1.5" opacity=".7"/>';
  if(rest){s+='<path d="M54 52v8M96 52v8" stroke="'+b.ink+'" stroke-width="1.5"/><ellipse cx="54" cy="64" rx="7" ry="4" fill="'+b.acc+'"/><ellipse cx="96" cy="64" rx="7" ry="4" fill="'+b.acc+'"/>';}
  else{s+='<path d="M52 92v-11h16v11z" fill="'+b.bg+'" opacity=".85"/><path d="M68 84h4a3 3 0 0 1 0 6h-4" fill="none" stroke="'+b.bg+'" stroke-width="1.6" opacity=".85"/><path d="M56 78c-2-3 2-4 0-7M62 78c-2-3 2-4 0-7" fill="none" stroke="'+b.bg+'" stroke-width="1.4" opacity=".6"/>';}
  s+='<rect x="136" y="52" width="46" height="44" rx="3" fill="'+b.ink+'" opacity=".92"/><circle cx="174" cy="76" r="2.2" fill="'+b.bg+'"/><rect x="144" y="60" width="30" height="10" rx="2" fill="'+b.acc+'"/>';
  s+='<rect x="0" y="92" width="224" height="16" fill="'+b.bg+'" opacity=".92"/><rect x="0" y="92" width="224" height="2" fill="'+b.ink+'" opacity=".25"/>';
  s+='<rect x="'+(px-5)+'" y="80" width="10" height="12" rx="2" fill="'+b.ink+'"/><circle cx="'+px+'" cy="76" r="8" fill="#5da56a"/><circle cx="'+(px-5)+'" cy="81" r="5" fill="#4a8f58"/><circle cx="'+(px+5)+'" cy="81" r="5" fill="#4a8f58"/>';
  return s+'</svg>';
}
function brandOf(c){return BRANDS[c.id]||PAL[Math.floor(hh(c.id.length,c.id.charCodeAt(1)||0,77)*PAL.length)%PAL.length]}
function bvars(b){return '--b-bg:'+b.bg+';--b-ink:'+b.ink+';--b-acc:'+b.acc}
function initials(n){return n.replace(/&amp;/g,' ').split(/\s+/).filter(function(w){return /^[A-Za-z]/.test(w)}).slice(0,2).map(function(w){return w.charAt(0).toUpperCase()}).join('')}

/* ---------- profile ---------- */
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')}
/* Only real image data or our own media path may go in an img src. Anything else is dropped. */
function safeImg(u){u=String(u||'');return (/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+\/=]+$/.test(u)||/^\/api\/media\/[\w\/.-]+$/.test(u))?u:''}
function fmtPh(d){d=d||'';return d.length>5?d.slice(0,5)+' '+d.slice(5):d}
function updateHeader(){
  var p=state.tab==='profile', a=$('#ava');
  $('#top').classList.toggle('prof',p);
  $('#hi').textContent=p?'Profile':(state.auth?'Hi, '+state.me.name:greet());
  a.dataset.act=p?'back':'profile'; a.setAttribute('aria-label',p?'Close profile':(state.auth?'Profile':'Sign up or log in'));
  a.innerHTML=p?X_ICON:(!state.auth?USER_ICON:safeImg(state.me.photo)?'<img src="'+esc(safeImg(state.me.photo))+'" alt="">':esc(state.me.name.charAt(0).toUpperCase()));
}
var toastT=0;
function toast(msg){var t=$('#toast');t.textContent=msg;t.hidden=false;clearTimeout(toastT);toastT=setTimeout(function(){t.hidden=true},2400)}
function showSheet(html){$('#scrim').classList.remove('center');$('#sheet').innerHTML=html;$('#scrim').hidden=false;$('#sheet').scrollTop=0}
var CHV='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';
function sw(on,act,id,label,dis){return '<button class="sw" role="switch" aria-checked="'+on+'" aria-label="'+label+'" data-act="'+act+'" data-id="'+id+'"'+(dis?' disabled':'')+'><i></i></button>'}
function swRow(title,sub,on,key){return '<div class="pr"><span class="pt">'+title+(sub?'<small>'+sub+'</small>':'')+'</span>'+sw(on,'tgl',key,title,false)+'</div>'}
function navRow(title,right,attrs){return '<button class="pr" '+attrs+'><span class="pt">'+title+'</span><span class="pv">'+right+CHV+'</span></button>'}
function renderProfile(){
  var list=joined(), m=state.me, off=!state.prefs.offers;
  var stamps=list.reduce(function(a,c){return a+c.stamps},0), ready=list.filter(function(c){return c.stamps>=GOAL}).length;
  var ph=m.phone?'+91 ••••• •••'+m.phone.slice(-2):'+91 ••••• •••••';
  var s='<div class="me"><div class="mav">'+(safeImg(m.photo)?'<img src="'+esc(safeImg(m.photo))+'" alt="">':esc(m.name.charAt(0).toUpperCase()))+'</div><div class="mt2"><h2>'+esc(m.name)+'</h2><p>'+ph+' · verified</p></div><button class="edit" data-act="edit">Edit</button></div>';
  s+='<div class="stats"><div><b>'+list.length+'</b><span>Cards</span></div><div><b>'+stamps+'</b><span>Stamps</span></div><div><b>'+ready+'</b><span>Rewards ready</span></div></div>';
  var sd=[]; if(m.birthday)sd.push({l:'Birthday',d:m.birthday}); (m.dates||[]).forEach(function(x){sd.push(x)});
  sd.forEach(function(x){x.n=inDays(x.d)}); sd.sort(function(a,b){return a.n-b.n});
  s+='<h3 class="gh">Special days</h3><div class="grp">'+(sd.length?sd.map(function(x){return '<div class="pr"><span class="pt">'+esc(x.l)+'<small>'+dm(x.d)+'</small></span><span class="pv">'+inTxt(x.n)+'</span></div>'}).join('')+navRow('Add or edit dates','','data-act="edit"'):navRow('Add your birthday and special dates','','data-act="edit"'))+
    swRow('Treats on special days','Cafes you joined may send you a treat',state.prefs.treats,'treats')+'</div>';
  var ab=[]; if(m.email)ab.push(['Email',m.email]); if(m.diet)ab.push(['Food preference',m.diet]); if(m.fav)ab.push(['Usual order',m.fav]);
  if(ab.length)s+='<h3 class="gh">About you</h3><div class="grp">'+ab.map(function(r){return '<div class="pr"><span class="pt">'+r[0]+'</span><span class="pv">'+esc(r[1])+'</span></div>'}).join('')+'</div>';
  s+='<h3 class="gh">Appearance</h3><div class="grp pad"><div class="seg" role="radiogroup" aria-label="Theme">'+[['system','System'],['light','Light'],['dark','Dark']].map(function(o){return '<button role="radio" aria-checked="'+(state.theme===o[0])+'" data-act="theme" data-id="'+o[0]+'">'+o[1]+'</button>'}).join('')+'</div></div>';
  s+='<h3 class="gh">Notifications</h3><div class="grp">'+swRow('Stamps and rewards','When you earn a stamp or a reward is ready',state.prefs.stamps,'stamps')+swRow('Offers from cafes','Deals from the cafes you joined',state.prefs.offers,'offers')+'</div>';
  if(list.length){
    s+='<h3 class="gh">Offers by cafe</h3><div class="grp">';
    list.forEach(function(c){s+='<div class="pr'+(off?' off':'')+'"><span class="pt">'+c.name+'<small>'+c.area+'</small></span>'+sw(c.offers!==false,'cafeoffer',c.id,'Offers from '+c.name.replace('&amp;','and'),off)+'</div>'});
    s+='</div>';
  }
  s+='<h3 class="gh">Nearby alerts</h3><div class="grp">'+swRow('Nearby cafe alerts','A popup when you pass a partner cafe, up to '+GEO_CAP+' a day. Needs location access set to Always.',state.geo.on,'geo')+
    '<div class="pr"><span class="pt">Popups today</span><span class="pv">'+state.geo.count+' of '+GEO_CAP+'</span></div>'+
    navRow('Try it: walk past a cafe','','data-act="sim"')+navRow('Reset today’s count','','data-act="georeset"')+'</div>';
  s+='<h3 class="gh">Location</h3><div class="grp">'+navRow('Current location',esc(state.city),'data-act="loc"')+'<div class="pr"><span class="pt">Nearby cafes</span><span class="pv">While using the app</span></div></div>';
  s+='<h3 class="gh">Privacy</h3><div class="grp">'+navRow('Download my data','','data-act="toast" data-msg="Your data export would start here (mock only)"')+navRow('Delete my data','','data-act="del"')+'</div>';
  s+='<h3 class="gh">Help</h3><div class="grp">'+navRow('Help centre','','data-act="toast" data-msg="Opens the help centre in the real app"')+navRow('Contact support','','data-act="toast" data-msg="Opens a support chat in the real app"')+navRow('Terms and privacy policy','','data-act="toast" data-msg="Opens the policy in the real app"')+'</div>';
  s+='<button class="logout" data-act="logout">Log out</button><p class="foot" style="text-align:center">Cafe Loyalty mock, example data only</p>';
  $('#profile').innerHTML=s;
}
var edP='', edD=[], MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function pd(s){var p=s.split('-');return new Date(+p[0],+p[1]-1,+p[2])}
function dm(s){var d=pd(s);return d.getDate()+' '+MON[d.getMonth()]}
function inDays(s){var d=pd(s),n=new Date(),t=new Date(n.getFullYear(),n.getMonth(),n.getDate()),x=new Date(t.getFullYear(),d.getMonth(),d.getDate());if(x<t)x=new Date(t.getFullYear()+1,d.getMonth(),d.getDate());return Math.round((x-t)/864e5)}
function inTxt(n){return n===0?'Today':n===1?'Tomorrow':'in '+n+' days'}
function todayISO(){var n=new Date();return n.getFullYear()+'-'+String(n.getMonth()+1).padStart(2,'0')+'-'+String(n.getDate()).padStart(2,'0')}
function dRows(){return edD.map(function(d,i){return '<div class="dr"><input class="dl" type="text" placeholder="e.g. Anniversary" maxlength="24" value="'+esc(d.l)+'" aria-label="Name of special day"><input class="dd" type="date" value="'+esc(d.d)+'" aria-label="Date"><button type="button" class="x" data-act="rmdate" data-id="'+i+'" aria-label="Remove date">'+X_ICON+'</button></div>'}).join('')}
function syncD(){var rows=document.querySelectorAll('#sd .dr');edD=[].map.call(rows,function(r){return {l:r.querySelector('.dl').value,d:r.querySelector('.dd').value}})}
function paintAdd(){var b=$('#addd');if(b)b.hidden=edD.length>=5}
function paintPv(){var v=$('#epv');if(!v)return;v.innerHTML=safeImg(edP)?'<img src="'+esc(safeImg(edP))+'" alt="Your photo">':esc(($('#en').value.trim()||state.me.name).charAt(0).toUpperCase());$('#rmp').hidden=!edP}
function openEdit(){
  var m=state.me; edP=m.photo||''; edD=(m.dates||[]).map(function(d){return {l:d.l,d:d.d}});
  var diets=['','Vegetarian','Eggetarian','Non-vegetarian','Vegan'];
  showSheet('<div class="grab"></div><div class="sh-head"><div><h3>Edit profile</h3><p>Your mobile number is verified and can’t be changed here.</p></div><button class="x" data-act="close" aria-label="Close">'+X_ICON+'</button></div>'+
    '<form id="editform" class="jf" novalidate>'+
    '<div class="phr"><div class="mav big" id="epv"></div><div class="phb"><button type="button" class="s" data-act="photo">Change photo</button><button type="button" class="s" id="rmp" data-act="rmphoto" hidden>Remove</button></div><input id="ep" type="file" accept="image/*" hidden></div>'+
    '<label for="en">Name</label><input id="en" type="text" autocomplete="given-name" value="'+esc(m.name)+'"><p class="err" id="eerr" hidden>Enter your name to continue.</p>'+
    '<label for="eb">Birthday</label><input id="eb" type="date" max="'+todayISO()+'" value="'+esc(m.birthday)+'"><p class="hint">Cafes can send you a treat on the day. Only day and month are shown.</p>'+
    '<label for="em">Email (optional)</label><input id="em" type="email" autocomplete="email" placeholder="you@example.com" value="'+esc(m.email)+'"><p class="err" id="mer" hidden>Enter a valid email address.</p>'+
    '<label>Special days</label><div id="sd">'+dRows()+'</div><button type="button" class="addd" id="addd" data-act="adddate">+ Add a special day</button>'+
    '<label for="ed">Food preference</label><select id="ed">'+diets.map(function(x){return '<option value="'+x+'"'+(m.diet===x?' selected':'')+'>'+(x||'Not set')+'</option>'}).join('')+'</select>'+
    '<label for="ef">Usual order (optional)</label><input id="ef" type="text" maxlength="40" placeholder="e.g. Oat flat white" value="'+esc(m.fav)+'">'+
    '<button class="submit" type="submit">Save</button></form>');
  paintPv(); paintAdd();
}
document.addEventListener('change',function(e){
  if(e.target.id!=='ep')return; var f=e.target.files&&e.target.files[0]; if(!f)return;
  if(!/^image\/(png|jpeg|webp)$/.test(f.type)){toast('Choose a JPEG, PNG or WebP photo');return}
  var fr=new FileReader();
  fr.onload=function(){var img=new Image();img.onload=function(){var s=256,c=document.createElement('canvas');c.width=c.height=s;var k=Math.min(img.width,img.height);c.getContext('2d').drawImage(img,(img.width-k)/2,(img.height-k)/2,k,k,0,0,s,s);edP=c.toDataURL('image/jpeg',0.85);paintPv()};img.onerror=function(){toast('Could not read that image')};img.src=fr.result};
  fr.readAsDataURL(f);
});
document.addEventListener('input',function(e){if(e.target.id==='en'&&!edP)paintPv()});
function openConfirm(kind){
  var d=kind==='del';
  showSheet('<div class="grab"></div><div class="sh-head"><div><h3>'+(d?'Delete your data?':'Log out?')+'</h3><p>'+(d?'This removes your account, cards and stamps. It can’t be undone.':'You will need your mobile number to sign back in.')+'</p></div><button class="x" data-act="close" aria-label="Close">'+X_ICON+'</button></div>'+
    '<div class="acts" style="margin-top:20px"><button class="s" data-act="close">Cancel</button><button class="p" data-act="confirm" data-id="'+kind+'">'+(d?'Delete my data':'Log out')+'</button></div>');
}
document.addEventListener('submit',function(e){
  if(e.target.id!=='editform')return; e.preventDefault();
  var v=$('#en').value.trim(); $('#eerr').hidden=!!v; if(!v){$('#en').focus();return}
  var em=$('#em').value.trim(), okm=!em||/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em); $('#mer').hidden=okm; if(!okm){$('#em').focus();return}
  syncD(); var me=state.me;
  me.name=v; me.photo=edP; me.birthday=$('#eb').value; me.email=em; me.diet=$('#ed').value; me.fav=$('#ef').value.trim();
  me.dates=edD.filter(function(d){return d.d}).map(function(d){return {l:d.l.trim()||'Special day',d:d.d}});
  updateHeader(); closeSheet(); renderProfile(); toast('Saved');
});

/* ---------- sign up / log in (name, mobile number, OTP) ---------- */
/* Mock only: any 6 digits are accepted. The real app would send the code by SMS through Supabase phone auth. */
var USER_ICON='<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/></svg>';
var autoT=0;
function savedAcct(){try{var a=JSON.parse(localStorage.getItem('cl-acct')||'null');return a&&a.name&&/^\d{10}$/.test(a.phone)?a:null}catch(e){return null}}
function saveAcct(){try{localStorage.setItem('cl-acct',JSON.stringify({name:state.me.name,phone:state.me.phone}))}catch(e){}}
var DEMO=cafes.filter(function(c){return c.joined}).map(function(c){return c.id}), otpT=0;
cafes.forEach(function(c){c.joined=false});
function greet(){var h=new Date().getHours();return h<12?'Good morning':h<17?'Good afternoon':'Good evening'}
setInterval(function(){if(!state.auth&&state.tab!=='profile')updateHeader()},60000);
function openAuth(pend){
  state.pend=pend||''; var sv=savedAcct();
  showSheet('<div class="grab"></div><div class="sh-head"><div><h3>Sign up or log in</h3><p>Enter your name and mobile number. We’ll text you a code to confirm it.</p></div><button class="x" data-act="close" aria-label="Close">'+X_ICON+'</button></div>'+
    (sv?'<button type="button" class="qa" data-act="quickauth"><span class="qav">'+esc(sv.name.charAt(0).toUpperCase())+'</span><span class="qat"><b>Continue as '+esc(sv.name)+'</b><small>+91 '+esc(sv.phone.slice(0,5))+' •••'+esc(sv.phone.slice(-2))+'</small></span>'+CHV+'</button><p class="or">or use a different number</p>':'')+
    '<form id="authform" class="jf" novalidate><label for="an">Name</label><input id="an" name="name" type="text" autocomplete="name" autocapitalize="words" value="'+esc(state.me.name)+'"><p class="err" id="aner" hidden>Enter your name to continue.</p>'+
    '<label for="ap">Mobile number</label><div class="ph"><span>+91</span><input id="ap" name="phone" type="tel" inputmode="numeric" autocomplete="tel-national" placeholder="98765 43210" maxlength="11" value="'+fmtPh(state.me.phone)+'"></div><p class="err" id="aper" hidden>Enter a valid 10-digit mobile number.</p>'+
    '<button class="submit" type="submit">Send OTP</button><p class="fine">By continuing you agree to the Terms and Privacy Policy.</p></form>');
  $('#an').focus();
}
function openOtp(){
  showSheet('<div class="grab"></div><div class="sh-head"><div><h3>Enter the code</h3><p>We sent a 6-digit code to +91 '+fmtPh(state.me.phone)+'. <button type="button" class="lnk" data-act="authback">Change</button></p></div><button class="x" data-act="close" aria-label="Close">'+X_ICON+'</button></div>'+
    '<form id="otpform" class="jf" novalidate><label for="ao">6-digit code</label><input id="ao" name="otp" class="otp" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="••••••"><p class="oauto" id="oauto" role="status">Waiting for your SMS…</p><p class="err" id="aoer" hidden>Enter the 6-digit code.</p>'+
    '<button class="submit" type="submit">Verify and continue</button><button type="button" class="rs" id="rsd" data-act="resend" disabled>Resend code in 30s</button><p class="fine">Mock: the code fills itself in a moment, like SMS autofill on a phone.</p></form>');
  $('#ao').focus(); clearInterval(otpT); clearTimeout(autoT); var n=30;
  autoT=setTimeout(function(){
    var o=$('#ao'); if(!o||o.value)return;
    o.value='482916'; $('#oauto').textContent='Code filled from your SMS';
    autoT=setTimeout(function(){var f=$('#otpform'); if(!f)return; if(f.requestSubmit)f.requestSubmit(); else f.dispatchEvent(new Event('submit',{cancelable:true,bubbles:true}))},800);
  },1500);
  otpT=setInterval(function(){var b=$('#rsd');if(!b){clearInterval(otpT);return} n--; if(n<=0){clearInterval(otpT);b.disabled=false;b.textContent='Resend code'}else b.textContent='Resend code in '+n+'s'},1000);
}
function signIn(){
  clearInterval(otpT); clearTimeout(autoT); state.auth=true; saveAcct();
  DEMO.forEach(function(id){byId(id).joined=true; if(walletOrder.indexOf(id)<0)walletOrder.push(id)});
  var pend=state.pend; state.pend='';
  updateHeader(); renderHome(); renderWallet(); refreshMap();
  if(pend){var c=byId(pend); if(c&&c.joined){openSheet(pend)}else{openJoin(pend)}}
  else{closeSheet(); toast('Welcome, '+state.me.name)}
}
function signOut(){
  state.auth=false; state.pend=''; state.route=null; state.sel=null;
  cafes.forEach(function(c){c.joined=false}); Object.keys(registry).forEach(function(k){registry[k].joined=false});
  walletOrder.length=0; ['agr','kaa','cru','cha'].forEach(function(i){walletOrder.push(i)});
  state.me={name:'',phone:'',photo:'',birthday:'',email:'',diet:'',fav:'',dates:[]};
  setTab('home'); renderWallet(); refreshMap();
}
document.addEventListener('submit',function(e){
  if(e.target.id==='authform'){
    e.preventDefault();
    var nm=$('#an').value.trim(), ph=$('#ap').value.replace(/\D/g,''), okn=nm!=='', okp=/^[6-9]\d{9}$/.test(ph);
    $('#aner').hidden=okn; $('#aper').hidden=okp;
    if(!okn){$('#an').focus();return} if(!okp){$('#ap').focus();return}
    state.me.name=nm; state.me.phone=ph; openOtp();
  } else if(e.target.id==='otpform'){
    e.preventDefault();
    var ok=/^\d{6}$/.test($('#ao').value); $('#aoer').hidden=ok;
    if(!ok){$('#ao').focus();return} signIn();
  }
});

/* ---------- nearby alerts (geofencing) ---------- */
/* Mock only: "walk" moves the blue dot toward a partner cafe. The real app registers a geofence around each nearby partner cafe with the phone's OS and gets an enter event, even with the app closed. */
var simT=null, lastSimId='';
function plain(n){return n.replace(/&amp;/g,'&')}
function startSim(){
  if(simT)return;
  var far=GEO_R*M_PER_PX+30;
  var cand=cafes.filter(function(c){return c.id!==lastSimId&&distOf(c)>far}).sort(function(a,b){return distOf(a)-distOf(b)})[0]||cafes.filter(function(c){return distOf(c)>far})[0];
  if(!cand)return;
  lastSimId=cand.id; simT={c:cand,last:performance.now()}; state.simRing=true; state.sel=null; state.route=null;
  closeSheet();
  if(state.tab!=='map')setTab('map'); else refreshMap();
  toast('Walking toward '+plain(cand.name)+'…');
  cam.x=you.x; cam.y=you.y+60; fly=null; invalidate();
  requestAnimationFrame(simStep);
}
function simStep(now){
  if(!simT)return;
  var c=simT.c, dt=Math.min(64,now-simT.last)/1000, dx=c.x-you.x, dy=c.y-you.y, d=Math.hypot(dx,dy), step=110*dt;
  simT.last=now;
  if(d-step<=GEO_R){
    var m=Math.max(0,d-GEO_R); you.x+=dx/d*m; you.y+=dy/d*m; simT=null;
    if(!drag){cam.x=you.x;cam.y=you.y+60}
    invalidate(); geoEnter(c);
    setTimeout(function(){state.simRing=false;invalidate()},4000);
    return;
  }
  you.x+=dx/d*step; you.y+=dy/d*step;
  if(!drag){cam.x=you.x;cam.y=you.y+60} vel.x=vel.y=0; invalidate();
  requestAnimationFrame(simStep);
}
function geoEnter(c){
  var g=state.geo, today=new Date().toDateString();
  if(g.day!==today){g.day=today;g.count=0}
  if(!g.on){toast('Nearby alerts are off, so no popup for '+plain(c.name));return}
  if(g.count>=GEO_CAP){toast('Daily limit of '+GEO_CAP+' reached, so no popup for '+plain(c.name));return}
  g.count++; showGeoPopup(c);
}
function showGeoPopup(c){
  var b=brandOf(c);
  showSheet('<div class="geo"><div class="bn pt-'+b.pat+'" style="'+bvars(b)+'"><span class="mono">'+initials(c.name)+'</span><div class="bn-t"><h3>'+c.name+'</h3><p>You’re '+fmt(distOf(c))+' away</p></div><button class="x" data-act="close" aria-label="Dismiss">'+X_ICON+'</button></div>'+
    '<p class="gp">'+c.offer+'</p><p class="gc">Nearby alert '+state.geo.count+' of '+GEO_CAP+' today</p>'+
    '<div class="acts">'+(c.joined?'<button class="p" data-act="sheet" data-id="'+c.id+'">Show Card</button>':'<button class="p" data-act="join" data-id="'+c.id+'">Join Loyalty</button>')+'<button class="s" data-act="geodir" data-id="'+c.id+'">Direction</button></div></div>');
  $('#scrim').classList.add('center');
}
function geoDirection(id){closeSheet();selectPlace(id);state.route=id;refreshMap()}

/* theme: System follows the phone; Light and Dark override it and are remembered on this device */
function getTheme(){try{return localStorage.getItem('cl-theme')||'system'}catch(err){return 'system'}}
function applyTheme(t){var r=document.documentElement;if(t==='system')r.removeAttribute('data-theme');else r.setAttribute('data-theme',t)}
function setTheme(t){state.theme=t;try{localStorage.setItem('cl-theme',t)}catch(err){}applyTheme(t);renderProfile();invalidate()}
state.theme=getTheme(); if(state.theme!=='system')applyTheme(state.theme);

renderHome(); renderWallet(); setTab('home'); detect();
/* Keep the login and profile on this device, so a reload or reopen stays signed in. */
function cleanMe(o){
  var t=function(v,n){return typeof v==='string'?v.slice(0,n):''}, dt=function(v){return /^\d{4}-\d{2}-\d{2}$/.test(v)?v:''};
  return {name:t(o.name,60),phone:/^\d{10}$/.test(o.phone)?o.phone:'',photo:safeImg(o.photo),birthday:dt(o.birthday),email:t(o.email,120),
    diet:['','Vegetarian','Eggetarian','Non-vegetarian','Vegan'].indexOf(o.diet)>-1?o.diet:'',fav:t(o.fav,40),
    dates:(Array.isArray(o.dates)?o.dates:[]).slice(0,5).map(function(d){return {l:t(d&&d.l,24),d:dt(d&&d.d)}}).filter(function(d){return d.d})};
}
function persistSess(){try{if(state.auth)localStorage.setItem('cl-sess',JSON.stringify({me:state.me,joined:walletOrder.filter(function(i){return byId(i)&&byId(i).joined})}));else localStorage.removeItem('cl-sess')}catch(e){}}
(function(){try{var s=JSON.parse(localStorage.getItem('cl-sess')||'null');if(s&&s.me&&s.me.name&&/^\d{10}$/.test(s.me.phone)){state.me=cleanMe(s.me);state.pend='';signIn();closeSheet();$("#toast").hidden=true}}catch(e){}})();
var lastSess='';setInterval(function(){var j=state.auth?JSON.stringify(state.me):'';if(j!==lastSess){lastSess=j;persistSess()}},800);
document.addEventListener('visibilitychange',function(){if(state.auth)persistSess()});

if('serviceWorker' in navigator&&(location.protocol==='https:'||location.hostname==='localhost')){
  var regSw=function(){navigator.serviceWorker.register('/sw.js').catch(function(){})};
  if(document.readyState==='complete')regSw(); else window.addEventListener('load',regSw);
}
