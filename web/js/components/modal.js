// Small dialog helper built on <dialog>: forms, confirmations, and showing a secret exactly once.
import { ic } from "../core/icons.js";
import { esc } from "../core/format.js";

// openModal({title, body (html), submit: "บันทึก", danger, onSubmit(form) -> Promise (throw to keep open)})
export function openModal({ title, body, submit = "บันทึก", cancel = "ยกเลิก", danger = false, wide = false, onSubmit }) {
  const d = document.createElement("dialog");
  d.className = "modal" + (wide ? " wide" : "");
  d.innerHTML = `<form method="dialog" class="form">
      <div class="modal-head"><h3>${esc(title)}</h3><button type="button" class="icon-btn close" aria-label="ปิด">✕</button></div>
      <div class="modal-body">${body}</div>
      <p class="form-error" hidden></p>
      <div class="modal-foot">
        ${cancel ? `<button type="button" class="btn cancel">${esc(cancel)}</button>` : ""}
        ${submit ? `<button type="submit" class="btn ${danger ? "danger" : "primary"}">${esc(submit)}</button>` : ""}
      </div></form>`;
  document.body.appendChild(d);
  const form = d.querySelector("form"), err = d.querySelector(".form-error");
  const close = () => { d.close(); d.remove(); };
  d.querySelectorAll(".close, .cancel").forEach(b => b.addEventListener("click", close));
  d.addEventListener("cancel", e => { e.preventDefault(); close(); });
  form.addEventListener("submit", async e => {
    e.preventDefault();
    if (!onSubmit) return close();
    const btn = form.querySelector("[type=submit]");
    btn.disabled = true; err.hidden = true;
    try { const keep = await onSubmit(form); if (keep !== true) close(); }
    catch (x) { err.textContent = x.message; err.hidden = false; }
    btn.disabled = false;
  });
  d.showModal();
  const first = form.querySelector("input:not([type=hidden]), select, textarea");
  if (first) first.focus();
  return { el: d, form, close };
}

export const confirmModal = (title, text, { submit = "ยืนยัน", danger = false } = {}) => new Promise(resolve => {
  const m = openModal({ title, body: `<p>${text}</p>`, submit, danger, onSubmit: async () => { resolve(true); } });
  m.el.addEventListener("close", () => resolve(false));
});

// Show generated passwords/keys once, with copy buttons.
export function secretModal(title, intro, items, extraHtml = "") {
  const m = openModal({
    title, submit: "ฉันจดเก็บไว้แล้ว", cancel: null, wide: true,
    body: `<p class="hint warn-text">${ic("alert")} ${intro}</p>
      <dl class="secrets">${items.map(([label, value]) => `<div><dt>${esc(label)}</dt>
        <dd><code>${esc(value)}</code><button type="button" class="btn sm copy" data-v="${esc(value)}">คัดลอก</button></dd></div>`).join("")}</dl>${extraHtml}`,
  });
  m.el.addEventListener("click", e => {
    const b = e.target.closest(".copy");
    if (!b) return;
    navigator.clipboard?.writeText(b.dataset.v).then(() => { b.textContent = "คัดลอกแล้ว"; }).catch(() => {});
  });
  return m;
}
