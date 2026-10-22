# Builds the upload bundle for Cloudflare Pages from this repo. Run: python3 scripts/build-static.py <outdir>
# Output: index.html, app/gate/qr scripts, legal + admin pages, icons, manifest, service worker, _headers, _routes.json, _worker.js
import os, re, shutil, subprocess, sys
out = sys.argv[1] if len(sys.argv) > 1 else 'dist-pages'
os.makedirs(out, exist_ok=True)
rd = lambda p: open(p, encoding='utf-8').read()
def wr(p, s):
    os.makedirs(os.path.dirname(os.path.join(out, p)) or out, exist_ok=True)
    open(os.path.join(out, p), 'w', encoding='utf-8').write(s)

markup = re.search(r'export const markup = `(.*)`;', rd('app/markup.ts'), re.S).group(1)
css = rd('app/globals.css')
head = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#f7f7f5" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0b0b0b" media="(prefers-color-scheme: dark)">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Niro">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<title>Niro</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700&family=DM+Sans:wght@400;500;600;700&display=swap">
<style>html,body{margin:0}[hidden]{display:none!important}
"""
html = head + css + "\n</style>\n</head>\n<body>\n" + markup + '\n<script src="/qr.js"></script>\n<script src="/gate.js"></script>\n<script src="/app.js"></script>\n</body>\n</html>\n'
wr('index.html', html)
for src, dst in [('public/legacy/app.js', 'app.js'), ('public/legacy/gate.js', 'gate.js'), ('public/legacy/qr.js', 'qr.js'),
                 ('public/privacy.html', 'privacy.html'), ('public/terms.html', 'terms.html'), ('public/help.html', 'help.html'),
                 ('public/favicon.svg', 'favicon.svg'), ('public/manifest.webmanifest', 'manifest.webmanifest'), ('public/sw.js', 'sw.js')]:
    shutil.copy(src, os.path.join(out, dst))
shutil.copy('public/favicon.ico', os.path.join(out, 'favicon.ico'))
shutil.rmtree(os.path.join(out, 'icons'), ignore_errors=True); shutil.copytree('public/icons', os.path.join(out, 'icons'))
wr('_routes.json', '{"version":1,"include":["/api/*"],"exclude":[]}\n')
csp = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob: https://tile.openstreetmap.org; connect-src 'self'; manifest-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
wr('_headers', f"""/sw.js
  Cache-Control: no-cache
/manifest.webmanifest
  Content-Type: application/manifest+json
/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: DENY
  Permissions-Policy: geolocation=(self), camera=(), microphone=()
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  Content-Security-Policy: {csp}
""")
# worker: sql.ts + index.ts, types stripped
sql = rd('worker/src/sql.ts').replace('export const', 'const')
idx = re.sub(r"^import .*sql\.ts';\n", '', rd('worker/src/index.ts'), flags=re.M)
tmp = os.path.join(out, '_w.ts'); open(tmp, 'w').write(sql + '\n' + idx)
js = subprocess.run(['node', '--no-warnings', '-e', "const m=require('module'),fs=require('fs');process.stdout.write(m.stripTypeScriptTypes(fs.readFileSync(process.argv[1],'utf8'),{mode:'transform'}))", tmp], capture_output=True, text=True, check=True).stdout
os.remove(tmp); wr('_worker.js', js)
print('built', out)
