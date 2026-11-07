var XMFViewer = (function () {
  "use strict";

  function create({ onSelect, onClose, opener = document.activeElement }) {
    const host = document.createElement("xmf-gallery");
    const shadow = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = `
      :host { color-scheme: dark; }
      dialog { box-sizing: border-box; position: fixed; inset: 0; margin: auto;
        width: min(1100px, calc(100vw - 24px)); height: calc(100dvh - 24px);
        max-width: none; max-height: none; padding: 12px; border: 0;
        background: #101418; color: #f5f7f8; font: 14px/1.5 system-ui; }
      dialog[open] { display: grid; grid-template-rows: auto minmax(0, 1fr); gap: 12px; }
      dialog::backdrop { background: rgb(0 0 0 / 80%); }
      header { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
      span { flex: 1; text-align: center; }
      button { border: 0; border-radius: 6px; padding: 8px 12px; font: inherit;
        background: #223746; color: inherit; cursor: pointer; }
      button:disabled { opacity: .45; cursor: default; }
      button:focus-visible { outline: 3px solid #60e0a7; outline-offset: 2px; }
      .stage { position: relative; display: grid; min-width: 0; min-height: 0; }
      .stage > * { display: block; box-sizing: border-box; width: 100%; height: 100%;
        min-width: 0; min-height: 0; max-width: 100%; max-height: 100%; }
      iframe { border: 0; }
    `;
    const dialog = document.createElement("dialog");
    dialog.setAttribute("aria-label", "Media viewer");
    const header = document.createElement("header");
    function button(label, text) {
      const value = document.createElement("button");
      value.type = "button";
      value.setAttribute("aria-label", label);
      value.textContent = text;
      return value;
    }
    const closeButton = button("Close media viewer", "Close");
    closeButton.autofocus = true;
    const previous = button("Previous image", "Previous");
    const next = button("Next image", "Next");
    const counter = document.createElement("span");
    counter.setAttribute("role", "status");
    const stage = document.createElement("div");
    stage.className = "stage";
    header.append(closeButton, previous, counter, next);
    dialog.append(header, stage);
    shadow.append(style, dialog);

    let index = 0;
    let count = 0;
    let destroyed = false;
    function update(selection) {
      if (destroyed) return;
      count = Number.isInteger(selection.count) && selection.count > 0 ? selection.count : 0;
      index = Number.isInteger(selection.index) ? Math.max(0, Math.min(selection.index, count - 1)) : 0;
      previous.disabled = index === 0 || count === 0;
      next.disabled = count === 0 || index === count - 1;
      counter.textContent = `Image ${count ? index + 1 : 0} of ${count}`;
    }
    function select(offset) {
      const selected = index + offset;
      if (!destroyed && selected >= 0 && selected < count) onSelect(selected);
    }
    function click(event) {
      event.stopPropagation();
      if (!event.isTrusted || destroyed) return;
      if (event.target === closeButton) onClose();
      else if (event.target === previous && !previous.disabled) select(-1);
      else if (event.target === next && !next.disabled) select(1);
    }
    function key(event) {
      event.stopPropagation();
      if (event.type !== "keydown" || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      if (event.isTrusted) select(event.key === "ArrowLeft" ? -1 : 1);
    }
    function cancel(event) {
      event.preventDefault();
      event.stopPropagation();
      if (event.isTrusted && !destroyed) onClose();
    }
    const listeners = [["click", click], ["keydown", key], ["keyup", key], ["keypress", key], ["cancel", cancel]];
    for (const [type, listener] of listeners) dialog.addEventListener(type, listener);
    function destroy({ restoreFocus = true } = {}) {
      if (destroyed) return;
      destroyed = true;
      for (const [type, listener] of listeners) dialog.removeEventListener(type, listener);
      // Detach before closing so native dialog restoration cannot override this option.
      host.remove();
      if (dialog.open) dialog.close();
      if (restoreFocus && opener?.isConnected) opener.focus({ preventScroll: true });
    }
    update({ index: 0, count: 0 });
    try {
      document.documentElement.append(host);
      dialog.showModal();
    } catch (error) {
      destroy({ restoreFocus: false });
      throw error;
    }
    return { host, stage, closeButton, update, destroy };
  }

  return { create };
})();

if (typeof module === "object" && module.exports) module.exports = XMFViewer;
