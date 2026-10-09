// Model-only eligibility. Provenance never grants a larger audience than its source.
const sources={sourceMessageId:'messages',sourceMessageIds:'messages',sourceMemoryId:'memoryEntries',sourceMemoryIds:'memoryEntries',sourceMilestoneId:'milestones',sourceMilestoneIds:'milestones',milestoneId:'milestones',sourceRelationshipId:'relationships',sourceRelationshipIds:'relationships',relationshipId:'relationships',sourceSceneId:'sceneStates',sourceSceneIds:'sceneStates',sourceKnowledgeId:'knowledgeEntries',sourceKnowledgeIds:'knowledgeEntries'};
export function sourceAudienceVisible(record,vault,recipientIds,visited=new Set()){
 if(!record||typeof record!=='object')return true;
 if(Array.isArray(record))return record.every(row=>sourceAudienceVisible(row,vault,recipientIds,visited));
 if(Object.hasOwn(record,'audienceIds')&&(!Array.isArray(record.audienceIds)||!recipientIds.every(id=>record.audienceIds.includes(id))))return false;
 for(const [field,collection] of Object.entries(sources)){
  if(record[field]==null)continue;
  const ids=Array.isArray(record[field])?record[field]:[record[field]];
  for(const id of ids){const key=collection+':'+id;if(visited.has(key))continue;visited.add(key);const source=(vault[collection]||[]).find(row=>row.id===id);if(!source||!sourceAudienceVisible(source,vault,recipientIds,visited))return false;}
 }
 return Object.values(record).every(value=>sourceAudienceVisible(value,vault,recipientIds,visited));
}
