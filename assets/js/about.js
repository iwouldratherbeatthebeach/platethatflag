// Flag That Plate — about page: the shell, and the code count read from the live plate list.
import { $, fetchText, formatNumber, initShell } from "./core.js";
import { parsePlates, countBaseCodes } from "./plates.js";

initShell();

fetchText("/plates.csv")
  .then((csv) => {
    const index = parsePlates(csv);
    const count = countBaseCodes(index);
    const slot = $("[data-code-count]");
    if (slot && count) slot.textContent = formatNumber(count);
  })
  .catch(() => {
    /* the static count in the page stays */
  });
