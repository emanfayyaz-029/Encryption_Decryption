/* ==========================================================================
   Cipher Bench
   Encryption / decryption engine + UI wiring
   ========================================================================== */
(() => {
  "use strict";

  const A_CODE = "A".charCodeAt(0);
  const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

  /* ------------------------------------------------------------------ *
   * Cipher engines — each returns a plain-text encrypt/decrypt pair.
   * All logic works on A-Z / a-z only; everything else passes through
   * untouched, which is what keeps punctuation and spacing readable.
   * ------------------------------------------------------------------ */

  function caesarShiftChar(ch, shift, preserveCase) {
    const isUpper = ch >= "A" && ch <= "Z";
    const isLower = ch >= "a" && ch <= "z";
    if (!isUpper && !isLower) return ch;

    const base = isUpper ? 65 : 97;
    const normalizedShift = ((shift % 26) + 26) % 26;
    const shifted = String.fromCharCode(
      ((ch.charCodeAt(0) - base + normalizedShift) % 26) + base
    );

    if (!preserveCase) return shifted.toUpperCase();
    return shifted;
  }

  function caesarEncrypt(text, shift, preserveCase) {
    return text
      .split("")
      .map((ch) => caesarShiftChar(ch, shift, preserveCase))
      .join("");
  }

  function caesarDecrypt(text, shift, preserveCase) {
    return caesarEncrypt(text, -shift, preserveCase);
  }

  function atbashChar(ch) {
    if (ch >= "A" && ch <= "Z") {
      return String.fromCharCode(90 - (ch.charCodeAt(0) - 65));
    }
    if (ch >= "a" && ch <= "z") {
      return String.fromCharCode(122 - (ch.charCodeAt(0) - 97));
    }
    return ch;
  }

  function atbashTransform(text) {
    return text.split("").map(atbashChar).join("");
  }

  function vigenereTransform(text, keyword, decrypt, preserveCase) {
    const key = (keyword || "").replace(/[^A-Za-z]/g, "").toUpperCase();
    if (!key.length) return text;

    let keyIndex = 0;
    return text
      .split("")
      .map((ch) => {
        const isUpper = ch >= "A" && ch <= "Z";
        const isLower = ch >= "a" && ch <= "z";
        if (!isUpper && !isLower) return ch;

        const keyShift = key.charCodeAt(keyIndex % key.length) - 65;
        keyIndex++;
        const shift = decrypt ? -keyShift : keyShift;
        return caesarShiftChar(ch, shift, preserveCase);
      })
      .join("");
  }

  /* ------------------------------------------------------------------ *
   * State
   * ------------------------------------------------------------------ */
  const state = {
    method: "caesar",
    shift: 3,
    keyword: "BRASS",
    preserveCase: true,
  };

  /* ------------------------------------------------------------------ *
   * Persistent history — saved to localStorage so it survives a page
   * refresh or the browser being closed and reopened. Only the user's
   * own "Clear history" button empties it. Every call is isolated in
   * try/catch so a blocked or unavailable storage API can never break
   * the encrypt/decrypt buttons themselves.
   * ------------------------------------------------------------------ */
  const STORAGE_KEY = "cipherBenchHistory";
  let storageAvailable = false;

  function testStorage() {
    try {
      const testKey = "__cipherBenchTest__";
      window.localStorage.setItem(testKey, "1");
      window.localStorage.removeItem(testKey);
      return true;
    } catch (err) {
      return false;
    }
  }

  function loadLog() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.map((entry) => ({ ...entry, time: new Date(entry.time) }));
    } catch (err) {
      return [];
    }
  }

  function saveLog() {
    if (!storageAvailable) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(log));
    } catch (err) {
      storageAvailable = false;
    }
  }

  // Start with an empty in-memory log. Anything persisted gets merged in
  // later, inside init(), well after every button already works.
  const log = [];

  /* ------------------------------------------------------------------ *
   * DOM references
   * ------------------------------------------------------------------ */
  const $ = (id) => document.getElementById(id);

  const tabs = document.querySelectorAll(".tab");
  const controlBlocks = {
    caesar: document.querySelector('[data-control="caesar"]'),
    vigenere: document.querySelector('[data-control="vigenere"]'),
    atbash: document.querySelector('[data-control="atbash"]'),
  };

  const shiftRange = $("shiftRange");
  const shiftNumber = $("shiftNumber");
  const keywordInput = $("keywordInput");
  const preserveCaseBox = $("preserveCase");

  const plainText = $("plainText");
  const cipherText = $("cipherText");
  const plainCount = $("plainCount");
  const cipherCount = $("cipherCount");

  const encryptBtn = $("encryptBtn");
  const decryptBtn = $("decryptBtn");
  const clearPlainBtn = $("clearPlainBtn");
  const copyCipherBtn = $("copyCipherBtn");
  const clearLogBtn = $("clearLogBtn");

  const statusLine = $("statusLine");
  const mappingTable = $("mappingTable");
  const ledgerList = $("ledgerList");

  const wheelShiftReadout = $("wheelShiftReadout");
  const wheelRotor = $("wheelRotor");
  const outerLettersG = $("outerLetters");
  const innerLettersG = $("innerLetters");

  /* ------------------------------------------------------------------ *
   * Rotor (signature visualization)
   * ------------------------------------------------------------------ */
  function polarPoint(cx, cy, r, angleDeg) {
    const rad = ((angleDeg - 90) * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  }

  function buildWheelLetters() {
    const outerFrag = document.createDocumentFragment();
    const innerFrag = document.createDocumentFragment();

    ALPHABET.forEach((letter, i) => {
      const angle = i * (360 / 26);

      const outerPos = polarPoint(180, 180, 150, angle);
      const outerText = document.createElementNS("http://www.w3.org/2000/svg", "text");
      outerText.setAttribute("x", outerPos.x.toFixed(2));
      outerText.setAttribute("y", outerPos.y.toFixed(2));
      outerText.textContent = letter;
      outerFrag.appendChild(outerText);

      const innerPos = polarPoint(180, 180, 100, angle);
      const innerText = document.createElementNS("http://www.w3.org/2000/svg", "text");
      innerText.setAttribute("x", innerPos.x.toFixed(2));
      innerText.setAttribute("y", innerPos.y.toFixed(2));
      innerText.textContent = letter;
      innerFrag.appendChild(innerText);
    });

    outerLettersG.appendChild(outerFrag);
    innerLettersG.appendChild(innerFrag);
  }

  function updateWheelRotation() {
    // Only Caesar has a literal single rotational offset; other modes
    // park the rotor at its base position but still show the current shift.
    const shift = state.method === "caesar" ? state.shift : 0;
    const degreesPerLetter = 360 / 26;
    wheelRotor.style.transform = `rotate(${shift * degreesPerLetter}deg)`;
    wheelShiftReadout.textContent = state.method === "caesar" ? state.shift : "—";
  }

  /* ------------------------------------------------------------------ *
   * Mapping table
   * ------------------------------------------------------------------ */
  function currentCipherLetter(letter) {
    if (state.method === "caesar") {
      return caesarShiftChar(letter, state.shift, false);
    }
    if (state.method === "atbash") {
      return atbashChar(letter);
    }
    // Vigenère: show the mapping for the keyword's first letter as a
    // representative sample, since the true map shifts per position.
    const key = (state.keyword || "A").replace(/[^A-Za-z]/g, "").toUpperCase() || "A";
    const keyShift = key.charCodeAt(0) - 65;
    return caesarShiftChar(letter, keyShift, false);
  }

  function renderMappingTable() {
    mappingTable.innerHTML = "";
    const frag = document.createDocumentFragment();
    ALPHABET.forEach((letter) => {
      const cell = document.createElement("div");
      cell.className = "map-cell";
      cell.innerHTML = `
        <div class="map-cell__plain">${letter}</div>
        <div class="map-cell__arrow">↓</div>
        <div class="map-cell__cipher">${currentCipherLetter(letter)}</div>
      `;
      frag.appendChild(cell);
    });
    mappingTable.appendChild(frag);
  }

  /* ------------------------------------------------------------------ *
   * Method / control switching
   * ------------------------------------------------------------------ */
  function setMethod(method) {
    state.method = method;

    tabs.forEach((tab) => {
      const active = tab.dataset.method === method;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
    });

    Object.entries(controlBlocks).forEach(([key, el]) => {
      el.hidden = key !== method;
    });

    updateWheelRotation();
    renderMappingTable();
    setStatus(`Switched to ${labelFor(method)}. Enter plaintext and press Encrypt.`);
  }

  function labelFor(method) {
    return { caesar: "Caesar Shift", vigenere: "Vigenère", atbash: "Atbash" }[method];
  }

  /* ------------------------------------------------------------------ *
   * Encrypt / decrypt actions
   * ------------------------------------------------------------------ */
  function runTransform(text, decrypt) {
    const preserveCase = state.preserveCase;
    switch (state.method) {
      case "caesar":
        return decrypt
          ? caesarDecrypt(text, state.shift, preserveCase)
          : caesarEncrypt(text, state.shift, preserveCase);
      case "vigenere":
        return vigenereTransform(text, state.keyword, decrypt, preserveCase);
      case "atbash":
        return atbashTransform(text); // symmetric, decrypt === encrypt
      default:
        return text;
    }
  }

  function setStatus(msg, isError = false) {
    statusLine.textContent = msg;
    statusLine.classList.toggle("is-error", isError);
  }

  function validateKeyIfNeeded() {
    if (state.method === "vigenere" && !state.keyword.trim()) {
      setStatus("Enter a keyword before running Vigenère.", true);
      keywordInput.focus();
      return false;
    }
    return true;
  }

  function handleEncrypt() {
    if (!validateKeyIfNeeded()) return;
    const input = plainText.value;
    if (!input.trim()) {
      setStatus("Type something into Plaintext first.", true);
      return;
    }
    const result = runTransform(input, false);
    cipherText.value = result;
    updateCounts();
    setStatus(`Encrypted with ${labelFor(state.method)}${methodSuffix()}.`);
    addLogEntry("Encrypt", input, result);
  }

  function handleDecrypt() {
    if (!validateKeyIfNeeded()) return;

    // Most people paste ciphertext into the right-hand box — but if that
    // box is empty and there's text sitting in Plaintext instead, decrypt
    // that in place rather than doing nothing.
    const usingPlainBox = !cipherText.value.trim() && plainText.value.trim();
    const input = usingPlainBox ? plainText.value : cipherText.value;

    if (!input.trim()) {
      setStatus("Type or paste some text into either box first, then press Decrypt.", true);
      return;
    }

    const result = runTransform(input, true);
    plainText.value = result;
    updateCounts();
    setStatus(`Decrypted with ${labelFor(state.method)}${methodSuffix()}.`);
    addLogEntry("Decrypt", input, result);
  }

  function methodSuffix() {
    if (state.method === "caesar") return ` (shift ${state.shift})`;
    if (state.method === "vigenere") return ` (keyword "${state.keyword.toUpperCase()}")`;
    return "";
  }

  /* ------------------------------------------------------------------ *
   * Ledger
   * ------------------------------------------------------------------ */
  function addLogEntry(action, input, output) {
    log.unshift({
      action,
      method: labelFor(state.method),
      time: new Date(),
      snippet: `${truncate(input, 24)}  →  ${truncate(output, 24)}`,
    });
    saveLog();
    renderLedger();
  }

  function truncate(str, n) {
    const clean = str.replace(/\s+/g, " ").trim();
    return clean.length > n ? clean.slice(0, n) + "…" : clean;
  }

  function renderLedger() {
    if (!log.length) {
      ledgerList.innerHTML = '<li class="ledger__empty">No operations logged yet.</li>';
      return;
    }
    ledgerList.innerHTML = log
      .map((entry) => {
        const isDecrypt = entry.action === "Decrypt";
        const time = entry.time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
        return `
          <li class="ledger__item ${isDecrypt ? "is-decrypt" : ""}">
            <span class="ledger__time">${time}</span>
            <span class="ledger__badge">${entry.action}</span>
            <span class="ledger__snippet">${escapeHtml(entry.snippet)}</span>
            <span class="ledger__method">${entry.method}</span>
          </li>
        `;
      })
      .join("");
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  /* ------------------------------------------------------------------ *
   * Counts / copy / clear
   * ------------------------------------------------------------------ */
  function updateCounts() {
    plainCount.textContent = `${plainText.value.length} chars`;
    cipherCount.textContent = `${cipherText.value.length} chars`;
  }

  async function copyCipherToClipboard() {
    if (!cipherText.value) {
      setStatus("Nothing to copy yet.", true);
      return;
    }
    try {
      await navigator.clipboard.writeText(cipherText.value);
      setStatus("Ciphertext copied to clipboard.");
    } catch (err) {
      cipherText.select();
      setStatus("Clipboard blocked — text selected instead, use Ctrl/Cmd+C.", true);
    }
  }

  /* ------------------------------------------------------------------ *
   * Event wiring
   * ------------------------------------------------------------------ */
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => setMethod(tab.dataset.method));
  });

  shiftRange.addEventListener("input", () => {
    state.shift = Number(shiftRange.value);
    shiftNumber.value = state.shift;
    updateWheelRotation();
    renderMappingTable();
  });

  shiftNumber.addEventListener("input", () => {
    let val = Number(shiftNumber.value);
    if (Number.isNaN(val)) return;
    val = Math.min(25, Math.max(1, val));
    state.shift = val;
    shiftRange.value = val;
    updateWheelRotation();
    renderMappingTable();
  });

  keywordInput.addEventListener("input", () => {
    state.keyword = keywordInput.value;
    renderMappingTable();
  });

  preserveCaseBox.addEventListener("change", () => {
    state.preserveCase = preserveCaseBox.checked;
  });

  encryptBtn.addEventListener("click", handleEncrypt);
  decryptBtn.addEventListener("click", handleDecrypt);

  clearPlainBtn.addEventListener("click", () => {
    plainText.value = "";
    updateCounts();
    setStatus("Plaintext cleared.");
  });

  copyCipherBtn.addEventListener("click", copyCipherToClipboard);

  clearLogBtn.addEventListener("click", () => {
    log.length = 0;
    saveLog();
    renderLedger();
    setStatus("History cleared.");
  });

  plainText.addEventListener("input", updateCounts);
  cipherText.addEventListener("input", updateCounts);

  /* ------------------------------------------------------------------ *
   * Hero demo — prefills a real, working example on load so the tool
   * visibly does its job before the person types anything, and gives
   * the page a brief moment of motion on arrival.
   * ------------------------------------------------------------------ */
  function runHeroDemo() {
    const sample = "DEFEND THE CASTLE AT DAWN";
    plainText.value = sample;
    cipherText.value = caesarEncrypt(sample, state.shift, state.preserveCase);
    updateCounts();

    // A quick, tasteful rotor spin to draw the eye on first paint.
    wheelRotor.style.transition = "none";
    wheelRotor.style.transform = "rotate(360deg)";
    requestAnimationFrame(() => {
      wheelRotor.style.transition = "";
      updateWheelRotation();
    });

    setStatus('Try it: press "Decrypt" to reveal the sample message below, or type your own.');
  }

  /* ------------------------------------------------------------------ *
   * Init
   * ------------------------------------------------------------------ */
  function init() {
    buildWheelLetters();
    keywordInput.value = state.keyword;
    setMethod("caesar");
    updateCounts();
    renderLedger();
    runHeroDemo();
    initScrollReveal();

    // Storage is attempted last and wrapped so a blocked or unavailable
    // localStorage (e.g. certain sandboxed previews) can never prevent
    // the encrypt/decrypt buttons above from working.
    try {
      storageAvailable = testStorage();
      if (storageAvailable) {
        const restored = loadLog();
        if (restored.length) {
          log.push(...restored);
          renderLedger();
          setStatus(`Welcome back — restored ${log.length} saved ${log.length === 1 ? "entry" : "entries"} from your history.`);
        }
      } else {
        setStatus("Note: this browser is blocking saved history here, so it will reset on refresh. Everything else works as normal.");
      }
    } catch (err) {
      storageAvailable = false;
    }
  }

  /* ------------------------------------------------------------------ *
   * Scroll reveal — subtle fade/rise as sections enter the viewport.
   * ------------------------------------------------------------------ */
  function initScrollReveal() {
    const revealables = document.querySelectorAll("main > section");
    if (!("IntersectionObserver" in window)) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12 }
    );

    revealables.forEach((el) => {
      el.classList.add("reveal");
      observer.observe(el);
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
