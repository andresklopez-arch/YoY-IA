import re

with open('styles/globals.css', 'r', encoding='utf-8') as f:
    content = f.read()

# Find all blocks and their selectors
blocks = re.findall(r'([^{]+)\{([^}]+)\}', content)

for selector, body in blocks:
    selector = selector.strip()
    body = body.strip()
    if 'mesa' in selector:
        print(f"Selector: {selector}")
        for line in body.split('\n'):
            print(f"  {line.strip()}")
        print("-" * 40)
