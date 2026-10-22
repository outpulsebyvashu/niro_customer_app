/* Small QR code encoder (byte mode, error correction M, versions 1 to 3: up to 42 characters). */
var QR=(function(){
  var EXP=[],LOG=[],x=1,i;
  for(i=0;i<255;i++){EXP[i]=x;LOG[x]=i;x<<=1;if(x&256)x^=0x11d}
  for(i=255;i<512;i++)EXP[i]=EXP[i-255];
  function gm(a,b){return a&&b?EXP[LOG[a]+LOG[b]]:0}
  function gen(n){var g=[1],j,k;for(j=0;j<n;j++){var ng=[];for(k=0;k<=g.length;k++)ng[k]=0;for(k=0;k<g.length;k++){ng[k]^=g[k];ng[k+1]^=gm(g[k],EXP[j])}g=ng}return g}
  function rem(data,n){var g=gen(n),r=[],k;for(k=0;k<n;k++)r[k]=0;data.forEach(function(b){var f=b^r[0];r.shift();r.push(0);for(k=0;k<n;k++)r[k]^=gm(g[k+1],f)});return r}
  var VERS=[{v:1,dc:16,ec:10},{v:2,dc:28,ec:16},{v:3,dc:44,ec:26}];
  function bytes(t){var o=[],k,c;t=unescape(encodeURIComponent(t));for(k=0;k<t.length;k++){c=t.charCodeAt(k);o.push(c)}return o}
  function encode(text){
    var d=bytes(text),ver=null,k;
    for(k=0;k<VERS.length;k++)if(d.length<=VERS[k].dc-2){ver=VERS[k];break}
    if(!ver)return null;
    var bits=[];function put(v,n){for(var b=n-1;b>=0;b--)bits.push((v>>b)&1)}
    put(4,4);put(d.length,8);d.forEach(function(b){put(b,8)});
    var cap=ver.dc*8;put(0,Math.min(4,cap-bits.length));while(bits.length%8)bits.push(0);
    var cw=[];for(k=0;k<bits.length;k+=8){var v=0;for(var b=0;b<8;b++)v=v*2+bits[k+b];cw.push(v)}
    for(k=0;cw.length<ver.dc;k++)cw.push(k%2?0x11:0xEC);
    cw=cw.concat(rem(cw,ver.ec));
    var size=17+4*ver.v,M=[],R=[],r,c;
    for(r=0;r<size;r++){M[r]=[];R[r]=[];for(c=0;c<size;c++){M[r][c]=0;R[r][c]=false}}
    function set(rr,cc,val){if(rr<0||cc<0||rr>=size||cc>=size)return;M[rr][cc]=val?1:0;R[rr][cc]=true}
    function finder(r0,c0){for(var dr=-1;dr<=7;dr++)for(var dc=-1;dc<=7;dc++){var inside=dr>=0&&dr<=6&&dc>=0&&dc<=6;set(r0+dr,c0+dc,inside&&(dr==0||dr==6||dc==0||dc==6||(dr>=2&&dr<=4&&dc>=2&&dc<=4)))}}
    finder(0,0);finder(0,size-7);finder(size-7,0);
    for(k=8;k<size-8;k++){set(6,k,k%2==0);set(k,6,k%2==0)}
    if(ver.v>=2){var a=size-7;for(r=-2;r<=2;r++)for(c=-2;c<=2;c++)set(a+r,a+c,Math.max(Math.abs(r),Math.abs(c))!=1)}
    set(size-8,8,true);
    for(k=0;k<9;k++){if(!R[8][k])set(8,k,0);if(!R[k][8])set(k,8,0)}
    for(k=0;k<8;k++){set(8,size-1-k,0);set(size-1-k,8,0)}
    set(size-8,8,true);
    var bi=0,up=true,col,row,dc2,cc;
    var allbits=[];cw.forEach(function(b){for(var q=7;q>=0;q--)allbits.push((b>>q)&1)});
    for(col=size-1;col>0;col-=2){
      if(col==6)col--;
      for(k=0;k<size;k++){row=up?size-1-k:k;for(dc2=0;dc2<2;dc2++){cc=col-dc2;if(!R[row][cc]){M[row][cc]=allbits[bi++]||0}}}
      up=!up;
    }
    var best=null,bestP=1e9,m;
    for(m=0;m<8;m++){var G=build(m);var p=penalty(G);if(p<bestP){bestP=p;best=G}}
    function cond(m,r,c){switch(m){case 0:return (r+c)%2==0;case 1:return r%2==0;case 2:return c%3==0;case 3:return (r+c)%3==0;case 4:return (Math.floor(r/2)+Math.floor(c/3))%2==0;case 5:return (r*c)%2+(r*c)%3==0;case 6:return ((r*c)%2+(r*c)%3)%2==0;default:return ((r+c)%2+(r*c)%3)%2==0}}
    function build(m){
      var G=M.map(function(row,r){return row.map(function(v,c){return !R[r][c]&&cond(m,r,c)?v^1:v})});
      var data=(0<<3)|m,rm=data<<10,q;for(q=14;q>=10;q--)if((rm>>q)&1)rm^=0x537<<(q-10);
      var f=((data<<10)|rm)^0x5412;
      function bit(i){return (f>>i)&1}
      function sf(x,y,v){G[y][x]=v}
      for(q=0;q<=5;q++)sf(8,q,bit(q));sf(8,7,bit(6));sf(8,8,bit(7));sf(7,8,bit(8));
      for(q=9;q<15;q++)sf(14-q,8,bit(q));
      for(q=0;q<8;q++)sf(size-1-q,8,bit(q));
      for(q=8;q<15;q++)sf(8,size-15+q,bit(q));
      sf(8,size-8,1);
      return G;
    }
    function penalty(G){
      var p=0,r,c,run,dark=0,line;
      for(r=0;r<size;r++){for(var pass=0;pass<2;pass++){run=1;for(c=1;c<size;c++){var a=pass?G[c][r]:G[r][c],b2=pass?G[c-1][r]:G[r][c-1];if(a==b2){run++;if(run==5)p+=3;else if(run>5)p++}else run=1}}}
      for(r=0;r<size-1;r++)for(c=0;c<size-1;c++){var s=G[r][c]+G[r][c+1]+G[r+1][c]+G[r+1][c+1];if(s==0||s==4)p+=3}
      var pat1=[1,0,1,1,1,0,1,0,0,0,0],pat2=[0,0,0,0,1,0,1,1,1,0,1];
      for(r=0;r<size;r++)for(c=0;c<=size-11;c++){for(var pass2=0;pass2<2;pass2++){var ok1=true,ok2=true;for(var t=0;t<11;t++){var v=pass2?G[c+t][r]:G[r][c+t];if(v!=pat1[t])ok1=false;if(v!=pat2[t])ok2=false}if(ok1)p+=40;if(ok2)p+=40}}
      for(r=0;r<size;r++)for(c=0;c<size;c++)dark+=G[r][c];
      p+=Math.floor(Math.abs(dark*20-size*size*10)/(size*size))*10;
      return p;
    }
    return best;
  }
  function svg(text,label){
    var G=encode(String(text));if(!G)return '';
    var n=G.length,r,c,d='';
    for(r=0;r<n;r++)for(c=0;c<n;c++)if(G[r][c])d+='M'+c+' '+r+'h1v1h-1z';
    return '<svg class="qr" viewBox="-3 -3 '+(n+6)+' '+(n+6)+'" role="img" aria-label="'+(label||'QR code')+'" shape-rendering="crispEdges"><rect x="-3" y="-3" width="'+(n+6)+'" height="'+(n+6)+'" fill="#fff"/><path d="'+d+'" fill="#0b0b0b"/></svg>';
  }
  return {encode:encode,svg:svg};
})();
