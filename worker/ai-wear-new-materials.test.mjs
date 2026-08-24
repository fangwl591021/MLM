import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../ai-wear.html", import.meta.url), "utf8");

test("AI Wear exposes the new Drive material collection inside glasses mode", () => {
  assert.match(html, /id="toggleNewMaterials"[^>]*>選用新素材<\/button>/);
  assert.match(html, /startsWith\("drive1uf-"\)/);
  assert.match(html, /materialView:"all"/);
  assert.match(html, /state\.materialView==="new"\?"all":"new"/);
  assert.doesNotMatch(html, /id="enterDriveMaterialsMode"/);
});