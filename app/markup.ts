// The screens of the app as HTML, taken unchanged from the approved mock (docs/customer-mock.html).
export const markup = `<div id="app">
  <header class="top" id="top"><div class="top-in gut">
    <div><h1 class="hi" id="hi">Hi, Vashudev</h1><button class="loc busy" id="loc" data-act="loc" aria-label="Location, tap to change"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/></svg><span id="locname">Locating…</span><svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button></div>
    <button class="ava" id="ava" data-act="profile" aria-label="Profile">V</button>
  </div></header>

  <section class="screen" id="home-screen"><div class="gut" id="home"></div></section>
  <section class="screen" id="wallet-screen" hidden><div class="gut" id="wallet"></div></section>
  <section class="screen" id="profile-screen" hidden><div class="gut" id="profile"></div></section>
  <section class="screen" id="map-screen" hidden>
    <canvas id="mapcv" tabindex="0" role="application" aria-label="Map of nearby cafes and restaurants. Drag or use the arrow keys to explore."></canvas>
    <div class="area" id="area">Saraswathipuram</div>
    <button class="fab" id="recenter" data-act="recenter" aria-label="Back to my location"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="3.5"/><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4"/></svg></button>
    <button class="fab f2" id="simbtn" data-act="sim" aria-label="Simulate walking past a cafe"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="13" cy="4.5" r="1.8"/><path d="M9.5 21l2.2-6-2.2-2 1.5-4.5 4 1.5 2 3M11.7 15l3.3 1.5V21"/></svg></button>
  </section>
</div>

<div class="dock gut" id="dock" hidden><div class="dock-in" id="dockin"></div></div>

<div class="toast" id="toast" role="status" hidden></div>

<nav class="nav gut" id="nav" aria-label="Main"><div class="nav-in">
  <button class="nb" data-tab="home" aria-label="Home" aria-current="page"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 11.2 12 3l9 8.2V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg></button>
  <div class="nmid">
    <button data-tab="map" aria-label="Map and search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l5 5"/></svg></button>
    <input id="q" type="search" placeholder="Search cafes" autocomplete="off" aria-label="Search cafes and restaurants">
  </div>
  <button class="nb" data-tab="wallet" aria-label="Wallet"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H17v3H6.5a.9.9 0 0 0 0 1.8H19a1 1 0 0 1 1 1V18a2 2 0 0 1-2 2H6.5A2.5 2.5 0 0 1 4 17.5zM15.5 14.2a1.2 1.2 0 1 0 2.4 0 1.2 1.2 0 0 0-2.4 0z"/></svg></button>
</div></nav>

<div class="scrim" id="scrim" hidden><div class="sheet gut" id="sheet" role="dialog" aria-modal="true" aria-label="Loyalty card"></div></div>
`;
