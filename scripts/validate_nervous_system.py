#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
from urllib.request import urlopen
URL='https://raw.githubusercontent.com/GlacierEQ/AKOS/main/governance/glaciereq.nervous-system.v1.json'
contract=json.loads(Path('.glaciereq/nervous-system.node.json').read_text())
manifest=json.loads(urlopen(URL,timeout=20).read().decode())
repo=os.environ.get('GITHUB_REPOSITORY',contract.get('repository'))
node=manifest.get('nodes',{}).get(repo)
errors=[]
if not node: errors.append(f'{repo} is not registered')
else:
 if contract.get('schema_id')!=manifest.get('schema_id'): errors.append('schema_id drift')
 if contract.get('repository')!=repo: errors.append('repository identity drift')
 if contract.get('role')!=node.get('role'): errors.append('role drift')
 expected=f"{manifest['canonical_repository']}/{manifest['canonical_path']}"
 if contract.get('canonical_manifest')!=expected: errors.append('canonical manifest pointer drift')
 if contract.get('operating_sequence')!=manifest.get('operating_sequence'): errors.append('operating sequence drift')
 readme=Path('README.md').read_text(encoding='utf-8').lower()
 for term in node.get('required_terms',[]):
  if term.lower() not in readme: errors.append(f'README missing term: {term}')
 for link in node.get('required_links',[]):
  if link.lower() not in readme: errors.append(f'README missing link: {link}')
if errors:
 [print(f'::error::{e}') for e in errors]
 sys.exit(1)
print(json.dumps({'schema':'glaciereq.nervous-system.validation.v1','status':'verified','repository':repo,'role':node['role'],'manifest_version':manifest['version']},indent=2))
