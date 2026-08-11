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
if not node:
 errors.append(f'{repo} is not registered')
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

raw_relationships=contract.get('relationships') or []
if not isinstance(raw_relationships,list):
 errors.append('relationships must be a list')
 relationships=[]
else:
 relationships=[]
 for index,item in enumerate(raw_relationships):
  if not isinstance(item,dict):
   errors.append(f'relationships[{index}] must be an object')
   continue
  relationships.append(item)
kernel=[item for item in relationships if item.get('target')=='GlacierEQ/computer-user']
if len(kernel)!=1:
 errors.append('computer-user kernel relationship must appear exactly once')
else:
 rel=kernel[0]
 if rel.get('relation')!='COMPUTER_EXECUTION_KERNEL': errors.append('computer-user relation drift')
 if rel.get('kernel_main_sha')!='fe61227a97071c1bd3146f87b9bb0849874f844e': errors.append('computer-user canonical SHA drift')
 if rel.get('kernel_runtime_integration_proven') is not True: errors.append('kernel runtime proof state drift')
 if rel.get('persistent_host_activation_contract_verified') is not True: errors.append('host activation contract proof drift')
 if rel.get('persistent_production_host_verified') is not False: errors.append('persistent production host must remain unverified')
 if rel.get('pro_code_live_invocation_receipt') is not False: errors.append('pro-code live invocation must remain unclaimed without receipt')
if contract.get('runtime_integration_claimed') is not False:
 errors.append('pro-code runtime integration claim must remain false without its own receipt')

doc=Path('docs/COMPUTER_EXECUTION_KERNEL.md')
if not doc.is_file():
 errors.append('missing computer execution kernel contract doc')
else:
 text=doc.read_text(encoding='utf-8')
 for required in (
  'fe61227a97071c1bd3146f87b9bb0849874f844e',
  '079956542500fcfcdf161e88ed81c73e770de49d',
  'production deployment remains false',
  'issue #20',
 ):
  if required not in text: errors.append(f'kernel contract doc missing: {required}')

if errors:
 [print(f'::error::{e}') for e in errors]
 sys.exit(1)
print(json.dumps({
 'schema':'glaciereq.nervous-system.validation.v1',
 'status':'verified',
 'repository':repo,
 'role':node['role'],
 'manifest_version':manifest['version'],
 'computer_execution_kernel':'verified',
 'pro_code_live_invocation_receipt':False,
 'persistent_production_host_verified':False,
},indent=2))
