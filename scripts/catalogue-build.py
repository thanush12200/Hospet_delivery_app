#!/usr/bin/env python3
"""Assemble the FAA catalogue from the research agents' output.

Reads catalogue/work/group-*.jsonl, resizes each sourced photo to 480px and
writes it to public/catalogue/<slug>.jpg (served by the site, cached by the
service worker on first view), then writes:

  catalogue/faa-catalogue.csv      import-ready for Admin -> Import CSV
  catalogue/IMAGE_CREDITS.md       licence + author per photo (CC BY-SA needs it)
  public/catalogue/credits.html    the same, reachable from the Help screen

MRPs in the CSV are the agents' indicative prices; the store verifies them.
Usage: python3 scripts/catalogue-build.py [--site https://wink-1nn.pages.dev]
"""
import csv, glob, html, json, os, subprocess, sys

SITE = '--site' in sys.argv and sys.argv[sys.argv.index('--site') + 1] or 'https://wink-1nn.pages.dev'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)

CATEGORY_KN = {
    'Rice & Atta': 'ಅಕ್ಕಿ & ಹಿಟ್ಟು', 'Dals & Pulses': 'ಬೇಳೆ ಕಾಳುಗಳು', 'Oil & Ghee': 'ಎಣ್ಣೆ & ತುಪ್ಪ',
    'Masala & Spices': 'ಮಸಾಲೆ ಪದಾರ್ಥಗಳು', 'Tea & Coffee': 'ಚಹಾ & ಕಾಫಿ', 'Dairy & Bread': 'ಹಾಲು & ಬ್ರೆಡ್',
    'Fruits & Vegetables': 'ಹಣ್ಣು & ತರಕಾರಿ', 'Snacks & Biscuits': 'ತಿಂಡಿ & ಬಿಸ್ಕತ್ತು',
    'Personal Care': 'ವೈಯಕ್ತಿಕ ಆರೈಕೆ', 'Cleaning': 'ಸ್ವಚ್ಛತೆ', 'Household': 'ಗೃಹೋಪಯೋಗಿ',
}

starter = {}
for r in csv.DictReader(open('catalogue/wink-starter-catalogue.csv')):
    key = (r['name'].strip().lower(), r['unit'].strip().lower())
    starter[key] = r

rows, credits, missing_img, missing_mrp = [], [], [], []
for path in sorted(glob.glob('catalogue/work/group-*.jsonl')):
    for line in open(path):
        line = line.strip()
        if not line:
            continue
        try:
            j = json.loads(line)
        except json.JSONDecodeError as e:
            print(f'skip bad line in {path}: {e}', file=sys.stderr); continue
        base = starter.get((j['name'].strip().lower(), j['unit'].strip().lower()), {})
        slug = j['slug']
        image_url = ''
        img = j.get('image') or {}
        src = img.get('file')
        if src and os.path.exists(src):
            out = f'public/catalogue/{slug}.jpg'
            subprocess.run(['sips', src, '--resampleHeightWidthMax', '480', '-s', 'format', 'jpeg',
                            '-s', 'formatOptions', '82', '--out', out],
                           check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            image_url = f'{SITE}/catalogue/{slug}.jpg'
            credits.append((j['name'], j['unit'], img.get('page_url', ''), img.get('licence', ''), img.get('credit', '')))
        else:
            missing_img.append(f"{j['name']} {j['unit']}")
        mrp = j.get('mrp_rupees')
        if mrp in (None, ''):
            missing_mrp.append(f"{j['name']} {j['unit']}")
        brand = (base.get('brand') or '').strip() or (j.get('suggested_brand') or '').strip()
        rows.append({
            'name': j['name'], 'name_kn': base.get('name_kn', ''), 'brand': brand,
            'unit': j['unit'], 'mrp': '' if mrp in (None, '') else mrp, 'stock': '',
            'category': j['category'], 'category_kn': CATEGORY_KN.get(j['category'], ''),
            'description': (j.get('description') or '').strip().replace('\n', ' '),
            'image_url': image_url,
            'mrp_source': j.get('mrp_source') or '',
        })

rows.sort(key=lambda r: (r['category'], r['name'], r['unit']))
with open('catalogue/faa-catalogue.csv', 'w', newline='') as f:
    w = csv.DictWriter(f, fieldnames=['name', 'name_kn', 'brand', 'unit', 'mrp', 'stock', 'category',
                                      'category_kn', 'description', 'image_url', 'mrp_source'])
    w.writeheader(); w.writerows(rows)

with open('catalogue/IMAGE_CREDITS.md', 'w') as f:
    f.write('# Product photo credits\n\nPhotos under `public/catalogue/` are reused under their original licences. '
            'Open Food Facts photos are CC BY-SA 3.0 by Open Food Facts contributors.\n\n')
    for name, unit, page, lic, credit in sorted(credits):
        f.write(f'- **{name} {unit}** — {credit or "unknown author"}, {lic or "licence unrecorded"} — {page}\n')

with open('public/catalogue/credits.html', 'w') as f:
    f.write('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            '<title>FAA — photo credits</title>'
            '<style>body{font:15px/1.5 system-ui,sans-serif;max-width:720px;margin:24px auto;padding:0 16px;color:#14181F}'
            'a{color:#E5231F}li{margin:6px 0}</style>'
            '<h1>Product photo credits</h1><p>Product photos on FAA are reused under their original licences. '
            'Photos from <a href="https://world.openfoodfacts.org">Open Food Facts</a> are CC BY-SA 3.0 by Open Food Facts contributors.</p><ul>')
    for name, unit, page, lic, credit in sorted(credits):
        f.write(f'<li><b>{html.escape(name)} {html.escape(unit)}</b> — {html.escape(credit or "unknown author")}, '
                f'{html.escape(lic or "licence unrecorded")} — <a href="{html.escape(page)}">source</a></li>')
    f.write('</ul>')

print(f'{len(rows)} rows, {len(credits)} photos, {len(missing_img)} without photo, {len(missing_mrp)} without MRP')
if missing_img: print('no photo:', ', '.join(missing_img))
if missing_mrp: print('no MRP:', ', '.join(missing_mrp))
