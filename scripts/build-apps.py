# Builds the three business apps for Cloudflare Pages. Run: python3 scripts/build-apps.py <outdir>
# Output: <outdir>/partner, <outdir>/workforce, <outdir>/admin. Each is its own Pages project; all use the same D1 database (binding DB).
import os, re, shutil, subprocess, sys
out = sys.argv[1] if len(sys.argv) > 1 else 'dist-apps'
rd = lambda p: open(p, encoding='utf-8').read()
sql = rd('worker/src/sql.ts').replace('export const', 'const')
idx = re.sub(r"^import .*sql\.ts';\n", '', rd('worker/src/index.ts'), flags=re.M)
tmp = os.path.join(out, '_w.ts'); os.makedirs(out, exist_ok=True); open(tmp, 'w').write(sql + '\n' + idx)
worker = subprocess.run(['node', '--no-warnings', '-e', "const m=require('module'),fs=require('fs');process.stdout.write(m.stripTypeScriptTypes(fs.readFileSync(process.argv[1],'utf8'),{mode:'transform'}))", tmp], capture_output=True, text=True, check=True).stdout
os.remove(tmp)
APPS = {'partner': ('Niro Client', 'geolocation=(self), camera=()'), 'workforce': ('Niro Workforce', 'geolocation=(), camera=(self)'), 'admin': ('Niro Admin', 'geolocation=(self), camera=()')}
csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
for name, (title, perm) in APPS.items():
    d = os.path.join(out, name); shutil.rmtree(d, ignore_errors=True); os.makedirs(d)
    for f in ['kit.css', 'kit.js']: shutil.copy(f'apps/{f}', d)
    shutil.copy(f'apps/{name}/index.html', d); shutil.copy(f'apps/{name}/app.js', d)
    shutil.copy('public/favicon.svg', d); shutil.copy('public/favicon.ico', d); shutil.copytree('public/icons', os.path.join(d, 'icons'))
    open(os.path.join(d, 'manifest.webmanifest'), 'w').write('{"name":"%s","short_name":"%s","start_url":"/","display":"standalone","background_color":"#f7f7f5","theme_color":"#0b0b0b","icons":[{"src":"/icons/icon-192.png","sizes":"192x192","type":"image/png"},{"src":"/icons/icon-512.png","sizes":"512x512","type":"image/png"}]}' % (title, title.replace('Niro ', '')))
    open(os.path.join(d, '_routes.json'), 'w').write('{"version":1,"include":["/api/*"],"exclude":[]}\n')
    open(os.path.join(d, '_headers'), 'w').write(f"""/manifest.webmanifest
  Content-Type: application/manifest+json
/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: same-origin
  X-Frame-Options: DENY
  Permissions-Policy: {perm}, microphone=()
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  Content-Security-Policy: {csp}
""")
    open(os.path.join(d, '_worker.js'), 'w').write(worker)
    zp = os.path.join(out, f'niro-{name}.zip')
    if os.path.exists(zp): os.remove(zp)
    subprocess.run(['zip', '-qr', os.path.abspath(zp), '.'], cwd=d, check=True)
print('built', out)
