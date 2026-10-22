"""services_data.json: digital services + add-on 234 from the catalogue (name, category, short description, includes, turnaround)."""
import json, re, sys
import openpyxl
X, OUT = sys.argv[1], sys.argv[2]
wb = openpyxl.load_workbook(X, read_only=True)
rows = list(wb['Products'].iter_rows(values_only=True))[1:]
out = []
for r in rows:
    if r[3] in ('Digital service', 'Professional service') or r[0] == 234:
        d = r[15] or ''
        d = re.sub(r'This is a 100% digital service[^.]*\.( No physical item is printed, produced or shipped\.)?', '', d)
        d = re.sub(r'Typical turnaround:.*$|Turnaround:.*$', '', d).strip()
        d = re.sub(r'Final price is confirmed.*$', '', d).strip()
        inc = None
        m = re.search(r'Includes:\s*(.*?)(\s*\[?digital\]?)?$', d)
        if m:
            inc = [x.strip() for x in re.split(r'\s\+\s', re.sub(r'\s*Printing sold separately\.?', '', m.group(1)).strip())]
            d = d[:m.start()].strip()
        d = re.sub(r'\s+', ' ', d)
        if len(d) > 230:
            d = d[:230].rsplit(' ', 1)[0] + '…'
        out.append(dict(id=r[0], name=r[1], category=r[2], desc=d, includes=inc, turnaround=(r[7] or '').replace('Recurring monthly', 'Monthly, recurring'), digital=(r[0] != 234)))
json.dump(out, open(OUT, 'w'), indent=1, ensure_ascii=False)
print(len(out), 'services')
