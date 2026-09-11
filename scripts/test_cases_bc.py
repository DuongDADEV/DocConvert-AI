import os, time, json, requests
from dotenv import load_dotenv

load_dotenv()
ENDPOINT = os.getenv('AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT', '').rstrip('/')
KEY = os.getenv('AZURE_DOCUMENT_INTELLIGENCE_KEY', '')

def analyze_crop(img_path, model_id='prebuilt-layout'):
    url = f"{ENDPOINT}/documentintelligence/documentModels/{model_id}:analyze?api-version=2024-11-30"
    headers = {'Ocp-Apim-Subscription-Key': KEY, 'Content-Type': 'image/png'}
    with open(img_path, 'rb') as f:
        data = f.read()

    res = None
    for i in range(5):
        res = requests.post(url, headers=headers, data=data)
        if res.status_code == 429:
            print('Submit 429, waiting 10s...')
            time.sleep(10.0)
            continue
        break

    if not res or res.status_code not in (200, 202):
        return {'error': f'Submit error: {res.status_code if res else "None"}'}

    op_loc = res.headers.get('Operation-Location')
    for attempt in range(25):
        time.sleep(3.0)
        p_res = requests.get(op_loc, headers={'Ocp-Apim-Subscription-Key': KEY})
        if p_res.status_code == 429:
            time.sleep(5.0)
            continue
        if p_res.status_code != 200:
            continue
        body = p_res.json()
        if body.get('status') == 'succeeded':
            ar = body.get('analyzeResult', {})
            content = ar.get('content', '').strip().replace('\n', ' ')
            words = []
            for p in ar.get('pages', []):
                for w in p.get('words', []):
                    words.append((w.get('content'), w.get('confidence')))
            return {'content': content, 'words': words}
        elif body.get('status') in ('failed', 'canceled'):
            return {'error': body.get('status')}

    return {'error': 'timeout'}

def main():
    tests = [
        ('Case B', '919ZTRF2429915O2', 'scratch/crops/case_B_tight_300dpi.png'),
        ('Case B', '919ZTRF2429915O2', 'scratch/crops/case_B_medium_300dpi.png'),
        ('Case B', '919ZTRF2429915O2', 'scratch/crops/case_B_tight_200dpi.png'),
        ('Case C', '9192hv6243011321', 'scratch/crops/case_C_tight_300dpi.png'),
        ('Case C', '9192hv6243011321', 'scratch/crops/case_C_medium_300dpi.png'),
        ('Case C', '9192hv6243011321', 'scratch/crops/case_C_tight_200dpi.png'),
        ('Case A (read model)', '919ZTRF2429915O0', 'scratch/crops/case_A_tight_300dpi.png', 'prebuilt-read'),
        ('Case B (read model)', '919ZTRF2429915O2', 'scratch/crops/case_B_tight_300dpi.png', 'prebuilt-read'),
        ('Case C (read model)', '9192hv6243011321', 'scratch/crops/case_C_tight_300dpi.png', 'prebuilt-read'),
    ]

    results = []
    for item in tests:
        name = item[0]
        gt = item[1]
        path = item[2]
        model = item[3] if len(item) > 3 else 'prebuilt-layout'
        print(f'Running {name} ({os.path.basename(path)}, model={model})...')
        out = analyze_crop(path, model_id=model)
        print(f'-> {out}')
        results.append({
            'name': name,
            'gt': gt,
            'path': path,
            'model': model,
            'result': out
        })
        time.sleep(3.0)

    with open('scratch/q2d1_cases_bc_read_results.json', 'w', encoding='utf-8') as f:
        json.dump(results, f, indent=2)
    print('All done!')

if __name__ == '__main__':
    main()
