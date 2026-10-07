import { validateVault } from "../schema.js";

const COLLECTIONS = ["personas","characters","stories","chats","messages","loreEntries","memoryEntries","milestones","relationships","statDefinitions","statEvents","sceneStates","knowledgeEntries","preferenceLines","usageEntries","migrationLog"];
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const id = value => typeof value === "string" && value.trim().length > 0;

function checks(errors) {
  const error = (path, message) => errors.push(`${path}: ${message}`);
  const field = (record, key, valid, description, path, required = false) => {
    if (record[key] === undefined && !required) return;
    if (!valid(record[key])) error(`${path}.${key}`, description);
  };
  const records = (value, path, required = false) => {
    if (value === undefined && !required) return [];
    if (!Array.isArray(value)) { error(path, "must be a list of records."); return []; }
    return value.flatMap((row, index) => {
      if (!object(row)) { error(`${path}[${index}]`, "must be a record, not an empty or primitive value."); return []; }
      return [{row, path:`${path}[${index}]`}];
    });
  };
  return {error, field, records};
}

// Import validation is deliberately separate from runtime normalization: bad
// collections must never be silently replaced with empty arrays during restore.
export function validateVesperBackup(vault) {
  const errors = [...validateVault(vault).errors];
  const {error, field, records} = checks(errors);
  if (!object(vault)) return {ok:false, errors:["Backup must be a JSON object."]};
  if (vault.backupSchema !== undefined && vault.backupSchema !== 1) error("backupSchema", "unsupported backup version; use a compatible Vesper export.");
  const lists = {}, indexes = {};
  for (const key of COLLECTIONS) {
    lists[key] = records(vault[key], key, true);
    indexes[key] = new Map();
    for (const {row, path} of lists[key]) {
      // Default stat definitions use a key; scan-generated events use dedupeKey.
      const identity = row.id ?? (key === "statDefinitions" ? row.key : key === "statEvents" ? row.dedupeKey : undefined);
      if (!id(identity)) error(path, "missing a non-empty record ID.");
      else if (indexes[key].has(identity)) error(path, "duplicate record ID.");
      else indexes[key].set(identity, row);
      const requiredText={personas:["name"],characters:["name"],stories:["title"],memoryEntries:["kind"],milestones:["type"],preferenceLines:["level","label"],usageEntries:["model"]}[key]||[];
      for(const name of requiredText)field(row,name,v=>typeof v === "string","must contain text.",path,true);
      for (const name of ["name","title","text","body","kind","type","role","status","model"]) field(row,name,v=>typeof v === "string","must be text.",path);
      for (const name of ["settings","profile","metadata"]) field(row,name,object,"must be an object.",path);
      if (object(row.settings)) {
        field(row.settings,"model",v=>typeof v === "string","must be text.",`${path}.settings`);
        field(row.settings,"enabledPreferenceLineIds",v=>Array.isArray(v)&&v.every(id),"must be a list of non-empty IDs.",`${path}.settings`);
      }
      for (const name of ["characterIds","participantIds","sourceMessageIds","enabledPreferenceLineIds","tags","labels"]) field(row,name,v=>Array.isArray(v)&&v.every(id),"must be a list of non-empty IDs or labels.",path);
      for (const name of ["ordinal","promptTokens","completionTokens","totalTokens"]) field(row,name,v=>Number.isFinite(v)&&v>=0,"must be a non-negative number.",path);
    }
  }
  function reference(row, name, target, path, required = false) {
    const value = row[name];
    if (value == null && !required) return;
    if (!id(value) || !indexes[target].has(value)) error(`${path}.${name}`, `must refer to an existing ${target} record.`);
  }
  for (const {row,path} of lists.stories) {
    reference(row,"personaId","personas",path);
    reference(row,"primaryCharacterId","characters",path);
    if (Array.isArray(row.characterIds)) for (const value of row.characterIds) reference({characterId:value},"characterId","characters",path);
  }
  for (const key of COLLECTIONS) for (const {row,path} of lists[key]) {
    const storyRequired = ["chats","messages","memoryEntries","milestones","relationships","statEvents","sceneStates","knowledgeEntries"].includes(key);
    reference(row,"storyId","stories",path,storyRequired);
    reference(row,"chatId","chats",path,key === "messages" || key === "sceneStates");
    if (id(row.chatId) && indexes.chats.has(row.chatId) && row.storyId !== indexes.chats.get(row.chatId).storyId) error(path,"chat and story ownership do not match.");
    for (const [name,target] of [["personaId","personas"],["characterId","characters"],["relationshipId","relationships"],["sourceMessageId","messages"]]) reference(row,name,target,path);
    if (Array.isArray(row.sourceMessageIds)) for (const value of row.sourceMessageIds) reference({sourceMessageId:value},"sourceMessageId","messages",path);
    if (key === "messages") {
      field(row,"text",v=>typeof v === "string","must contain message text.",path,true);
      field(row,"role",id,"must contain a message role.",path,true);
    }
    if (key === "loreEntries") {
      field(row,"scope",v=>["global","story","persona","character"].includes(v),"must have a supported lore scope.",path,true);
      if (["story","persona","character"].includes(row.scope)) reference(row,`${row.scope}Id`,{story:"stories",persona:"personas",character:"characters"}[row.scope],path,true);
    }
  }
  return {ok:errors.length === 0, errors};
}

export function validateNoctisBackup(source) {
  const errors = [];
  const {error, field, records} = checks(errors);
  if (!object(source)) return {ok:false, errors:["Noctis backup must be a JSON object."]};
  if (source.version !== "0.7") error("version","unsupported Noctis version; expected 0.7.");
  const personas = records(source.personas,"personas",true);
  const characters = records(source.characters,"characters",true);
  const personaIds = new Set();
  function identities(rows, required = true) {
    const seen = new Set();
    for (const {row,path} of rows) {
      field(row,"id",id,"must have a non-empty ID.",path,required);
      if (row.id !== undefined && seen.has(row.id)) error(`${path}.id`,"duplicate ID.");
      seen.add(row.id);
      field(row,"name",v=>typeof v === "string","must be text.",path);
    }
  }
  identities(personas); identities(characters);
  for (const {row} of personas) personaIds.add(row.id);
  const text = (row,key,path) => field(row,key,v=>typeof v === "string","must be text.",path);
  const lore = (value,path) => { for (const entry of records(value,path)) { text(entry.row,"title",entry.path); text(entry.row,"body",entry.path); } };
  for (const {row:character,path} of characters) {
    text(character,"permanentMemory",path); text(character,"backstory",path); text(character,"role",path);
    field(character,"directives",v=>Array.isArray(v)&&v.every(x=>typeof x === "string"),"must be a list of text instructions.",path);
    lore(character.lore,`${path}.lore`);
    const members=records(character.castMembers,`${path}.castMembers`); identities(members,false);
    for (const member of members) lore(member.row.lore,`${member.path}.lore`);
    const chats=records(character.chats,`${path}.chats`); identities(chats,false);
    for (const {row:chat,path:chatPath} of chats) {
      if (chat.activePersonaId != null && (!id(chat.activePersonaId)||!personaIds.has(chat.activePersonaId))) error(`${chatPath}.activePersonaId`,"must refer to an existing persona.");
      for (const key of ["title","relationshipMemory","consolidatedMemory"]) text(chat,key,chatPath);
      for (const key of ["scene","storyStats"]) field(chat,key,object,"must be an object.",chatPath);
      field(chat,"knowledgeLedger",v=>object(v)||Array.isArray(v),"must be an object or list.",chatPath);
      field(chat,"sceneCast",Array.isArray,"must be a list.",chatPath);
      records(chat.beatLog,`${chatPath}.beatLog`);
      const messages=records(chat.messages,`${chatPath}.messages`,true); identities(messages,false);
      for (const message of messages) {
        field(message.row,"text",v=>typeof v === "string","must contain message text.",message.path,true);
        text(message.row,"role",message.path);
      }
      const milestones=records(chat.milestones,`${chatPath}.milestones`); identities(milestones,false);
      for (const milestone of milestones) {
        for (const key of ["type","title","emoji","evidence","text","note"]) text(milestone.row,key,milestone.path);
        field(milestone.row,"participants",Array.isArray,"must be a list.",milestone.path);
      }
    }
  }
  return {ok:errors.length === 0, errors};
}

export function requireValidBackup(validation, label) {
  if (!validation.ok) throw new Error(`Invalid ${label} backup. ${validation.errors.slice(0,8).join(" ")}${validation.errors.length > 8 ? " Please check the remaining records too." : ""} Nothing was changed.`);
}
