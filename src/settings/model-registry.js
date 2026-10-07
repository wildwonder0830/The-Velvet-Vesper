// Add only exact display-name/ID pairs supplied by the user.
export const MODEL_REGISTRY = Object.freeze([
  {name:"Nemotron 3 Ultra Free",id:"nvidia/nemotron-3-ultra-550b-a55b:free"},
  {name:"Nemotron 3 Ultra Paid",id:"nvidia/nemotron-3-ultra-550b-a55b"},
  {name:"GLM 5.3 FlashX",id:"z-ai/glm-5.3-flashx"},
  {name:"Kimi K2 0905",id:"moonshotai/kimi-k2-0905"},
  {name:"Cydonia 24B V4.1",id:"thedrummer/cydonia-24b-v4.1"},
  {name:"Aion 3.0",id:"aion-labs/aion-3.0"},
  {name:"MiniMax M2.5",id:"minimax/minimax-m2.5"}
]);

export function validateModelId(value) {
  const id = typeof value === "string" ? value.trim() : "";
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)+(?::[A-Za-z0-9][A-Za-z0-9._-]*)?$/.test(id)) {
    return {ok:false,error:"Enter a model ID in provider/model format, without spaces or a URL."};
  }
  return {ok:true,id};
}

export function modelOptions(registry = MODEL_REGISTRY) {
  return registry.map(entry => {
    if (!entry || typeof entry.name !== "string" || !entry.name.trim() || !validateModelId(entry.id).ok || entry.id !== entry.id.trim()) {
      throw new Error("Invalid curated model entry: an exact name and model ID are required.");
    }
    return {name:entry.name,id:entry.id};
  });
}
