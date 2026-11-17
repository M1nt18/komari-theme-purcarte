import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DEFAULT_CONFIG} from './default.ts';
import {normalizeSettings,settingsSignature} from './settings-model.ts';
import {nodeTaskName} from './node-tasks.ts';

test('every displayed setting has a matching runtime default, correct type and unique category',()=>{
  const data=JSON.parse(fs.readFileSync(new URL('../../komari-theme.json',import.meta.url),'utf8')).configuration.data;
  const keys=data.filter((x:{key?:string})=>x.key).map((x:{key:string})=>x.key);
  assert.equal(new Set(keys).size,keys.length);
  assert.deepEqual([...keys].sort(),Object.keys(DEFAULT_CONFIG).sort());
  for(const item of data.filter((x:{key?:string})=>x.key))assert.deepEqual(item.default,DEFAULT_CONFIG[item.key as keyof typeof DEFAULT_CONFIG],item.key);
  const titles=data.filter((x:{type:string})=>x.type==='title').map((x:{name:string})=>x.name);
  assert.equal(new Set(titles).size,titles.length);
});
test('legacy spelling and serialized server settings migrate without retaining obsolete billing maps',()=>{
  const legacy={backagroundAlignment:'contain,center',cardTrafficBaselineUsage:'{"node":999}',enableBlur:false};
  assert.deepEqual(normalizeSettings(JSON.stringify(JSON.stringify(legacy))),{backgroundAlignment:'contain,center',enableBlur:false});
});
test('configuration imports reject invalid types, ranges and enum values',()=>{
  for(const value of [{mainWidth:'90'},{mainWidth:500},{enableBlur:[]},{selectedDefaultView:'broken'},{cardPingChartNodeTasks:'[]'}]){
    assert.throws(()=>normalizeSettings(value,true));
  }
  assert.throws(()=>normalizeSettings([],true));assert.throws(()=>normalizeSettings(null,true));
  assert.deepEqual(normalizeSettings({mainWidth:90,unknown:'ignored'},true),{mainWidth:90});
});
test('draft comparisons ignore key order and task overrides fall back deterministically',()=>{
  assert.equal(settingsSignature({enableBlur:true,mainWidth:85}),settingsSignature({mainWidth:85,enableBlur:true}));
  assert.equal(nodeTaskName('{"node":"Peer"}','node','电信'),'Peer');
  assert.equal(nodeTaskName('invalid','node','移动'),'移动');
  assert.equal(nodeTaskName('{}','node',''),'电信');
});
