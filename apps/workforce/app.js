/* Niro Workforce: for cafe staff. Clock in and out, scan a customer's QR, add stamps, give rewards. */
var root=$('#root'), J=[], ji=0, card=null, scanStop=null, tick=0;
boot(root,{title:'Niro Workforce',sub:'For cafe staff. Sign in with the mobile number your manager added.',load:function(){return api('GET','/api/staff/me')},render:function(d){J=d.jobs;if(ji>=J.length)ji=0;draw()}});
function job(){return J[ji]}
function refreshJobs(){return api('GET','/api/staff/me').then(function(d){J=d.jobs;if(ji>=J.length)ji=0;draw()})}
function el(s){return (new Date()-new Date(s))}
function dur(ms){var m=Math.floor(ms/60000),h=Math.floor(m/60);return h+'h '+String(m%60).padStart(2,'0')+'m'}
function draw(){
  stopScan();clearInterval(tick);
  var h='<div class="top"><div class="brandmark">niro <small>workforce</small></div><button class="s sm" id="out">Log out</button></div>';
  if(!J.length){root.innerHTML=h+'<h1>You are not added yet</h1><p class="mut">Ask your cafe owner or manager to add your mobile number in Niro Client. Then pull down to refresh this page.</p><div class="acts"><button id="rf">Check again</button></div>';$('#out').onclick=logout;$('#rf').onclick=refreshJobs;return}
  var j=job();
  if(J.length>1)h+='<div class="tabs" id="jobs">'+J.map(function(x,i){return '<button data-j="'+i+'" aria-current="'+(i===ji)+'">'+esc(x.name)+'</button>'}).join('')+'</div>';
  h+='<h1 style="margin-top:10px">'+esc(j.name)+'</h1><p class="mut" style="margin:2px 0 14px">You are '+esc(j.role)+'</p>';
  h+='<div class="card"><b>Shift</b><div id="shift" style="margin:6px 0 0"></div><div class="acts"><button class="full" id="clk"></button></div></div>';
  h+='<div class="card"><b>Stamp a customer</b><p class="mut" style="margin:4px 0 0">Scan the QR on their phone, or type the member code.</p><div class="acts"><button class="full" id="scan">Scan QR code</button></div><form id="cf" class="row" style="margin-top:12px"><input id="code" placeholder="Member code" autocapitalize="characters" autocomplete="off" maxlength="20"><button style="flex:none" class="s">Find</button></form><p class="err" id="ce" hidden></p></div>';
  h+='<h2>Today</h2><div class="card" id="today"><p class="mut" style="margin:0">Loading…</p></div>';
  root.innerHTML=h;$('#out').onclick=logout;
  if($('#jobs'))$('#jobs').onclick=function(e){var b=e.target.closest('button');if(b){ji=+b.dataset.j;draw()}};
  paintShift();
  $('#clk').onclick=function(){var b=this;b.disabled=true;api('POST','/api/staff/'+(j.clocked_in_since?'clock-out':'clock-in'),{cafe_id:j.cafe_id}).then(function(){return refreshJobs()}).then(function(){toast(job().clocked_in_since?'Clocked in':'Clocked out')}).catch(function(x){b.disabled=false;toast(x.message)})};
  $('#scan').onclick=startScan;
  $('#cf').onsubmit=function(e){e.preventDefault();lookup($('#code').value)};
  loadToday();
}
function paintShift(){var j=job(),s=$('#shift'),b=$('#clk');if(!s)return;
  function p(){s.textContent=j.clocked_in_since?'Working since '+when(j.clocked_in_since)+' · '+dur(el(j.clocked_in_since)):'You are not clocked in.'}
  p();b.textContent=j.clocked_in_since?'Clock out':'Clock in';if(j.clocked_in_since)tick=setInterval(p,30000)}
function loadToday(){api('GET','/api/staff/today?cafe_id='+job().cafe_id).then(function(d){var t=$('#today');if(!t)return;
  t.innerHTML='<div class="stats" style="margin-bottom:6px"><div class="stat"><b>'+d.stamps+'</b><span>Stamps you gave today</span></div><div class="stat"><b>'+d.events.filter(function(x){return x.kind==='redeem'}).length+'</b><span>Rewards you gave</span></div></div>'+
    d.events.map(function(x){return '<div class="li"><span>'+esc(x.customer)+'<small>'+when(x.created_at)+'</small></span><b>'+(x.kind==='redeem'?'Reward':'+'+x.qty)+'</b></div>'}).join('')}).catch(function(){})}
function lookup(code){
  code=String(code||'').trim().toUpperCase();if(!code)return;var er=$('#ce');if(er)er.hidden=true;
  api('GET','/api/staff/card?code='+encodeURIComponent(code)).then(function(c){card=c;card.code=code;stopScan();closeSheet();showCard()}).catch(function(x){if(er){er.textContent=x.message;er.hidden=false}else toast(x.message)});
}
function showCard(){
  var c=card,full=c.stamps>=c.stamp_goal,room=c.stamp_goal-c.stamps,q=1;
  var s=sheet('<h2 style="margin-top:0">'+esc(c.name)+'</h2><p class="mut" style="margin:2px 0 12px">'+esc(c.cafe)+' · '+c.stamps+' of '+c.stamp_goal+' stamps</p>'+
    '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">'+Array.apply(null,Array(c.stamp_goal)).map(function(_,i){return '<span style="width:26px;height:26px;border-radius:50%;border:2px '+(i<c.stamps?'solid':'dashed')+' var(--ink);background:'+(i<c.stamps?'var(--ink)':'transparent')+'"></span>'}).join('')+'</div>'+
    (full?'<div class="card"><b>Reward ready: '+esc(c.reward_text)+'</b></div><div class="acts"><button class="full" id="rd">Give reward</button></div>'
      :'<div class="row" style="align-items:center"><button class="s" id="mn" style="flex:none">−</button><div style="text-align:center;font:700 28px var(--f1)" id="qn">1</div><button class="s" id="pl" style="flex:none">+</button></div><div class="acts"><button class="full" id="st">Add 1 stamp</button></div>')+
    '<p class="err" id="se" hidden></p><div class="acts"><button class="s full" id="cl">Close</button></div>');
  $('#cl').onclick=closeSheet;
  if(full)$('#rd').onclick=function(){var b=this;b.disabled=true;api('POST','/api/staff/redeem',{code:c.code}).then(function(){closeSheet();toast('Reward given');loadToday()}).catch(function(x){b.disabled=false;$('#se').textContent=x.message;$('#se').hidden=false})};
  else{
    function upd(){$('#qn').textContent=q;$('#st').textContent='Add '+q+' stamp'+(q>1?'s':'')}
    $('#mn').onclick=function(){q=Math.max(1,q-1);upd()};$('#pl').onclick=function(){q=Math.min(room,5,q+1);upd()};
    $('#st').onclick=function(){var b=this;b.disabled=true;api('POST','/api/staff/stamp',{code:c.code,qty:q}).then(function(r){closeSheet();toast(r.reward_ready?'Stamped. Reward is ready!':'Stamped. '+r.stamps+' of '+r.stamp_goal);loadToday()}).catch(function(x){b.disabled=false;$('#se').textContent=x.message;$('#se').hidden=false})};
  }
}
/* camera scanning uses the phone's built-in QR reader (BarcodeDetector). If a browser lacks it, type the code. */
function startScan(){
  if(!('BarcodeDetector' in window)||!navigator.mediaDevices){toast('This browser cannot scan. Type the code instead.');return}
  var s=sheet('<h2 style="margin-top:0">Scan the QR code</h2><video id="vid" playsinline muted style="width:100%;border-radius:18px;background:#000;aspect-ratio:1/1;object-fit:cover"></video><p class="mut" id="sm">Point at the customer\'s card.</p><div class="acts"><button class="s full" id="sc">Cancel</button></div>');
  var vid=$('#vid'),stream=null,alive=true,det=new BarcodeDetector({formats:['qr_code']});
  scanStop=function(){alive=false;if(stream)stream.getTracks().forEach(function(t){t.stop()});scanStop=null};
  $('#sc').onclick=function(){stopScan();closeSheet()};
  navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'},audio:false}).then(function(st){stream=st;if(!alive){st.getTracks().forEach(function(t){t.stop()});return}vid.srcObject=st;vid.play();
    (function loop(){if(!alive)return;det.detect(vid).then(function(r){if(r&&r.length){var v=String(r[0].rawValue||'').trim();if(v){stopScan();lookup(v);return}}setTimeout(loop,200)}).catch(function(){setTimeout(loop,300)})})()
  }).catch(function(){stopScan();closeSheet();toast('Camera is blocked. Allow the camera, or type the code.')});
}
function stopScan(){if(scanStop)scanStop()}
