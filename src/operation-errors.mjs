const marketErrors=new Set(['UntradableAsset','InvalidListing','Expired','StalePrice','MissingApproval','WrongPayment','InsufficientBalance','InvalidBid','InvalidBidAssets','NotBidder','AssetNotAccepted','NetBelowMinimum']);
export function operationError(error,name=null){
 const code=error?.code??error?.info?.error?.code,text=String(error?.shortMessage??error?.message??error??''),nested=String(error?.info?.error?.message??'');
 if(code==='ACTION_REJECTED'||code===4001||error?.info?.error?.code===4001)return{kind:'cancelled',message:'你已取消钱包操作，未提交交易'};
 if(code==='INSUFFICIENT_FUNDS'||/insufficient funds/i.test(text+' '+nested))return{kind:'funds',message:'BNB 余额不足，请同时预留成交款和网络 Gas'};
 if(code==='TX_PENDING')return{kind:'pending',message:'交易已提交，暂未确认。请在交易记录中查询，不要重复提交'};
 if(code==='TX_CANCELLED')return{kind:'cancelledOnchain',message:'原交易已在钱包中取消或替换，请核对链上结果'};
 if(code==='TX_REVERTED'||error?.receipt?.status===0)return{kind:'reverted',message:'交易已上链但执行失败，网络 Gas 已消耗。请刷新资产后重试'};
 if(code==='READ_TIMEOUT')return{kind:'network',message:'节点响应慢，可以重试或在连接设置中切换节点'};
 if(code==='UI_CANCELLED')return{kind:'cancelledUI',message:'操作已取消'};
 if(/provider destroyed|cancelled request|canceled request|provider.*destroyed/i.test(text+' '+nested))return{kind:'network',message:'连接已断开，正在重新连接…'};
 if(code==='HARVEST_UNAVAILABLE')return{kind:'contract',message:'官方领取暂不可用，可稍后重试或仅领取已同步收益'};
 if(marketErrors.has(name))return{kind:'market',message:({InvalidBid:'买单已成交、撤销或数量不足，请重新匹配',InvalidBidAssets:'矿机接受范围无效，请重新选择',NotBidder:'只有买单发布者能撤单',AssetNotAccepted:'该矿机不在买家的接受范围内',NetBelowMinimum:'到账金额低于预期，请重新报价',UntradableAsset:'对应矿机当前不能交易',InvalidListing:'卖单已成交或撤销，请重新凑单',Expired:'订单或交易有效期已过，请刷新后重新确认',StalePrice:'订单价格已变化，请重新匹配',MissingApproval:'份额授权已变化，请检查授权后重新匹配',WrongPayment:'支付报价已变化，请重新确认',InsufficientBalance:'可用 H 已变化，请重新匹配'})[name]};
 const known={NothingToClaim:'当前没有可领取 BEM',IneligibleMiner:'原矿机不符合入池条件',AdmissionCheckFailed:'矿机未通过反例核验',Slippage:'矿机算力或状态已变化，请重新查询'};
 if(known[name])return{kind:'contract',message:known[name]};
 if(['NETWORK_ERROR','SERVER_ERROR','TIMEOUT','OFFCHAIN_FAULT','BAD_DATA'].includes(code)||[-32005,-32016,429,502,503,504].includes(code)||/timeout|timed out|fetch failed|failed to fetch|network|rate limit|too many requests|429|502|503|504|socket|ECONN|ETIMEDOUT|missing response|could not coalesce/i.test(text+' '+nested))return{kind:'network',message:'节点连接或限流异常。请稍后重试；已提交的交易请先查询确认状态'};
 if(code==='CALL_EXCEPTION'||error?.revert)return{kind:'contract',message:'合约校验未通过，请刷新对应矿机或卖单后重试'};
 if(code==='GAS_BUDGET')return{kind:'gas',message:text||'本批 Gas 较高，请减少每笔处理的矿机数量'};
 return{kind:'other',message:/[\u3400-\u9fff]/.test(text)?text.slice(0,180):'操作暂未完成，请稍后重试；已提交的交易请先查看交易记录'};
}
export const isReadFailure=e=>operationError(e).kind==='network';
