export const marketContractName=config=>config.marketVersion>=3?'TapeMicroMarketV2':'TapeMicroMarket';
export const marketProtocolName=config=>config.marketVersion===3?'TapeMicroMarketV2Legacy':marketContractName(config);
