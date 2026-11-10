// The parts of a plate, for the Splunk events: the reading the decoder gives a plate whose code
// isn't listed (assets/js/plates.js, unlistedParts), without the code list. The Splunk app's
// `ptf_plate_parts` macro (splunk/flag_that_plate/default/macros.conf) gives the same answers, so
// events sent before these fields existed group the same way.
//   "DGK0001" -> code "GK", role_letter "D", mission_role "Diplomat", serial "0001"
//   "1034CYD" -> code "CY", role_letter "D", mission_role "UN Diplomat", serial "1034"
//   "D1AF"    -> no code: letters and digits are mixed, so it isn't stamped like a plate

const PREFIX_ROLES = { D: "Diplomat", C: "Consul", S: "Staff" };

export const MAX_PLATE_LENGTH = 32;

// how a plate reached the decoder, as the page reports it (pages from before this field send none)
export const ENTERED_VIA = new Set(["typed", "photo", "link"]);

export function normalize(value) {
  return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, MAX_PLATE_LENGTH);
}

export function plateParts(value) {
  const plate = normalize(value);
  let m;
  let letters;
  let serial;
  let layout;
  if ((m = plate.match(/^([A-Z]+)([0-9]*)$/))) {
    [, letters, serial] = m;
    layout = serial ? "letters_first" : "letters_only";
  } else if ((m = plate.match(/^([0-9]+)([A-Z]+)$/))) {
    [, serial, letters] = m;
    layout = "serial_first";
  } else {
    letters = plate.replace(/[0-9]/g, "");
    serial = plate.replace(/[A-Z]/g, "");
    layout = "other";
  }

  let code = layout === "other" ? "" : letters;
  let roleLetter = "";
  let role = "";
  if (layout !== "other" && letters.length === 3) {
    if (layout === "serial_first" && letters[2] === "D") {
      // serial-first plates are UN plates, whose role letter comes last ("1034 CXD" is CX, not XD)
      roleLetter = "D";
      role = "UN Diplomat";
      code = letters.slice(0, 2);
    } else if (PREFIX_ROLES[letters[0]]) {
      roleLetter = letters[0];
      role = PREFIX_ROLES[roleLetter];
      code = letters.slice(1);
    } else if (letters[2] === "D") {
      roleLetter = "D";
      role = "UN Diplomat";
      code = letters.slice(0, 2);
    }
  }
  return {
    plate,
    letters,
    code,
    role_letter: roleLetter,
    mission_role: role,
    serial,
    layout,
    // a two-letter code, at most one role letter and a serial of up to four digits: worth researching
    plate_shaped: code.length === 2 && serial.length <= 4
  };
}
