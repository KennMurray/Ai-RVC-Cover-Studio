"use strict";

// AI Cover Studio v0.1: prawdziwa lokalna biblioteka ZIP w IndexedDB.
// UWAGA: Ta wersja NIE wykonuje jeszcze konwersji RVC.
const DB_NAME = "ai-cover-studio-v1";
const STORE = "models";
const $ = (id) => document.getElementById(id);
let db = null;
let selectedModelId = null;
let audioURL = null;

function setStatus(message, error = false) {
  $("status").textContent = message;
  $("status").classList.toggle("error", error);
}

function openDB() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error("IndexedDB niedostępne w tej przeglądarce."));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const database = req.result;
      if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE, {keyPath: "id"});
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("Nie można otworzyć bazy danych."));
    req.onblocked = () => reject(new Error("Baza jest zablokowana przez inną kartę."));
  });
}
function transact(mode, operation) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = operation(tx.objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Błąd operacji na bibliotece."));
    tx.onerror = () => reject(tx.error || new Error("Błąd IndexedDB."));
  });
}
const getModels = () => transact("readonly", store => store.getAll());
const saveModel = record => transact("readwrite", store => store.put(record));
const deleteModel = id => transact("readwrite", store => store.delete(id));
const readModel = id => transact("readonly", store => store.get(id));

// Czyta spis plików ZIP z central directory — bez wysyłania pliku do serwera.
// Wspiera standardowe ZIP; szyfrowane archiwa i ZIP64 nie są obsługiwane w v0.1.
function readZipEntries(buffer) {
  const bytes = new Uint8Array(buffer), view = new DataView(buffer);
  const u16 = n => view.getUint16(n, true), u32 = n => view.getUint32(n, true);
  const decoder = new TextDecoder("utf-8");
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (u32(i) === 0x06054b50 && i + 22 + u16(i + 20) <= bytes.length) {eocd = i; break;}
  }
  if (eocd < 0) throw new Error("Nie udało się odczytać archiwum ZIP.");
  const count = u16(eocd + 10), centralOffset = u32(eocd + 16);
  if (count === 65535 || centralOffset === 0xffffffff) throw new Error("ZIP64 nie jest obsługiwany.");
  const entries = []; let pos = centralOffset;
  for (let i = 0; i < count; i++) {
    if (pos + 46 > bytes.length || u32(pos) !== 0x02014b50) throw new Error("Uszkodzony spis plików ZIP.");
    const flags = u16(pos + 8), method = u16(pos + 10), compressedSize = u32(pos + 20);
    const nameLength = u16(pos + 28), extraLength = u16(pos + 30), commentLength = u16(pos + 32), offset = u32(pos + 42);
    const end = pos + 46 + nameLength + extraLength + commentLength;
    if (end > bytes.length) throw new Error("Nieprawidłowe dane ZIP.");
    const name = decoder.decode(bytes.subarray(pos + 46, pos + 46 + nameLength));
    entries.push({name, flags, method, compressedSize, offset});
    pos = end;
  }
  return {entries, bytes, view};
}
async function unzipText(zip, entry) {
  if ((entry.flags & 1) !== 0) throw new Error("ZIP jest zaszyfrowany.");
  const {bytes, view} = zip, u16 = n => view.getUint16(n, true), u32 = n => view.getUint32(n, true);
  const start = entry.offset;
  if (start + 30 > bytes.length || u32(start) !== 0x04034b50) throw new Error("Nieprawidłowy nagłówek ZIP.");
  const dataStart = start + 30 + u16(start + 26) + u16(start + 28);
  if (dataStart + entry.compressedSize > bytes.length) throw new Error("Nieprawidłowa długość danych ZIP.");
  const compressed = bytes.slice(dataStart, dataStart + entry.compressedSize);
  if (entry.method === 0) return new TextDecoder().decode(compressed);
  if (entry.method === 8 && typeof DecompressionStream !== "undefined") {
    try {
      const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      return await new Response(stream).text();
    } catch { throw new Error("Przeglądarka nie rozpakowała metadata.json (deflate-raw)."); }
  }
  throw new Error("Ten format kompresji ZIP nie jest obsługiwany przez przeglądarkę.");
}
async function inspectZip(file) {
  if (file.size > 1024 * 1024 * 1024) throw new Error("ZIP jest za duży dla prototypu (limit 1 GB).");
  const buffer = await file.arrayBuffer();
  const zip = readZipEntries(buffer);
  const files = zip.entries.filter(e => !e.name.endsWith("/"));
  const pth = files.find(e => e.name.toLowerCase().endsWith(".pth"));
  const onnx = files.find(e => e.name.toLowerCase().endsWith(".onnx"));
  const index = files.find(e => e.name.toLowerCase().endsWith(".index"));
  if (!pth && !onnx) throw new Error("ZIP nie zawiera pliku .pth ani .onnx.");
  const metadataEntry = files.find(e => e.name.split("/").pop().toLowerCase() === "metadata.json");
  let metadata = null, warning = "";
  if (metadataEntry) {
    try { metadata = JSON.parse(await unzipText(zip, metadataEntry)); }
    catch (err) { warning = `Nie odczytano metadata.json: ${err.message}`; }
  }
  const version = metadata?.torchMetadata?.version || metadata?.type || "nieznana";
  const sampleRate = metadata?.torchMetadata?.config?.sr || metadata?.torchMetadata?.extra_info?.sr || "?";
  return { title: String(metadata?.title || file.name.replace(/\.zip$/i, "")).slice(0, 160), version, sampleRate, hasIndex: !!index, modelName: (pth || onnx).name, warning };
}

function formatSize(bytes) { return (bytes / (1024 * 1024)).toFixed(1) + " MB"; }
async function renderModels() {
  const list = $("modelsList"); list.replaceChildren();
  const models = (await getModels()).sort((a,b) => b.createdAt - a.createdAt);
  $("modelCount").textContent = `${models.length} ${models.length === 1 ? "model" : "models"}`;
  if (!models.length) {
    const p = document.createElement("p"); p.className = "empty";
    p.textContent = "Twoja biblioteka jest pusta. Dodaj pierwszy ZIP z modelem RVC.";
    list.append(p); return;
  }
  if (!models.some(m => m.id === selectedModelId)) selectedModelId = models[0].id;
  for (const model of models) {
    const card = document.createElement("div");
    card.className = "model-card" + (model.id === selectedModelId ? " selected" : "");
    const radio = document.createElement("input"); radio.type = "radio";
    radio.name = "model"; radio.checked = model.id === selectedModelId;
    radio.setAttribute("aria-label", `Wybierz model ${model.title}`);
    radio.addEventListener("change", () => { selectedModelId = model.id; renderModels(); });
    const info = document.createElement("div"); info.className = "model-info";
    const title = document.createElement("strong"); title.textContent = model.title;
    const detail = document.createElement("small");
    detail.textContent = `${model.version} · ${model.sampleRate} · ${formatSize(model.blob.size)} · index: ${model.hasIndex ? "tak" : "nie"}`;
    info.append(title, detail);
    info.addEventListener("click", () => {selectedModelId = model.id; renderModels();});
    const remove = document.createElement("button"); remove.type = "button";
    remove.className = "remove-model"; remove.textContent = "Usuń";
    remove.setAttribute("aria-label", `Usuń model ${model.title}`);
    remove.addEventListener("click", async () => {
      if (!confirm(`Usunąć „${model.title}” z lokalnej biblioteki? Oryginalny ZIP na dysku pozostanie bez zmian.`)) return;
      try {await deleteModel(model.id); if(selectedModelId === model.id) selectedModelId = null; await renderModels(); setStatus(`Usunięto model „${model.title}”.`);}
      catch (error) {setStatus(error.message, true);}
    });
    card.append(radio, info, remove); list.append(card);
  }
}
async function importModels(files) {
  if (!db) return setStatus("Brak dostępu do lokalnej bazy danych.", true);
  for (const file of files) {
    try {
      if (!file.name.toLowerCase().endsWith(".zip")) throw new Error("Wybierz plik ZIP.");
      setStatus(`Sprawdzanie pliku „${file.name}”…`);
      const info = await inspectZip(file);
      const record = {id: crypto.randomUUID(), blob: file, filename: file.name, createdAt: Date.now(), ...info};
      await saveModel(record);
      selectedModelId = record.id;
      await renderModels();
      setStatus(`Zapisano model „${record.title}” (${record.version}). ${info.warning}`);
    } catch (error) {setStatus(`Nie udało się dodać „${file.name}”: ${error.message}`, true);}
  }
}
function setAudio(file) {
  if (audioURL) URL.revokeObjectURL(audioURL);
  audioURL = file ? URL.createObjectURL(file) : null;
  $("audioDetails").hidden = !file;
  $("audioName").textContent = file ? `${file.name} · ${formatSize(file.size)}` : "";
  $("audioPlayer").src = audioURL || "";
  setStatus(file ? `Wczytano wokal „${file.name}”.` : "Usunięto nagranie z odtwarzacza.");
}
$("pitch").addEventListener("input", () => {
  const value = Number($("pitch").value);
  $("pitchValue").textContent = `${value > 0 ? "+" : ""}${value} semitones`;
});
$("audioInput").addEventListener("change", event => {
  const file = event.target.files[0];
  if (file) setAudio(file);
});
$("removeAudio").addEventListener("click", () => {
  $("audioInput").value = ""; setAudio(null);
});
$("modelInput").addEventListener("change", async event => {
  await importModels([...event.target.files]);
  event.target.value = "";
});
(async function boot() {
  try {db = await openDB(); await renderModels();}
  catch (error) {setStatus(`Biblioteka jest niedostępna: ${error.message}. Spróbuj uruchomić stronę przez localhost.`, true);}
})();
