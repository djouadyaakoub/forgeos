import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseSemver,compareSemver,classifyVersionBump} from '../policy/version.mjs';
import {buildDiscoveryResult,discoverUniversalOsUpdate} from '../intelligence/update/checker.mjs';
import {evaluateActivationVersionOrder} from '../intelligence/update/activate.mjs';
import {discoverLatestGithubRelease} from '../intelligence/update/github.mjs';

test('official SemVer chain and all pairwise reverse comparisons',()=>{
  const chain=['1.0.0-alpha','1.0.0-alpha.1','1.0.0-alpha.beta','1.0.0-beta','1.0.0-beta.2','1.0.0-beta.11','1.0.0-rc.1','1.0.0'];
  for(let i=0;i<chain.length;i++)for(let j=0;j<chain.length;j++)assert.equal(compareSemver(chain[i],chain[j]),Math.sign(i-j));
});
test('RC progression, core ordering and existing 1.x behavior',()=>{
  for(const [a,b] of [['2.0.0-rc.1','2.0.0-rc.2'],['2.0.0-rc.2','2.0.0'],['1.9.0','1.10.0'],
    ['1.0.9','1.0.10'],['1.99.99','2.0.0-alpha'],['1.0.0-9','1.0.0-a'],['1.0.0-A','1.0.0-a']]){
    assert.equal(compareSemver(a,b),-1);assert.equal(compareSemver(b,a),1);
  }
  assert.equal(classifyVersionBump('1.0.0','1.1.0'),'MINOR');assert.equal(classifyVersionBump('1.0.0','1.0.1'),'PATCH');
  assert.equal(classifyVersionBump('1.0.0','2.0.0-rc.1'),'MAJOR');
  assert.equal(classifyVersionBump('2.0.0-rc.1','2.0.0'),'NONE'); // core bump, not update availability
  assert.equal(classifyVersionBump('2.0.0','1.99.99'),'NONE');
  assert.equal(parseSemver('1.0.1').patch,1);
});
test('build metadata does not affect precedence, but full identity is retained',()=>{
  for(const [a,b] of [['2.0.0+build.1','2.0.0+build.2'],['2.0.0-rc.1+build.7','2.0.0-rc.1+build.9'],
    ['2.0.0','2.0.0+001']])assert.equal(compareSemver(a,b),0);
  const p=parseSemver('2.0.0-rc.1+build.007');assert.deepEqual(p.build,['build','007']);assert.equal(p.raw,'2.0.0-rc.1+build.007');
});
const malformed=['2.x.0','2.0','v2','v2.0.0','vv2.0.0','V2.0.0','2.0.0-','2.0.0-01',
  '02.0.0','2.00.0','2.0.00','2.0.0-rc.01','2.0.0+','2.0.0+a..b','2.0.0-a..b','2.0.0_a',
  ' 2.0.0','2.0.0 ','2.0.0\n','2.0.0\r\n','2.0.0-α','2.0.0+💡','2e1.0.0','-2.0.0','',null,undefined,2,{},['2.0.0']];
test('invalid versions throw explicitly rather than coercing components or prefixes',()=>{
  for(const v of malformed){assert.throws(()=>parseSemver(v),{code:'INVALID_SEMVER'});
    assert.throws(()=>compareSemver(v,'2.0.0'),{code:'INVALID_SEMVER'});
    assert.throws(()=>compareSemver('2.0.0',v),{code:'INVALID_SEMVER'});}
  for(const valid of ['0.0.0','2.0.0-0','2.0.0-01a','2.0.0--','2.0.0+01'])assert.ok(parseSemver(valid));
});
test('large integers are ordered without IEEE754 rounding or overflow',()=>{
  for(const [a,b] of [['9007199254740992.0.0','9007199254740993.0.0'],
    ['1.0.0-9007199254740992','1.0.0-9007199254740993'],['1.0.0-'+ '9'.repeat(400),'1.0.0-1'+'0'.repeat(400)]])
    assert.equal(compareSemver(a,b),-1);
  assert.equal(parseSemver('9007199254740993.0.0').major,'9007199254740993');
});
test('real discovery result builder detects RC upgrades and never stable-to-RC upgrade',()=>{
  for(const [installed,latest,expected] of [['2.0.0-rc.1','2.0.0-rc.2',true],['2.0.0-rc.1','2.0.0',true],
    ['2.0.0-rc.2','2.0.0-rc.3',true],['2.0.0-rc.2','2.0.0',true],
    ['2.0.0-rc.3','2.0.0',true],['2.0.0','2.0.0-rc.3',false],['2.0.0-rc.3','2.0.0-rc.2',false],
    ['2.0.0','2.0.0-rc.2',false],['1.0.0','1.0.1',true],['2.0.0+one','2.0.0+two',false]]){
    const r=buildDiscoveryResult({version:installed},{version:latest});
    assert.equal(r.update_available,expected);assert.equal(r.update_status.update_available,expected);
  }
  for(const v of ['2.x.0','','2.0.0-01']){
    assert.throws(()=>buildDiscoveryResult({version:v},{version:'2.0.0'}),{code:'INVALID_SEMVER'});
    assert.throws(()=>discoverUniversalOsUpdate({latest_version:v}),{code:'INVALID_SEMVER'});
  }
});
test('actual activation ordering prerequisite denies downgrades and invalids without activation',()=>{
  for(const [current,target] of [['2.0.0','2.0.0-rc.1'],['2.0.0-rc.2','2.0.0-rc.1'],['2.0.0-rc.3','2.0.0-rc.2'],['2.0.0','2.0.0-rc.3']])
    assert.equal(evaluateActivationVersionOrder(current,target).reason,'downgrade_not_allowed');
  assert.deepEqual(evaluateActivationVersionOrder('2.0.0-rc.1','2.0.0-rc.2'),{blocked:false,comparison:1});
  assert.equal(evaluateActivationVersionOrder('2.0.0','2.0.0-rc.1',{allow_downgrade:true}).blocked,false);
  for(const v of malformed.filter(x=>x!=null)){
    assert.equal(evaluateActivationVersionOrder('2.0.0',v,{allow_downgrade:true}).reason,'invalid_semver');
    assert.equal(evaluateActivationVersionOrder(v,'2.0.0',{allow_downgrade:true}).reason,'invalid_semver');
  }
  assert.equal(evaluateActivationVersionOrder(null,'invalid').blocked,true);
  // Verify production wiring: the tested prerequisite precedes authenticity and all effect steps.
  const source=fs.readFileSync(new URL('../intelligence/update/activate.mjs',import.meta.url),'utf8');
  const body=source.slice(source.indexOf('export function activateRelease('));
  assert.ok(body.indexOf('evaluateActivationVersionOrder(')<body.indexOf('validateStagedRelease('));
  assert.ok(body.includes('if (ordering.blocked) return ordering;'));
});
test('GitHub mock selection uses central ordering and only explicit lowercase v tag normalization',async()=>{
  const cfg={release_channel:'beta',source:{owner:'fixture',repository:'fixture'}};
  const releases=['v2.0.0-rc.1','v2.0.0-rc.11','v2.0.0-rc.2','v2.0.0-rc.01','vv9.0.0-rc.1'].map(tag_name=>({tag_name,prerelease:true}));
  const r=await discoverLatestGithubRelease(cfg,{mock_releases:releases});assert.equal(r.version,'2.0.0-rc.11');
  const invalid=await discoverLatestGithubRelease(cfg,{mock_releases:[{tag_name:'v2.0.0-rc.01',prerelease:true}]});assert.equal(invalid.found,false);
  const stable=await discoverLatestGithubRelease({...cfg,release_channel:'stable'},{mock_releases:[{tag_name:'v2.0.0',prerelease:false}]});assert.equal(stable.version,'2.0.0');
  const bare=await discoverLatestGithubRelease({...cfg,release_channel:'stable'},{mock_releases:[{tag_name:'v',version:'9.0.0',prerelease:false}]});assert.equal(bare.found,false);
});
