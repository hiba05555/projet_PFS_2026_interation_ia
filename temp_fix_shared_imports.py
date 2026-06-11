from pathlib import Path
root = Path('services')
for p in root.rglob('*.js'):
    text = p.read_text(encoding='utf-8')
    new = text.replace("require('../../shared/middleware/auth')", "require('./shared/middleware/auth')")
    new = new.replace("require('../../shared/middleware/db')", "require('./shared/middleware/db')")
    if text != new:
        p.write_text(new, encoding='utf-8')
        print('updated', p)
