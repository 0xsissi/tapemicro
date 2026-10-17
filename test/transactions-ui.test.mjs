import test from 'node:test';import assert from 'node:assert/strict';
import {transactionSummary,transactionsMarkup} from '../src/transactions-ui.mjs';
const hash=n=>'0x'+n.toString(16).padStart(64,'0');
test('transaction history retains completed entries and keeps unresolved entries first',()=>{
 const rows=Array.from({length:12},(_,i)=>({hash:hash(i+1),status:'confirmed',title:'record-'+i}));
 rows.push({hash:hash(20),status:'unknown',title:'needs-check'},{hash:hash(21),status:'pending',title:'submitted'});
 assert.deepEqual(transactionSummary(rows),{pending:2,total:14});const html=transactionsMarkup({transactions:rows});
 assert.equal((html.match(/class="transaction-row"/g)||[]).length,14);assert.ok(html.indexOf('submitted')<html.indexOf('record-0'));assert.match(html,/record-11/);assert.doesNotMatch(html,/<details|<summary/);
});
test('history links follow confirmed replacement receipts and escape wallet-supplied text',()=>{
 const html=transactionsMarkup({explorer:'https://bscscan.com',transactions:[{hash:hash(1),receiptHash:hash(2),replacementHash:hash(3),status:'confirmed',title:'<img src=x>',note:'<script>bad()</script>'}]});
 assert.match(html,new RegExp('/tx/'+hash(2)));assert.doesNotMatch(html,new RegExp('/tx/'+hash(1)));assert.doesNotMatch(html,/<script>|<img/);assert.match(html,/&lt;script&gt;/);
});
test('empty history does not fabricate transactions or disable a future lookup',()=>{
 assert.deepEqual(transactionSummary([]),{pending:0,total:0});assert.match(transactionsMarkup({transactions:[]}),/暂无本机交易记录/);assert.doesNotMatch(transactionsMarkup({transactions:[]}),/class="transaction-row"/);
});
