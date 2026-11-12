import {regionPlan,REGION_RULE_VERSION} from '../../../favorite-region-core.js';
const uuid=s=>typeof s==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
export async function handleRegions({action,body,rpc}){
 const call=(a,b={})=>rpc('favorites_regions_rpc',{token:body.token,regionAction:a,...b},'');
 if(action==='favorites_regions_confirm')return call('confirm',{operation:body.operation,confirmed:body.confirmed===true});
 const snapshot=await call('snapshot');if(snapshot.status)return snapshot;
 const proposals=regionPlan(snapshot);
 if(action==='favorites_regions_plan')return {items:proposals,ruleVersion:REGION_RULE_VERSION,fetchedAt:new Date().toISOString()};
 if(action!=='favorites_regions_preview'||!uuid(body.operation)||!Array.isArray(body.ids)||body.ids.length<1||body.ids.length>25||new Set(body.ids).size!==body.ids.length||body.ids.some(id=>!uuid(id)))return {status:400,error:'invalid_region_selection'};
 const reviewed=Array.isArray(body.reviewed)?body.reviewed:[];
 const selected=body.ids.map(id=>proposals.find(p=>p.id===id));
 if(selected.some(p=>!p||p.status!=='candidate'||p.archived||(!p.eligible&&!reviewed.includes(p.id))))return {status:409,error:'region_evidence_required'};
 const entries=selected.map(p=>({id:p.id,expected:p.version,region:p.region.region,evidence:{...p.evidence,region:p.region.region,region_key:p.region.key,region_path:p.region.path,normalization_version:REGION_RULE_VERSION,verified:false}}));
 // Candidates are regenerated from authenticated DB rows. Client proposals are never trusted.
 return call('preview',{operation:body.operation,entries});
}
