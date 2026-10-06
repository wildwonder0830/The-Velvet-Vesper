import test from "node:test";
import assert from "node:assert/strict";
import { emptyVault } from "../src/schema.js";
import { inspectNoctisV07, migrateNoctisV07 } from "../src/migration/noctis-v07.js";
import { mergeVaults } from "../src/migration/import-service.js";

function fixture(){
  return {
    version:"0.7",
    exportedAt:"2026-10-06T09:22:22.141Z",
    settingsExcluded:true,
    personas:[{id:"p1",slot:1,name:"Amanda"}],
    characters:[
      {
        id:"group",
        name:"Three Mates",
        role:"group romance",
        permanentMemory:"Shared canon.",
        directives:["Keep each lead distinct."],
        lore:[{title:"Town",body:"Shared town lore."}],
        castMembers:[
          {id:"mirror",name:"Noctis",legacyPrimaryMirror:true},
          {id:"a",name:"Dane",role:"wolf",lore:[]},
          {id:"b",name:"Lucien",role:"vampire",lore:[]}
        ],
        chats:[
          {id:"empty",title:"Main Story",activePersonaId:"p1",messages:[],milestones:[],scene:{}},
          {id:"live",title:"Live",activePersonaId:"p1",messages:[{id:"m1",role:"assistant",text:"Hello."}],milestones:[],scene:{}}
        ]
      },
      {
        id:"solo",
        name:"Jesse",
        role:"love interest",
        lore:[],
        chats:[{id:"j1",title:"Main Story",activePersonaId:"p1",messages:[{id:"m2",role:"user",text:"Hi."}],milestones:[],scene:{}}]
      }
    ]
  };
}

test("Noctis preview skips empty placeholder timelines when a real timeline exists",()=>{
  const preview=inspectNoctisV07(fixture());
  assert.equal(preview.counts.stories,2);
  assert.equal(preview.counts.skippedEmptyChats,1);
  assert.deepEqual(preview.storyTitles,["Three Mates","Jesse"]);
});

test("Noctis migration promotes real multi-person cast members into Vesper characters",()=>{
  const migrated=migrateNoctisV07(fixture(),"2026-10-06T10:00:00.000Z");
  assert.equal(migrated.importMode,"merge");
  assert.equal(migrated.vault.stories.length,2);
  const group=migrated.vault.stories.find(s=>s.title==="Three Mates");
  assert.ok(group);
  assert.equal(group.characterIds.length,2);
  const names=group.characterIds.map(id=>migrated.vault.characters.find(c=>c.id===id)?.name).sort();
  assert.deepEqual(names,["Dane","Lucien"]);
  assert.equal(migrated.vault.messages.filter(m=>m.storyId===group.id).length,1);
});

test("Noctis merge preserves existing Vesper stories and blocks exact duplicate imports",()=>{
  const current=emptyVault("2026-10-06T09:00:00.000Z");
  current.stories.push({id:"existing",title:"Venomous Devotion"});
  const incoming=migrateNoctisV07(fixture(),"2026-10-06T10:00:00.000Z").vault;
  const merged=mergeVaults(current,incoming,"2026-10-06T11:00:00.000Z");
  assert.ok(merged.stories.some(s=>s.id==="existing"));
  assert.ok(merged.stories.some(s=>s.title==="Three Mates"));
  assert.throws(()=>mergeVaults(merged,incoming),/already been imported/i);
});
