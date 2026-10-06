import { makeId } from "../schema.js";

export function createSceneState({ storyId, chatId, location = "", time = "", participantIds = [], tags = [] }, now = new Date().toISOString()) {
  return {
    id: makeId("scene"), storyId, chatId, location, time,
    participantIds: [...new Set(participantIds)], tags: [...new Set(tags)],
    status: "active", revision: 1, createdAt: now, updatedAt: now
  };
}

export function updateScene(scene, patch, now = new Date().toISOString()) {
  const protectedKeys = new Set(["id","storyId","chatId","createdAt"]);
  const safe = Object.fromEntries(Object.entries(patch).filter(([key]) => !protectedKeys.has(key)));
  return { ...scene, ...safe, revision: (scene.revision || 0) + 1, updatedAt: now };
}

export function timeskipScene(scene, { time, location = scene.location, note = "" }, now = new Date().toISOString()) {
  return updateScene(scene, { time, location, lastTimeskip: { note, at: now } }, now);
}
