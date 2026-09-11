import json, fitz

# Load col peers
with open('scratch/q2d1_col_peers.json', encoding='utf-8') as f:
    peers = json.load(f)

# Filter non-empty cells
valid_cells = [p for p in peers if p.get('rawValue') and len(p.get('rawValue').strip()) > 0]
print(f'Total non-empty reference cells: {len(valid_cells)}')

doc = fitz.open('scratch/nam_a_fresh.pdf')

# We will select a diverse sample of 25 reference cells across Page 1 and Page 2:
# - GL30 family (numeric-alpha mixed): e.g. 919GL3024129C4YA
# - CV00 family (with spaces): e.g. 919CV00VND 00001
# - cs1i family (lowercase): e.g. 919cs1i24148I0QB
# - NAP2 family: e.g. 919NAP224152TOL6, 919NAP224185U25F, 919NAP224216V2RD
# - ZTRF family: e.g. 919ZTRF241520A6F, 919ZTRF241770F2X, 919ZTRF241850GQH, 919ZTRF242070L3J, 919ZTRF242420SHN, 919ZTRF242991500, 919ZTRF242991502
# - ea9x family: e.g. 919ea9x24179F25I
# - gfgg family: e.g. 919gfgg24209G2D7
# - ipgd family: e.g. 919ipgd24240N767
# - q238 family: e.g. 919q23824271C301
# - 2hv6 family: e.g. 9192hv6243011321

# Let's inspect the ground truths by checking the text layer and visuals in the PDF!
sample_records = []
for cell in valid_cells:
    row_idx = cell['rowIdx']
    page_num = cell['page']
    val = cell['rawValue']
    conf = cell['conf']
    conf_src = cell['confSource']
    sev = cell['severity']
    reasons = cell['reasons']
    sample_records.append({
        'rowIdx': row_idx,
        'page': page_num,
        'ocr_val': val,
        'conf': conf,
        'conf_src': conf_src,
        'severity': sev,
        'reasons': reasons
    })

print(f'Prepared {len(sample_records)} candidate records.')
with open('scratch/reference_sample_candidates.json', 'w', encoding='utf-8') as f:
    json.dump(sample_records, f, indent=2)
