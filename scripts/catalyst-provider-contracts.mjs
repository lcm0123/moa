import documents from '../config/catalyst-crypto-documents.json' with {type:'json'};
// Code-owned canonical registry; a response or caller-supplied provider label is not authority.
export function providerContract(value){
 if(!value)return null;
 const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.port&&u.port!=='443')return null;
 if(u.hostname==='opendart.fss.or.kr'&&u.pathname==='/api/document.xml'&&/^\d{14}$/.test(u.searchParams.get('rcept_no')||'')&&[...u.searchParams.keys()].every(k=>['crtfc_key','rcept_no'].includes(k))&&u.searchParams.getAll('rcept_no').length===1&&u.searchParams.getAll('crtfc_key').length<=1)return 'DART_OFFICIAL_ARCHIVE';
 if(documents.some(d=>d.url===u.href&&new URL(d.url).hostname.endsWith('.'+d.officialRoot)))return 'MARKDOWN_PLAINTEXT';
 return null;
}
