import os, re, sys

files_to_scan = [
    'server/db/db.ts',
    'server/routes/documents.ts',
    'server/services/ocr/AzureDocumentIntelligenceProvider.ts',
    'server/services/ocr/types.ts',
    'server/services/quality/CellQualityEvaluator.ts',
    'server/services/quality/CellQualityEvaluator.test.ts',
    'server/services/unifiedTableService.ts',
    'server/services/unifiedTableService.test.ts',
    'src/components/common/StatusBadge.tsx',
    'src/components/ocr/OcrReviewWorkspace.tsx',
    'src/pages/DashboardPage.tsx',
    'src/pages/DocumentsPage.tsx',
    'src/services/api.ts',
    'src/types/index.ts',
]

# Patterns for secrets
patterns = [
    re.compile(r'eyJ[a-zA-Z0-9_\-]{20,}\.[a-zA-Z0-9_\-]{20,}\.[a-zA-Z0-9_\-]{20,}'), # JWT
    re.compile(r'(?i)bearer\s+[a-zA-Z0-9_\-\.]{25,}'),                                # Bearer token
    re.compile(r'(?i)(?:supabase_service_role_key|service_role_key|azure_key|api_key)\s*[:=]\s*[\'"][^\'"]{20,}[\'"]'), # hardcoded key assignments
    re.compile(r'(?i)(?:password|passwd|secret)\s*[:=]\s*[\'"][^\'"]{8,}[\'"]'),       # hardcoded passwords
    re.compile(r'-----BEGIN (?:RSA |EC )?PRIVATE KEY-----'),                           # private keys
]

risk_found = False
for fpath in files_to_scan:
    if not os.path.exists(fpath):
        continue
    with open(fpath, 'r', encoding='utf-8', errors='ignore') as f:
        content = f.read()
    for p in patterns:
        matches = p.findall(content)
        if matches:
            # Filter out false positives in comments/mocks if any
            filtered = []
            for m in matches:
                # check if it is just a type or variable name
                if 'process.env' in m or 'Authorization' in m and 'Bearer ${' in m:
                    continue
                filtered.append(m)
            if filtered:
                print(f"Risk pattern matched in {fpath}: count={len(filtered)}")
                risk_found = True

import subprocess

diff_output = subprocess.check_output(['git', 'diff'], text=True, errors='ignore')
for p in patterns:
    for m in p.finditer(diff_output):
        val = m.group(0)
        if 'process.env' in val or 'example' in val.lower():
            continue
        print("Risk pattern matched in git diff")
        risk_found = True

if risk_found:
    print("SECRET RISK FOUND")
    sys.exit(1)
else:
    print("SECRET SCAN PASS")

