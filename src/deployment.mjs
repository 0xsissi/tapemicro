import {ContractFactory,getAddress,getCreateAddress} from 'ethers';
import {feeRecipientAddress} from './market-terms.mjs';
import {marketContractName} from './market-contract.mjs';
export async function deploymentPlan(config,artifacts,deployer=null,nonce=null){
 // Initial destination and owner are the deployer; ownership may later transfer or renounce.
 const feeRecipient=deployer===null?null:feeRecipientAddress(deployer);
 const vaultData=(await new ContractFactory(artifacts.TapeMicroVault.abi,artifacts.TapeMicroVault.bytecode).getDeployTransaction(config.mining,config.bem,config.tapeout,config.behemoth)).data;
 const addresses=deployer!==null&&nonce!==null?{vault:getCreateAddress({from:getAddress(deployer),nonce}),market:getCreateAddress({from:getAddress(deployer),nonce:nonce+1})}:null;
 const marketName=marketContractName(config),marketArtifact=artifacts[marketName];
 const marketData=addresses&&feeRecipient?(await new ContractFactory(marketArtifact.abi,marketArtifact.bytecode).getDeployTransaction(addresses.vault,feeRecipient)).data:null;
 return{version:config.version,protocolVersion:config.protocolVersion??1,marketVersion:config.marketVersion??2,chainId:config.chainId,deployer:deployer?getAddress(deployer):null,nonce,addresses,feeBps:100,feeRecipient,feeManager:feeRecipient,broadcast:false,transactions:[{contract:'TapeMicroVault',chainId:config.chainId,value:'0x0',...(nonce===null?{}:{nonce}),data:vaultData},{contract:marketName,chainId:config.chainId,value:'0x0',...(nonce===null?{}:{nonce:nonce+1}),data:marketData,requires:'Confirmed vault; initial recipient and initial owner are the actual deployer. Ownership can transfer in two steps or be renounced. Recheck wallet, nonce and predicted addresses before signing.'}]};
}
