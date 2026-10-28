import policy from '../../config/catalyst-chat.json' with {type:'json'};
export const chatPolicy=policy;
const str={type:'string'},list={type:'array',items:str,maxItems:4},en=values=>({type:'string',enum:values});
const object=p=>({type:'object',properties:p,required:Object.keys(p),additionalProperties:false});
const fn=(name,description,p)=>({type:'function',name,description,strict:true,parameters:object(p)});
export const chatTools=[
 fn('find_assets','Find canonical assets by name/ticker or verified business text. Empty DB is not proof of no related companies.',{query:str,market:en(['ALL','KR','US','CRYPTO'])}),
 fn('read_data','Read saved data for canonical IDs. Use company for stock analysis: business/revenue shares, recent financials and ticker-matched reports together, no network. Max 2 stocks for company. Narrow questions can use individual datasets. financial fields: revenue,operatingIncome,netIncome,eps,operatingCashFlow,capitalExpenditure,freeCashFlow. fields=[] for defaults. Reports are saved excerpts/opinions, not audited results or full PDFs. No live quote or CDS.',{asset_ids:list,dataset:en(['company','business','financials','market','filings','reports','exposure']),period:en(['quarter','annual']),fields:list}),
 fn('read_macro','Find saved FRED series by ID/name/topic. US only; metadata and dated observations, never fabricated current values.',{query:str}),
 fn('search_sources','Discover document references. Cache first. official/web use Brave; news uses existing RSS. Search snippets are NOT evidence; read_document is required.',{query:str,scope:en(['stored','official','news','web'])}),
 fn('read_document','Read safe original document by reference returned in THIS conversation, optionally focus on a term. No arbitrary URLs/files.',{reference:str,focus:str}),
 fn('calculate','Compute from numeric observation IDs returned by tools. Growth uses (a/b-1)*100 only positive b; ratio same period; change a-b matching units. No invented operands.',{operation:en(['growth_pct','ratio_pct','difference']),a:str,b:str})
];
export const chatAnswerSchema=object({
 blocks:{type:'array',maxItems:9,items:object({kind:en(['fact','calculation','analysis','assumption','unknown']),text:str,refs:{type:'array',items:str,maxItems:18}})},
 followups:{type:'array',items:str,maxItems:3}
});
export const thesisReviewSchema=object({
 ...chatAnswerSchema.properties,
 assessment:en(['STRENGTHENED','WEAKENED','MIXED','NO_MATERIAL_CHANGE','INSUFFICIENT_DATA']),
 investigationStatus:en(['COMPLETE_WITHIN_SCOPE','PARTIAL','SOURCE_UNAVAILABLE','BUDGET_LIMITED','FAILED']),
 checkedPremiseIds:{type:'array',items:str,maxItems:16},
 changes:{type:'array',maxItems:6,items:object({premiseId:str,before:str,after:str,significance:str,direction:en(['supports','weakens','mixed','neutral']),refs:{type:'array',items:str,maxItems:6},previousRefs:{type:'array',items:str,maxItems:6}})},
 unknowns:{type:'array',items:str,maxItems:5},nextChecks:{type:'array',items:str,maxItems:5}
});
export function validToolCall(name,args){
 const def=chatTools.find(t=>t.name===name);if(!def||!args||Array.isArray(args)||typeof args!=='object')return false;
 if(Object.keys(args).sort().join('|')!==Object.keys(def.parameters.properties).sort().join('|'))return false;
 return Object.entries(def.parameters.properties).every(([k,p])=>p.enum?p.enum.includes(args[k]):p.type==='array'?Array.isArray(args[k])&&args[k].length<=4&&args[k].every(x=>typeof x==='string'&&x.length<=180):typeof args[k]==='string'&&args[k].length<=400);
}
// A capability check on the exact registered tools, not merely the word "function".
export function validChatRequest(b){
 const schema=b.text?.format?.name==='thesis_review_answer'?thesisReviewSchema:b.text?.format?.name==='free_research_answer'?chatAnswerSchema:null;
 return b.store===false&&!!schema&&JSON.stringify(b.text.format.schema)===JSON.stringify(schema)&&
 ['auto','none'].includes(b.tool_choice)&&b.parallel_tool_calls===false&&b.max_output_tokens<=1800&&
 Array.isArray(b.tools)&&JSON.stringify(b.tools)===JSON.stringify(b.tool_choice==='none'?[]:chatTools)&&
 Array.isArray(b.input)&&JSON.stringify(b.input).length<=42000;
}
export function chatTokenRequest(b){const {model,input,instructions,tools,tool_choice,parallel_tool_calls,text,reasoning}=b;return {model,input,instructions,tools,tool_choice,parallel_tool_calls,text,reasoning};}
export function validChatTokenRequest(b){return Object.keys(b).every(k=>['model','input','instructions','tools','tool_choice','parallel_tool_calls','text','reasoning'].includes(k))&&validChatRequest({...b,store:false,max_output_tokens:1800});}
