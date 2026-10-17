import test from 'node:test';
import assert from 'node:assert/strict';
import {bem} from '../src/simple-ui.mjs';
import {escapeHtml,positiveInteger,tokenId,displayUnits,maskRuntime,validateRpc} from '../src/client-utils.mjs';
test('large wallet quantities never pass through floating point',()=>{
 assert.equal(positiveInteger('1000000000000000001'),1000000000000000001n);
 for(const s of ['1.2','-1','0','1e18','Infinity','0x12',(2n**128n).toString()])assert.throws(()=>positiveInteger(s));
 assert.equal(displayUnits(1234567890123456789n,18,18),'1.234567890123456789');
 assert.equal(displayUnits(99999999n,8,6),'0.999999');
 assert.equal(bem(7020960n,4),'0.0702');assert.equal(bem(7020960n,6),'0.070209');assert.equal(bem(1n,4),'<0.0001');assert.equal(bem(1n,6),'<0.000001');assert.equal(bem(1n),'0.00000001');
});
test('RPC validation isolates local test signers from remote endpoints',()=>{
 assert.equal(validateRpc('https://bsc-dataseed.bnbchain.org'),'https://bsc-dataseed.bnbchain.org/');
 for(const s of ['http://evil.example','javascript:alert(1)','https://user:password@example.com'])assert.throws(()=>validateRpc(s));
 assert.throws(()=>validateRpc('https://example.com',{local:true}));
 assert.equal(validateRpc('http://127.0.0.1:18576',{local:true}),'http://127.0.0.1:18576/');
});
test('runtime fingerprint masks only compiler-declared immutable ranges',()=>{
 assert.equal(maskRuntime('0xaabbccdd',[{start:1,length:2}]),'0xaa0000dd');
 assert.throws(()=>maskRuntime('0xaabb',[{start:1,length:2}]));
 assert.throws(()=>maskRuntime('0xaab',[]));
 assert.equal(escapeHtml('<img onerror="x">'), '&lt;img onerror=&quot;x&quot;&gt;');
});
test('NFT zero is a valid identifier while token IDs reject negatives, fractions and uint64 overflow',()=>{
 assert.equal(tokenId('0'),0n);assert.equal(tokenId('18446744073709551615'),2n**64n-1n);for(const v of ['-1','1.5','1e3',(2n**64n).toString()])assert.throws(()=>tokenId(v));
});
