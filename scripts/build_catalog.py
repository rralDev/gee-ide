import urllib.request
import json
import concurrent.futures
import time
import os
import gzip

ROOT_URL = 'https://storage.googleapis.com/earthengine-stac/catalog/catalog.json'

def fetch_json(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'GEE-IDE-CatalogBuilder/1.0'})
    with urllib.request.urlopen(req, timeout=12) as response:
        return json.loads(response.read().decode('utf-8'))

print("1. Fetching STAC root catalog...")
root = fetch_json(ROOT_URL)
providers = [l for l in root.get('links', []) if l.get('rel') == 'child']
print(f"Found {len(providers)} providers.")

print("2. Fetching provider subcatalogs...")
dataset_links = []

def get_provider(p):
    try:
        sub = fetch_json(p['href'])
        children = [l for l in sub.get('links', []) if l.get('rel') == 'child']
        return children
    except Exception as e:
        print(f"Failed provider {p.get('title')}: {e}")
        return []

with concurrent.futures.ThreadPoolExecutor(max_workers=30) as executor:
    results = executor.map(get_provider, providers)
    for res in results:
        dataset_links.extend(res)

print(f"Found {len(dataset_links)} dataset entries. Now fetching compact metadata...")

def get_dataset_metadata(link):
    href = link.get('href')
    title = link.get('title', '')
    try:
        data = fetch_json(href)
        asset_id = data.get('id') or title
        gee_type = data.get('gee:type', 'image_collection')
        desc = data.get('title') or title
        keywords = data.get('keywords', [])
        temporal = data.get('extent', {}).get('temporal', {}).get('interval', [[]])[0]
        start_date = temporal[0][:10] if len(temporal) > 0 and temporal[0] else ''
        end_date = temporal[1][:10] if len(temporal) > 1 and temporal[1] else 'present'
        
        # Extract band names if present
        bands = []
        eo_bands = data.get('summaries', {}).get('eo:bands', [])
        if isinstance(eo_bands, list):
            bands = [b.get('name') for b in eo_bands if isinstance(b, dict) and b.get('name')][:12]
        
        return {
            'id': asset_id,
            'title': desc,
            'type': gee_type,
            'start': start_date,
            'end': end_date,
            'tags': keywords[:8],
            'bands': bands
        }
    except Exception as e:
        # Fallback to minimal info from title
        return {
            'id': title.replace('_', '/'),
            'title': title,
            'type': 'image_collection',
            'start': '',
            'end': '',
            'tags': [],
            'bands': []
        }

catalog = []
start_t = time.time()
with concurrent.futures.ThreadPoolExecutor(max_workers=35) as executor:
    futures = {executor.submit(get_dataset_metadata, link): link for link in dataset_links}
    completed = 0
    for future in concurrent.futures.as_completed(futures):
        completed += 1
        if completed % 150 == 0 or completed == len(dataset_links):
            print(f"Processed {completed}/{len(dataset_links)} datasets ({time.time() - start_t:.1f}s)...")
        res = future.result()
        if res and res.get('id'):
            catalog.append(res)

# Sort catalog alphabetically by ID
catalog.sort(key=lambda x: x['id'].lower())

os.makedirs('data', exist_ok=True)
out_file = 'data/ee_catalog.json'
with open(out_file, 'w', encoding='utf-8') as f:
    json.dump(catalog, f, separators=(',', ':'), ensure_ascii=False)

file_size_kb = os.path.getsize(out_file) / 1024
print(f"Successfully generated {out_file} with {len(catalog)} datasets ({file_size_kb:.1f} KB)!")
