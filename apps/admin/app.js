/* Niro Admin: the whole platform. Approve cafes, add cafes, read support messages. Only numbers in ADMIN_PHONES can use it. */
var root=$('#root'), OV=null, CAFES=[], MSGS=[], tab='cafes', sup='open';
boot(root,{title:'Niro Admin',sub:'Platform admin. Only approved admin numbers can sign in.',
  load:function(){return Promise.all([api('GET','/api/admin/overview'),api('GET','/api/admin/cafes'),api('GET','/api/admin/support?status='+sup)])},
  render:function(r){OV=r[0];CAFES=r[1].cafes;MSGS=r[2].messages;draw()}});
function reload(msg){return Promise.all([api('GET','/api/admin/overview'),api('GET','/api/admin/cafes'),api('GET','/api/admin/support?status='+sup)]).then(function(r){OV=r[0];CAFES=r[1].cafes;MSGS=r[2].messages;draw();if(msg)toast(msg)}).catch(function(e){toast(e.message)})}
function draw(){
  var h='<div class="top"><div class="brandmark">niro <small>admin</small></div><button class="s sm" id="out">Log out</button></div>';
  h+='<div class="stats">'+[[OV.users,'Users'],[OV.cafes_live,'Cafes live'],[OV.cafes_pending,'Waiting approval'],[OV.cards,'Loyalty cards'],[OV.stamps_today,'Stamps today'],[OV.rewards_redeemed,'Rewards given']].map(function(s){return '<div class="stat"><b>'+s[0]+'</b><span>'+s[1]+'</span></div>'}).join('')+'</div>';
  h+='<div class="tabs" id="tabs" style="margin-top:16px">'+[['cafes','Cafes'],['add','Add cafe'],['support','Support'+(OV.support_open?' ('+OV.support_open+')':'')]].map(function(t){return '<button data-t="'+t[0]+'" aria-current="'+(tab===t[0])+'">'+t[1]+'</button>'}).join('')+'</div><div id="body">'+body()+'</div>';
  root.innerHTML=h;$('#out').onclick=logout;$('#tabs').onclick=function(e){var b=e.target.closest('button');if(b){tab=b.dataset.t;draw()}};bind();
}
function body(){
  if(tab==='cafes'){var pend=CAFES.filter(function(c){return !c.is_active}),live=CAFES.filter(function(c){return c.is_active});
    function row(c){return '<div class="li" data-id="'+esc(c.id)+'"><span><b>'+esc(c.name)+'</b><span class="pill'+(c.is_active?' on':'')+'">'+(c.is_active?'Live':'Hidden')+'</span><small>'+esc(c.kind)+' · '+esc(c.area||'')+' '+esc(c.city)+' · '+c.members+' members</small></span><span class="acts" style="margin:0;justify-content:flex-end"><button class="sm s" data-a="tog">'+(c.is_active?'Hide':'Approve')+'</button><button class="sm s" data-a="more">More</button></span></div>'}
    return (pend.length?'<h2>Waiting for approval</h2><div class="card">'+pend.map(row).join('')+'</div>':'')+'<h2>Live cafes</h2><div class="card">'+(live.length?live.map(row).join(''):'<p class="mut" style="margin:0">No live cafes yet.</p>')+'</div>'}
  if(tab==='add')return '<form id="add" class="card"><label for="n">Name</label><input id="n" maxlength="80"><div class="row"><div><label for="k">Type</label><select id="k"><option value="cafe">Cafe</option><option value="restaurant">Restaurant</option></select></div><div><label for="g">Stamps for reward</label><input id="g" type="number" min="1" max="20" value="8"></div></div>'+
    '<div class="row"><div><label for="a">Area</label><input id="a" maxlength="60"></div><div><label for="c">City</label><input id="c" maxlength="60" value="Mysuru"></div></div><div class="row"><div><label for="la">Latitude</label><input id="la" inputmode="decimal"></div><div><label for="lo">Longitude</label><input id="lo" inputmode="decimal"></div></div><div class="acts"><button type="button" class="s" id="here">Use my current location</button></div>'+
    '<div class="row"><div><label for="op">Opens</label><input id="op" type="time" value="08:00"></div><div><label for="cl">Closes</label><input id="cl" type="time" value="22:00"></div></div><label for="r">Reward</label><input id="r" maxlength="60" value="Free filter coffee"><label for="of">First offer (optional)</label><input id="of" maxlength="100">'+
    '<div class="row"><div><label for="b1">Background</label><input id="b1" type="color" value="#3b2418"></div><div><label for="b2">Text</label><input id="b2" type="color" value="#f5e6d3"></div><div><label for="b3">Accent</label><input id="b3" type="color" value="#d9a066"></div></div><label for="pt">Pattern</label><select id="pt"><option>dots</option><option>stripes</option><option>rings</option><option>grid</option></select>'+
    '<label for="ow">Owner mobile number (optional)</label><input id="ow" type="tel" inputmode="numeric" maxlength="10" placeholder="They manage it in Niro Client"><p class="err" id="aer" hidden></p><div class="acts"><button>Add cafe (goes live now)</button></div></form>';
  if(tab==='support')return '<div class="tabs"><button data-s="open" aria-current="'+(sup==='open')+'">Open</button><button data-s="closed" aria-current="'+(sup==='closed')+'">Closed</button></div>'+'<div class="card">'+(MSGS.length?MSGS.map(function(m){return '<div class="li" style="align-items:flex-start"><span><b>'+esc(m.contact||'No contact given')+'</b><small>'+dayt(m.created_at)+'</small><span style="display:block;margin-top:6px;white-space:pre-wrap">'+esc(m.message)+'</span></span><button class="sm s" data-m="'+esc(m.id)+'" data-to="'+(sup==='open'?'closed':'open')+'">'+(sup==='open'?'Close':'Reopen')+'</button></div>'}).join(''):'<p class="mut" style="margin:0">Nothing here.</p>')+'</div>';
}
function bind(){
  document.querySelectorAll('[data-a]').forEach(function(b){b.onclick=function(){var id=b.closest('.li').dataset.id,c=CAFES.filter(function(x){return x.id===id})[0];
    if(b.dataset.a==='tog')api('PATCH','/api/admin/cafes/'+id,{is_active:!c.is_active}).then(function(){reload(c.is_active?'Hidden':'Live now')}).catch(function(x){toast(x.message)});
    else more(c)}});
  document.querySelectorAll('[data-s]').forEach(function(b){b.onclick=function(){sup=b.dataset.s;reload()}});
  document.querySelectorAll('[data-m]').forEach(function(b){b.onclick=function(){api('PATCH','/api/admin/support/'+b.dataset.m,{status:b.dataset.to}).then(function(){reload('Updated')}).catch(function(x){toast(x.message)})}});
  var f=$('#add');if(!f)return;$('#here').onclick=function(){here($('#la'),$('#lo'),$('#here'))};
  f.onsubmit=function(e){e.preventDefault();var er=$('#aer');er.hidden=true;if(!$('#n').value.trim()||!$('#la').value||!$('#lo').value){er.textContent='Add the name and the location.';er.hidden=false;return}
    var body={name:$('#n').value.trim(),kind:$('#k').value,stamp_goal:+$('#g').value||8,area:$('#a').value.trim()||undefined,city:$('#c').value.trim(),lat:+$('#la').value,lng:+$('#lo').value,opens:$('#op').value,closes:$('#cl').value,reward_text:$('#r').value.trim(),offer_title:$('#of').value.trim()||undefined,brand:{bg:$('#b1').value,ink:$('#b2').value,acc:$('#b3').value,pattern:$('#pt').value}};
    var ow=$('#ow').value.replace(/\D/g,'');
    api('POST','/api/admin/cafes',body).then(function(d){return ow?api('POST','/api/admin/cafes/'+d.id+'/staff',{phone:ow,role:'manager'}):0}).then(function(){tab='cafes';reload('Cafe added and live')}).catch(function(x){er.textContent=x.message;er.hidden=false})};
}
function more(c){
  var s=sheet('<h2 style="margin-top:0">'+esc(c.name)+'</h2><p class="mut" style="margin:2px 0">'+c.lat.toFixed(5)+', '+c.lng.toFixed(5)+' · '+c.members+' members</p><div class="acts"><button class="s full" id="mo">Add offer</button><button class="s full" id="ms">Add staff or manager</button>'+(c.is_active?'':'<button class="danger full" id="md">Delete cafe</button>')+'<button class="s full" id="mc">Close</button></div>');
  $('#mc').onclick=closeSheet;
  $('#mo').onclick=function(){var t=prompt('Offer text');if(t)api('POST','/api/admin/cafes/'+c.id+'/offers',{title:t}).then(function(){closeSheet();toast('Offer added')}).catch(function(x){toast(x.message)})};
  $('#ms').onclick=function(){var p=prompt('Mobile number (10 digits)');if(!p)return;var r=confirm('OK = manager, Cancel = staff')?'manager':'staff';api('POST','/api/admin/cafes/'+c.id+'/staff',{phone:p.replace(/\D/g,''),role:r}).then(function(){closeSheet();toast('Added')}).catch(function(x){toast(x.message)})};
  if($('#md'))$('#md').onclick=function(){if(confirm('Delete this cafe and all its cards? This cannot be undone.'))api('DELETE','/api/admin/cafes/'+c.id).then(function(){closeSheet();reload('Deleted')}).catch(function(x){toast(x.message)})};
}
setInterval(function(){if(OV&&tab==='cafes'&&!$('#scrim')&&!document.hidden)reload()},20000);
