# Writes public/privacy.html, public/terms.html and public/help.html. Run: python3 scripts/make-pages.py
import html, os
UPDATED = '22 October 2026'
CSS = """
:root{--p:#5e17eb;--ink:#17112b;--mut:#5d5873;--line:#e7e3f0;--bg:#fff}
@media(prefers-color-scheme:dark){:root{--ink:#f3f0fb;--mut:#b2abc6;--line:#2c2740;--bg:#100c1d;--p:#a98bff}}
*{box-sizing:border-box}html,body{margin:0}body{background:var(--bg);color:var(--ink);font:16px/1.65 Poppins,system-ui,sans-serif}
main{max-width:720px;margin:0 auto;padding:20px 20px 64px}
.top{display:flex;align-items:center;gap:10px;margin:4px 0 26px}.top a{color:var(--p);font-weight:600;text-decoration:none;display:flex;align-items:center;gap:10px}
.top svg{width:30px;height:30px;fill:var(--p)}
h1{font-size:30px;line-height:1.2;margin:0 0 6px}h2{font-size:19px;margin:34px 0 8px}p,li{color:var(--mut)}li{margin:6px 0}
.date{font-size:14px}a{color:var(--p)}ul{padding-left:20px}
details{border-top:1px solid var(--line);padding:14px 0}details:last-of-type{border-bottom:1px solid var(--line)}
summary{font-weight:600;color:var(--ink);cursor:pointer}details p{margin:10px 0 0}
.card{border:1px solid var(--line);border-radius:16px;padding:16px 18px;margin:24px 0}
.nav{display:flex;gap:16px;flex-wrap:wrap;margin-top:40px;font-size:14px}
"""
MARK = '<svg viewBox="230 230 540 540" aria-hidden="true"><path d="M404 246Q434 446 562 500Q434 554 404 754Q374 554 246 500Q374 446 404 246Z"/><path d="M596 246Q626 446 754 500Q626 554 596 754Q566 554 438 500Q566 446 596 246Z"/></svg>'
def page(fn, title, body):
    open(os.path.join('public', fn), 'w').write(f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>{title} · Niro</title><meta name="theme-color" content="#5e17eb">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&display=swap" rel="stylesheet">
<style>{CSS}</style></head><body><main>
<div class="top"><a href="/">{MARK}<span>niro</span></a></div>
{body}
<div class="nav"><a href="/help.html">Help centre</a><a href="/privacy.html">Privacy policy</a><a href="/terms.html">Terms of use</a><a href="/">Back to Niro</a></div>
</main></body></html>
""")

privacy = f"""<h1>Privacy policy</h1><p class="date">Last updated {UPDATED}</p>
<p>Niro is a digital loyalty card. You collect stamps at partner cafes and restaurants, and Niro can tell you when you are near one. This page explains what we collect, why, and what you can do about it. We wrote it in plain words on purpose.</p>

<h2>What we collect</h2>
<ul>
<li><b>Account:</b> your mobile number and name. We use the number to verify it is you (we text you a one-time code).</li>
<li><b>Optional profile details:</b> email, birthday, special days, food preference, usual order and a profile photo. You choose whether to add any of these.</li>
<li><b>Loyalty activity:</b> the cafes you join, your member code, stamps, rewards and the history of both, and offers you save.</li>
<li><b>Location:</b> your phone shares its location with the Niro page while it is open. We use it to show cafes near you and to decide when to show a nearby alert. Your approximate coordinates are sent to our server to find nearby cafes and to name your area. We do not keep a location history. We only record that a nearby alert was shown (which cafe, and when) so we can keep to the limit of two a day.</li>
<li><b>Messages to support:</b> what you write, and the contact detail you give us.</li>
<li><b>Technical data:</b> a sign-in cookie that keeps you logged in for 30 days. Your IP address is used briefly to limit abuse (for example, too many code requests). It is stored only in scrambled (hashed) form with support messages.</li>
</ul>

<h2>How we use it</h2>
<ul><li>To run your account and your loyalty cards.</li><li>To show nearby cafes, offers and alerts.</li><li>To keep Niro safe and stop misuse.</li><li>To answer your messages.</li></ul>
<p>We do not sell your data and we do not show third-party ads.</p>

<h2>Who else sees it</h2>
<ul>
<li><b>Cafes you join</b> can see that you are a member, your name, and your card activity (stamps and rewards). They can send you offers only if you left offers switched on for that cafe, and you can switch that off in Profile at any time.</li>
<li><b>Cloudflare</b> hosts Niro and stores our database.</li>
<li><b>Our SMS provider</b> (StartMessaging) receives your mobile number and the code so it can deliver the text.</li>
<li><b>OpenStreetMap</b> supplies the map. Your phone loads map pictures from OpenStreetMap, so it can see your IP address and which area of the map you view. Our server also asks OpenStreetMap for the name of your area, using rounded coordinates, without your name or number.</li>
<li>We may share information if the law requires it.</li>
</ul>

<h2>How long we keep it</h2>
<p>We keep your account until you delete it. One-time codes expire after 5 minutes. Sign-in sessions last 30 days. When you delete your data, your profile, cards, stamps, saved offers and nearby-alert records are removed.</p>

<h2>Your choices</h2>
<ul>
<li><b>See and fix your details:</b> Profile, then Edit.</li>
<li><b>Download your data:</b> Profile, then Download my data. You get one file with everything we hold about you.</li>
<li><b>Delete your data:</b> Profile, then Delete my data. This cannot be undone.</li>
<li><b>Nearby alerts:</b> switch them off in Profile. You can also block location for this site in your browser settings, but then Niro cannot open.</li>
<li><b>Questions or complaints:</b> use Profile, then Contact support. We will reply as soon as we can. You also have the rights given by Indian data protection law, including access, correction and erasure.</li>
</ul>

<h2>Security</h2>
<p>Codes are stored only in scrambled form and are limited to a few tries. Sign-in cookies are protected and sent only over a secure connection. No system is perfectly safe, so please keep your phone locked.</p>

<h2>Children</h2>
<p>Niro is for people aged 18 and over. If you think a child has given us their details, contact support and we will delete them.</p>

<h2>Changes</h2>
<p>If we change this policy in a way that matters, we will say so in the app. The date at the top shows the latest version.</p>"""

terms = f"""<h1>Terms of use</h1><p class="date">Last updated {UPDATED}</p>
<p>By using Niro you agree to these terms. If you do not agree, please do not use the service.</p>

<h2>What Niro does</h2>
<p>Niro lets you hold digital loyalty cards for partner cafes and restaurants, collect stamps, save offers, and get nearby alerts. Each cafe runs its own loyalty programme. Rewards, offers and their conditions come from the cafe, not from Niro.</p>

<h2>Your account</h2>
<ul><li>You must be 18 or older.</li><li>Give your real name and your own mobile number, and keep them up to date.</li><li>You are responsible for what happens on your account. Do not share your one-time codes with anyone.</li></ul>

<h2>Stamps and rewards</h2>
<ul>
<li>Stamps are added by cafe staff when you pay. Show your QR code or member code at the counter.</li>
<li>Stamps and rewards have no cash value and cannot be sold or transferred.</li>
<li>A cafe may remove stamps or rewards that were added by mistake or by misuse, and may change or end its programme or offers.</li>
</ul>

<h2>What you must not do</h2>
<ul><li>Use Niro to cheat or misuse a cafe's programme, for example by creating several accounts to collect extra rewards.</li><li>Try to break into Niro, overload it, or access other people's data.</li><li>Upload photos or write messages that are unlawful, hateful or not yours to share.</li></ul>
<p>We may suspend or close accounts that break these rules.</p>

<h2>Nearby alerts and location</h2>
<p>Alerts work while Niro is open on your phone, use your location, and are limited to two a day. They are meant as helpful hints, not guarantees. Location may be inaccurate or unavailable.</p>

<h2>Availability</h2>
<p>We work to keep Niro running, but it may sometimes be unavailable or change. We may add, change or remove features.</p>

<h2>Liability</h2>
<p>Niro is provided as it is. To the extent the law allows, we are not responsible for a cafe's rewards, prices, quality or conduct, or for losses that come from using or not being able to use Niro. Nothing here limits rights you have by law.</p>

<h2>Ending your use</h2>
<p>You can stop using Niro at any time and delete your data in Profile, then Delete my data.</p>

<h2>Changes and contact</h2>
<p>We may update these terms and will say so in the app when the change matters. Indian law applies. For questions, use Profile, then Contact support. See also our <a href="/privacy.html">Privacy policy</a>.</p>"""

faqs = [
("How do I sign up or log in?", "Tap the person icon, enter your name and mobile number, and we text you a 6-digit code. Enter it and you are in. The same steps log you in again later."),
("I did not get my code.", "Check the number is right and that you have signal. Wait 30 seconds and tap Resend. You can ask for up to 5 codes an hour. If it still does not arrive, use Contact support and tell us your number."),
("How do I earn stamps?", "Open a cafe's card in Cards and show the QR code or the member code at the counter when you pay. Staff add the stamp. When the card is full, ask for your reward."),
("Where is my card?", "Join a cafe from the map or the Home screen. Cards you join appear in Cards. Your cards stay with your account, so they are there when you log in on another phone."),
("Why does Niro need my location?", "To show cafes near you and to alert you when you pass a partner cafe. Niro asks every time it opens. Without location it cannot open."),
("Why did I not get a nearby alert?", "Alerts only work while Niro is open on your phone, you must be signed in, and Nearby cafe alerts must be on in Profile. Niro shows at most two a day."),
("Location is blocked. How do I fix it?", "Tap the lock icon next to the address bar, set Location to Allow, then tap Ask again in Niro."),
("How do I save an offer?", "Tap Save on any offer on the Home screen. Find your saved offers in Profile, then Saved offers."),
("How do I change my name, birthday or photo?", "Profile, then Edit. Birthday and special days let cafes send you a treat if you leave treats on."),
("Can I put Niro on my home screen?", "Yes. In Chrome tap the menu and choose Add to Home screen or Install app. On iPhone use Share, then Add to Home Screen."),
("How do I download or delete my data?", "Profile, then Download my data gives you a file with everything we hold about you. Delete my data removes your account for good."),
("Which cafes are on Niro?", "Only partner cafes that have joined. If none show near you yet, none have joined in your area. Ask your favourite cafe to join."),
]
help_ = f"""<h1>Help centre</h1><p>Quick answers. If yours is not here, open Niro, go to Profile and tap Contact support.</p>
{''.join(f'<details><summary>{html.escape(q)}</summary><p>{html.escape(a)}</p></details>' for q,a in faqs)}
<div class="card"><b>Still stuck?</b><p style="margin:6px 0 0">Open Niro, tap the person icon, then Contact support, and write to us. Please include your mobile number if you cannot sign in.</p></div>"""

page('privacy.html','Privacy policy',privacy)
page('terms.html','Terms of use',terms)
page('help.html','Help centre',help_)
print('written')
