export function nodeTaskName(mapping:string,uuid:string,fallback:string){
  try{const value=JSON.parse(mapping)[uuid];if(typeof value==='string'&&value.trim())return value.trim();}catch{/* use configured fallback */}
  return fallback.trim()||'电信';
}
