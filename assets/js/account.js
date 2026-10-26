// Flag That Plate — sign in, create an account, signed-in state.
// Same endpoints and bodies as before: POST /login and /signup { username, password }, POST /logout, GET /me.
import { $, $$, h, icon, api, toast, setBusy, initShell, getUser, setUser, signOut, initials } from "./core.js";

const RULES = { username: 3, password: 6 }; // the server's own limits (functions/signup.js)

function errorId(input) {
  return `${input.id}-error`;
}

function setFieldError(input, message) {
  let error = document.getElementById(errorId(input));
  if (!error) {
    error = h("p", { class: "field__error", id: errorId(input) });
    input.closest(".field").append(error);
  }
  error.replaceChildren(icon("alert"), h("span", null, message));
  error.hidden = false;
  input.setAttribute("aria-invalid", "true");
  const described = new Set((input.getAttribute("aria-describedby") || "").split(" ").filter(Boolean));
  described.add(error.id);
  input.setAttribute("aria-describedby", [...described].join(" "));
}

function clearErrors(form) {
  $$("[aria-invalid]", form).forEach((input) => input.removeAttribute("aria-invalid"));
  $$(".field__error", form).forEach((error) => {
    error.hidden = true;
  });
  const formError = $("[data-form-error]", form);
  if (formError) formError.hidden = true;
}

function setFormError(form, message) {
  const box = $("[data-form-error]", form);
  box.replaceChildren(icon("alert"), h("div", null, h("p", null, message)));
  box.hidden = false;
}

function focusFirstInvalid(form) {
  $("[aria-invalid='true']", form)?.focus();
}

async function submitAuth(form, endpoint) {
  clearErrors(form);
  const usernameInput = form.elements.username;
  const passwordInput = form.elements.password;
  const username = usernameInput.value.trim();
  const password = passwordInput.value;
  const creating = endpoint === "/signup";

  if (!username) setFieldError(usernameInput, "Enter a username.");
  else if (creating && username.length < RULES.username) setFieldError(usernameInput, `Use at least ${RULES.username} characters.`);
  if (!password) setFieldError(passwordInput, "Enter a password.");
  else if (creating && password.length < RULES.password) setFieldError(passwordInput, `Use at least ${RULES.password} characters.`);
  if ($("[aria-invalid='true']", form)) {
    focusFirstInvalid(form);
    return;
  }

  const button = $("button[type=submit]", form);
  setBusy(button, true);
  try {
    const { ok, status, data } = await api(endpoint, { method: "POST", body: { username, password } });
    if (!ok) {
      if (status === 401) setFormError(form, "That username and password don't match an account. Check both and try again.");
      else if (status === 409) {
        setFieldError(usernameInput, "That username is taken. Try another.");
        focusFirstInvalid(form);
      } else if (status === 400) setFormError(form, creating ? `Usernames need at least ${RULES.username} characters and passwords at least ${RULES.password}.` : "Enter your username and password.");
      else setFormError(form, "Something went wrong on our side. Try again in a moment.");
      return;
    }
    const name = (data && data.username) || username;
    form.reset();
    setUser({ loggedIn: true, username: name });
    toast.success(creating ? "Account created" : `Signed in as ${name}`, {
      description: creating ? `You're signed in as ${name}. Your lookups now count toward the leaderboard.` : "Your lookups now count toward the leaderboard."
    });
    render();
    $("#account-title")?.focus();
  } catch {
    setFormError(form, "Couldn't reach the server. Check your connection and try again.");
  } finally {
    setBusy(button, false);
  }
}

function render() {
  const user = getUser();
  const forms = $("[data-auth-forms]");
  const signedIn = $("[data-auth-signed-in]");
  const lead = $("[data-lead]");
  if (lead) lead.hidden = !!user.loggedIn; // the signed-in panel says the same thing
  if (user.loggedIn) {
    const name = user.username || "";
    $("[data-avatar]", signedIn).textContent = initials(name);
    $("[data-name]", signedIn).textContent = name;
    $("[data-name]", signedIn).title = name;
    forms.hidden = true;
    signedIn.hidden = false;
  } else {
    forms.hidden = false;
    signedIn.hidden = true;
  }
}

function bindPasswordToggles() {
  $$("[data-reveal]").forEach((button) => {
    const input = document.getElementById(button.getAttribute("aria-controls"));
    button.addEventListener("click", () => {
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      // the visible word and the accessible name change together (label in name)
      button.textContent = show ? "Hide" : "Show";
      button.setAttribute("aria-label", show ? "Hide password" : "Show password");
      input.focus();
    });
  });
}

async function start() {
  $("#signin-form").addEventListener("submit", (event) => {
    event.preventDefault();
    submitAuth(event.currentTarget, "/login");
  });
  $("#signup-form").addEventListener("submit", (event) => {
    event.preventDefault();
    submitAuth(event.currentTarget, "/signup");
  });
  $("[data-sign-out]").addEventListener("click", () => signOut());
  bindPasswordToggles();
  document.addEventListener("auth:change", render);
  await initShell();
  render();
}

start();
