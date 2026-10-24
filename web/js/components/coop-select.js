// Coop dropdown for history pages. Scales to any number of coops (a farm may have many).
import { esc } from "../core/format.js";
import { farm } from "../services/farm.js";

export const coopSelectHTML = (id, withAll = true) =>
  `<label class="select-wrap"><span class="sr-only">โรงเรือน</span><select class="coop-select" id="${id}" data-all="${withAll ? 1 : 0}"></select></label>`;

// fill (or refill) a select with the coops this user may see; keeps the current choice
// (a coop keeper with one coop gets no "ทุกโรงเรือน" option)
export function coopOptions(sel, withAll = sel.dataset.all === "1") {
  const cur = sel.value;
  const coops = farm.coops({ all: true });
  withAll = withAll && coops.length > 1;
  sel.innerHTML = (withAll ? `<option value="0">ทุกโรงเรือน</option>` : "") +
    coops.map(c => `<option value="${c.id}">${esc(c.name)}${c.active ? "" : " (ปิดใช้งาน)"}</option>`).join("");
  if ([...sel.options].some(o => o.value === cur)) sel.value = cur;
}

export const coopName = id => { const c = farm.coop(id); return c ? c.name : "โรงเรือน #" + id; };
