import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import solc from 'solc';
const root=fileURLToPath(new URL('../',import.meta.url));
const sources={};
function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())walk(p);else if(e.name.endsWith('.sol'))sources[path.relative(root,p).replaceAll('\\','/')]={content:fs.readFileSync(p,'utf8')};}}
walk(path.join(root,'contracts'));
const input={language:'Solidity',sources,settings:{optimizer:{enabled:true,runs:200},evmVersion:'cancun',outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object','evm.deployedBytecode.immutableReferences','metadata']}}}};
const output=JSON.parse(solc.compile(JSON.stringify(input),{import:p=>{try{return{contents:fs.readFileSync(path.join(root,'node_modules',p),'utf8')}}catch{return{error:`Import not found: ${p}`}}}}));
for(const e of output.errors??[])if(e.severity==='error')console.error(e.formattedMessage);
if(output.errors?.some(e=>e.severity==='error'))process.exit(1);
fs.mkdirSync(path.join(root,'artifacts'),{recursive:true});
for(const[file,contracts]of Object.entries(output.contracts??{}))for(const[name,c]of Object.entries(contracts)){
 if(!file.startsWith('contracts/'))continue;
 const artifact={contractName:name,sourceName:file,compiler:solc.version(),abi:c.abi,bytecode:'0x'+c.evm.bytecode.object,deployedBytecode:'0x'+c.evm.deployedBytecode.object,immutableReferences:c.evm.deployedBytecode.immutableReferences??{},metadata:JSON.parse(c.metadata)};
 fs.writeFileSync(path.join(root,'artifacts',name+'.json'),JSON.stringify(artifact,null,2));
 if(c.evm.bytecode.object){const size=c.evm.deployedBytecode.object.length/2;if(size>24576)throw Error(`${name} exceeds EIP-170: ${size}`);console.log(`${name}: ${size} runtime bytes`);}
}
fs.writeFileSync(path.join(root,'artifacts','compiler-input.json'),JSON.stringify({...input,sources:{...sources,...Object.fromEntries(Object.keys(output.sources).filter(p=>!sources[p]).map(p=>[p,{content:fs.readFileSync(path.join(root,'node_modules',p),'utf8')}]))}},null,2));
