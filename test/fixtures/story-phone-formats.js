import {emptyVault} from '../../src/schema.js';
import {ensureStoryPhone} from '../../src/phone/phone-state.js';
export const time='2026-10-08T12:00:00.000Z';
export function phoneFixture(sources=[]) {
 const v=emptyVault(time);v.personas=[{id:'p',name:'Amanda — Synthetic Hollow'}];v.characters=[{id:'d',name:'Dane Calder'},{id:'l',name:'Lucien Veyr'},{id:'r',name:'Rhydian Caerfyr'}];
 v.stories=[{id:'s',title:'Synthetic cast',personaId:'p',characterIds:['d','l','r'],settings:{model:'synthetic/exact'}},{id:'other',title:'Other',personaId:'p',characterIds:['d','l','r']}];v.chats=[{id:'c',storyId:'s'},{id:'c2',storyId:'s'},{id:'oc',storyId:'other'}];
 v.messages=sources.map((text,i)=>({id:'m'+i,storyId:'s',chatId:'c',role:'assistant',ordinal:i,text}));return ensureStoryPhone(v,'s','c',time);
}
export const groupSources=[
 'Amanda started a group chat between all of them: AMANDA: Meet by the gate.',
 'The new group chat existed for three seconds.\n\nAMANDA: Meet by the gate.\n\nDANE: I am ready.\n\nRHYDIAN: Is this all four of us?\n\nLUCIEN:\n\nApparently.\n\nDane Calder left the conversation.\n\nRHYDIAN: He left.\n\nLUCIEN: That was quick.\n\nAmanda added Dane Calder.\n\nDANE: Back now.\n\nLucien Veyr changed the group name to “Courtship Negotiations.”\n\nLUCIEN: First name.\n\nRhydian Caerfyr changed the group name to “Amanda + 3 Problems.”\n\nRHYDIAN: Second name.',
 'The message landed in Amanda + 3 Problems.\n\nDANE: Same conversation.'
];
export const privateSources=[
 'Amanda picked up her phone. She texted Lucian AMANDA: I repaired your pendant.\n\nThe original seal is unchanged.',
 'Amanda’s private message reached Lucien.\n\nLUCIEN:\n\nThank you.\n\nI will collect it tomorrow.\n\nAnother message followed.\n\nLUCIEN: No rush.',
 'Amanda’s phone woke in her hand.\n\nMrs. Pell — 7:03 AM\n\nYOU ARE CLOSED.\n\nA minute later:\n\nThis is a friendly reminder.\n\nMaribel — 7:26 AM\n\nLONG WEEKEND!\n\nNothing suggesting she knew about the private conversation.\n\nCal Mercer — 7:41 AM\n\nThe window repair is ready.\n\nJulian — 8:02 AM\n\nSabine told me to send this: “Your gloves are here.” — Sabine. I am the messenger.'
];
