export function privateResearchPath(value){
 try { for(let n=0;n<3;n++){const next=decodeURIComponent(value);if(next===value)break;value=next;} }
 catch{return true;}
 return /(?:^|[\\/])(?:\.sites-runtime|research-documents|research-sanitized|quarantine|catalyst-security)(?:[\\/]|$)/i.test(value.split('?')[0]);
}
