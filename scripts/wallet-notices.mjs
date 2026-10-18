import{readFile,writeFile,readdir}from'node:fs/promises';import{dirname,resolve,sep}from'node:path';
export async function walletNotices(root,meta){
 const packages=new Map();
 for(const output of Object.values(meta.outputs))for(const[name,data]of Object.entries(output.inputs??{})){
  if(!data.bytesInOutput||!name.includes('node_modules/'))continue;let path=dirname(resolve(root,name));
  while(path.startsWith(resolve(root,'node_modules')+sep)){
   try{const pkg=JSON.parse(await readFile(resolve(path,'package.json'),'utf8'));if(pkg.name){packages.set(pkg.name,{path,pkg});break;}}catch{}
   path=dirname(path);
  }
 }
 const marker='\n=== RainbowKit wallet bundle dependencies ===\n',base=(await readFile(root+'THIRD_PARTY_NOTICES.txt','utf8')).replaceAll('\r\n','\n').split(marker)[0];let notices=base+marker;
 for(const[name,{path,pkg}]of [...packages].sort(([a],[b])=>a.localeCompare(b))){
  const license=(await readdir(path)).find(f=>/^licen[cs]e(?:\.(?:md|txt))?$/i.test(f));notices+='\n--- '+name+' '+pkg.version+' ('+pkg.license+') ---\n'+(license?await readFile(resolve(path,license),'utf8'):'License declared by the published package: '+pkg.license+'\n')+'\n';
 }
 notices=notices.replaceAll('\r\n','\n').split('\n').map(line=>line.trimEnd()).join('\n').trimEnd()+'\n';
 await writeFile(root+'THIRD_PARTY_NOTICES.txt',notices);await writeFile(root+'dist/THIRD_PARTY_NOTICES.txt',notices);
 return [...packages.keys()].sort();
}
