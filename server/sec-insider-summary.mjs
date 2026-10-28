// Accession AND issuer must agree; a same-day trade is not sufficient evidence.
export function attachInsiderSummary(filing, cache, cik, error='') {
 if(filing.summary_ko||!['4','4/A','144','144/A'].includes(filing.form))return filing;
 const planned=filing.form.replace('/A','')==='144';
 const rows=(cache?.items||[]).filter(r=>r.accession===filing.accession&&String(Number(r.cik))===String(Number(cik))&&(r.transaction==='Proposed Sale')===planned);
 if(!rows.length)return filing;
 return {...filing,insider_summary:rows[0].summary+(rows.length>1?` 외 ${rows.length-1}건`:''),insider_transactions:rows,insider_source_url:cache.sourceUrl,insider_received_at:cache.receivedAt,insider_stale:!!error||Date.now()-Date.parse(cache.receivedAt)>86400000};
}
