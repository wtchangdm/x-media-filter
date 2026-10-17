"use strict";
const inputs = [...document.querySelectorAll("input")];
const error = document.getElementById("error");
let current = {a: true, c: true, b: true};
function render() {
  for (const input of inputs) {
    input.checked = current[input.id];
  }
}
function failure(message) { error.textContent = message; error.hidden = false; }
chrome.storage.local.get("filters").then(raw => {
  current = XMFPolicy.normalizeSettings(raw.filters); render();
  inputs.forEach(input => { input.disabled = false; });
}).catch(() => failure("Could not read saved filters. Close and reopen to retry. Media stays blocked by default."));
for (const input of inputs) input.addEventListener("change", async () => {
  const next = {...current, [input.id]: input.checked};
  inputs.forEach(control => { control.disabled = true; }); error.hidden = true;
  try { await chrome.storage.local.set({filters: next}); current = next; }
  catch { failure("Could not save. Your previous filters are still active. Please retry."); }
  finally { render(); inputs.forEach(control => { control.disabled = false; }); }
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.filters) { current = XMFPolicy.normalizeSettings(changes.filters.newValue); render(); }
});
