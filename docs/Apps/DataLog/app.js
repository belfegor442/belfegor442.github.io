(function () {
  "use strict";

  const Core = window.DataLogCore;
  const DB_NAME = "north-assembly-datalog";
  const DB_VERSION = 1;
  const APP_VERSION = "1.0.0-beta";
  const DEFAULT_TEMPLATES = [
    {
      id: "default-observation",
      name: "Observation",
      description: "Capture a dated observation, measurement and supporting notes.",
      isDefault: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      fields: [
        { key: "category", label: "Category", type: "text", required: true },
        { key: "observed_at", label: "Observation date", type: "date", required: true },
        { key: "measurement", label: "Measurement", type: "number", required: false },
        { key: "unit", label: "Unit", type: "text", required: false },
        { key: "notes", label: "Notes", type: "textarea", required: false },
        { key: "verified", label: "Verified", type: "checkbox", required: false }
      ]
    },
    {
      id: "default-experiment",
      name: "Experiment",
      description: "Record a hypothesis, outcome and supporting conclusion.",
      isDefault: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      fields: [
        { key: "hypothesis", label: "Hypothesis", type: "textarea", required: true },
        { key: "result", label: "Result", type: "textarea", required: false },
        { key: "duration_minutes", label: "Duration (minutes)", type: "number", required: false },
        { key: "outcome", label: "Outcome", type: "text", required: false },
        { key: "conclusion", label: "Conclusion", type: "textarea", required: false }
      ]
    },
    {
      id: "default-inventory",
      name: "Inventory item",
      description: "Track an item, its quantity and where it is stored.",
      isDefault: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      fields: [
        { key: "item", label: "Item", type: "text", required: true },
        { key: "quantity", label: "Quantity", type: "number", required: true },
        { key: "unit", label: "Unit", type: "text", required: false },
        { key: "location", label: "Location", type: "text", required: false },
        { key: "notes", label: "Notes", type: "textarea", required: false }
      ]
    }
  ];

  const state = {
    db: null,
    records: [],
    templates: [],
    view: "overview",
    editingRecordId: null,
    editingTemplateId: null,
    filters: { query: "", templateId: "", from: "", to: "" },
    analysis: { templateId: "", fieldKey: "" },
    toastTimer: null,
    templateRowCounter: 0
  };

  const $ = selector => document.querySelector(selector);
  const $$ = selector => Array.from(document.querySelectorAll(selector));

  function escapeHTML(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[char]);
  }

  function makeId(prefix) {
    const value = window.crypto && typeof window.crypto.randomUUID === "function"
      ? window.crypto.randomUUID()
      : Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
    return (prefix || "id") + "-" + value;
  }

  function todayISO() {
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
  }

  function formatDate(value) {
    if (!value) return "—";
    const parsed = new Date(value.length === 10 ? value + "T12:00:00" : value);
    if (Number.isNaN(parsed.getTime())) return "—";
    return new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" }).format(parsed);
  }

  function formatNumber(value) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(Number(value));
  }

  function showToast(message, isError) {
    const toast = $("#toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.toggle("is-error", Boolean(isError));
    toast.classList.add("is-visible");
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 3200);
  }

  function setStorageStatus(message, isError) {
    $("#storageStatus").textContent = message;
    $(".storage-indicator").classList.toggle("is-error", Boolean(isError));
  }

  function requestAsPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Database request failed."));
    });
  }

  function transactionAsPromise(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("Database transaction failed."));
      transaction.onabort = () => reject(transaction.error || new Error("Database transaction was cancelled."));
    });
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) {
        reject(new Error("This browser does not provide IndexedDB. Use a current version of Chrome, Edge, Firefox or Safari."));
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains("records")) {
          const store = database.createObjectStore("records", { keyPath: "id" });
          store.createIndex("templateId", "templateId", { unique: false });
          store.createIndex("updatedAt", "updatedAt", { unique: false });
        }
        if (!database.objectStoreNames.contains("templates")) {
          database.createObjectStore("templates", { keyPath: "id" });
        }
      };
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => database.close();
        resolve(database);
      };
      request.onerror = () => reject(request.error || new Error("Could not open the local database."));
      request.onblocked = () => reject(new Error("DataLog's database is busy in another tab. Close the other DataLog tab and reload."));
    });
  }

  async function readAll(storeName) {
    const transaction = state.db.transaction(storeName, "readonly");
    return requestAsPromise(transaction.objectStore(storeName).getAll());
  }

  async function saveItem(storeName, value) {
    const transaction = state.db.transaction(storeName, "readwrite");
    const done = transactionAsPromise(transaction);
    transaction.objectStore(storeName).put(value);
    await done;
  }

  async function deleteItem(storeName, id) {
    const transaction = state.db.transaction(storeName, "readwrite");
    const done = transactionAsPromise(transaction);
    transaction.objectStore(storeName).delete(id);
    await done;
  }

  async function replaceDatabase(templates, records) {
    const transaction = state.db.transaction(["templates", "records"], "readwrite");
    const done = transactionAsPromise(transaction);
    const templateStore = transaction.objectStore("templates");
    const recordStore = transaction.objectStore("records");
    templateStore.clear();
    recordStore.clear();
    templates.forEach(template => templateStore.put(template));
    records.forEach(record => recordStore.put(record));
    await done;
  }

  async function initialiseTemplates() {
    const existing = await readAll("templates");
    if (existing.length) return;
    const transaction = state.db.transaction("templates", "readwrite");
    const done = transactionAsPromise(transaction);
    const store = transaction.objectStore("templates");
    DEFAULT_TEMPLATES.forEach(template => store.put(template));
    await done;
  }

  async function reloadData() {
    const [records, templates] = await Promise.all([readAll("records"), readAll("templates")]);
    state.records = records;
    state.templates = templates.sort((a, b) => a.name.localeCompare(b.name));
    $("#recordNavCount").textContent = String(records.length);
    setStorageStatus("Ready · " + records.length + " records", false);
  }

  function navigate(view) {
    const validViews = ["overview", "records", "templates", "analysis", "settings"];
    if (!validViews.includes(view)) return;
    state.view = view;
    render();
    $("#main").focus({ preventScroll: true });
  }

  function updateHeader() {
    const titles = {
      overview: "Overview",
      records: "Records",
      templates: "Templates",
      analysis: "Analysis",
      settings: "Settings & backups"
    };
    $("#viewTitle").textContent = titles[state.view] || "DataLog";
    $("#todayLabel").textContent = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(new Date());
    $$("[data-view]").forEach(button => button.classList.toggle("is-active", button.dataset.view === state.view));
    $("#addRecordTop").hidden = state.templates.length === 0;
  }

  function pageIntro(title, description, action) {
    return '<div class="page-intro"><div><h2>' + escapeHTML(title) + '</h2><p>' + escapeHTML(description) + '</p></div>' + (action || "") + '</div>';
  }

  function statCard(label, value, note, mark) {
    return '<article class="stat-card"><div class="stat-label"><span>' + escapeHTML(label) + '</span><span class="stat-mark" aria-hidden="true">' + escapeHTML(mark) + '</span></div><div class="stat-value">' + escapeHTML(value) + '</div><div class="stat-note">' + escapeHTML(note) + '</div></article>';
  }

  function emptyState(title, message, actionLabel, action) {
    const button = actionLabel && action
      ? '<button class="button button-primary" type="button" data-action="' + escapeHTML(action) + '">' + escapeHTML(actionLabel) + '</button>'
      : "";
    return '<div class="empty-state"><span class="empty-icon" aria-hidden="true">＋</span><h3>' + escapeHTML(title) + '</h3><p>' + escapeHTML(message) + '</p>' + button + '</div>';
  }

  function recordTable(records, compact) {
    if (!records.length) return emptyState(
      "No records yet",
      "Create your first record to start building a reliable history of your work.",
      "Create record",
      "new-record"
    );
    const templateMap = new Map(state.templates.map(template => [template.id, template.name]));
    const rows = records.map(record => {
      const title = escapeHTML(record.title);
      const template = findTemplate(record.templateId);
      const templateName = escapeHTML(templateMap.get(record.templateId) || "Unknown template");
      const date = escapeHTML(formatDate(record.occurredAt || record.createdAt));
      const id = escapeHTML(record.id);
      const preview = template ? template.fields.filter(field => record.values && record.values[field.key] !== "" && record.values[field.key] !== undefined && record.values[field.key] !== null).slice(0, 2).map(field => field.label + ": " + (typeof record.values[field.key] === "boolean" ? (record.values[field.key] ? "Yes" : "No") : String(record.values[field.key]))).join(" · ") : "";
      return '<tr><td class="record-title"><div>' + title + '</div>' + (preview ? '<div class="record-subtitle">' + escapeHTML(preview) + '</div>' : '') + '</td><td><span class="badge">' + templateName + '</span></td><td class="muted-cell">' + date + '</td><td class="muted-cell">' + escapeHTML(formatDate(record.updatedAt)) + '</td><td><div class="row-actions"><button class="icon-button" type="button" data-action="edit-record" data-id="' + id + '" aria-label="Edit ' + title + '" title="Edit">↗</button><button class="icon-button danger" type="button" data-action="delete-record" data-id="' + id + '" aria-label="Delete ' + title + '" title="Delete">×</button></div></td></tr>';
    }).join("");
    return '<div class="table-wrap"><table class="data-table"><thead><tr><th>Record</th><th>Template</th><th>Record date</th><th>Last updated</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      (compact ? "" : '<div class="table-footer"><span>Showing ' + records.length + ' record' + (records.length === 1 ? "" : "s") + '</span><span>Sorted by most recently updated</span></div>');
  }

  function renderOverview() {
    const summary = Core.summarize(state.records, state.templates);
    const recent = state.records.slice().sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, 6);
    const maxCount = Math.max(1, ...summary.byTemplate.map(item => item.count));
    const templateBars = summary.byTemplate.length
      ? '<div class="template-count-list">' + summary.byTemplate.map(item =>
        '<div class="template-count-row"><div class="template-count-meta"><span>' + escapeHTML(item.name) + '</span><span>' + item.count + '</span></div><progress class="progress-bar" max="100" value="' + (item.count / maxCount * 100).toFixed(1) + '">' + item.count + '</progress></div>'
      ).join("") + '</div>'
      : '<p class="muted-cell">Create a template to organise your records.</p>';

    $("#viewRoot").innerHTML =
      pageIntro("Workspace summary", "A current view of the information stored in this browser.", '<button class="button button-secondary" type="button" data-action="go-records">View all records →</button>') +
      '<section class="stats-grid">' +
      statCard("Total records", summary.total, "Saved in this browser", "≡") +
      statCard("Last 7 days", summary.recent, "Records by observation date", "↗") +
      statCard("Templates", summary.templates, "Reusable record structures", "▤") +
      statCard("Storage model", "Local", "No account or remote sync", "◉") +
      '</section>' +
      '<section class="dashboard-grid">' +
        '<article class="panel"><div class="panel-heading"><div><h3>Recent records</h3><p>Your latest saved entries</p></div><button class="button button-quiet button-small" type="button" data-action="go-records">Open records →</button></div>' +
          (recent.length ? recordTable(recent, true) : emptyState("Your workspace is empty", "Choose a template and create the first record. DataLog saves it to this browser.", "Create first record", "new-record")) +
        '</article>' +
        '<article class="panel"><div class="panel-heading"><div><h3>Records by template</h3><p>Distribution across your structures</p></div></div><div class="panel-body">' + templateBars + '</div></article>' +
      '</section>' +
      '<div class="warning-box">DataLog stores information in this browser using IndexedDB. Export regular backups before clearing browser data, changing devices or reinstalling your browser.</div>';
  }

  function currentFilteredRecords() {
    return Core.filterRecords(state.records, state.filters, state.templates);
  }

  function renderRecords() {
    const templateOptions = '<option value="">All templates</option>' + state.templates.map(template =>
      '<option value="' + escapeHTML(template.id) + '"' + (state.filters.templateId === template.id ? " selected" : "") + '>' + escapeHTML(template.name) + '</option>'
    ).join("");
    const records = currentFilteredRecords();
    $("#viewRoot").innerHTML =
      pageIntro("Record register", "Search, inspect and maintain your saved records.", '<button class="button button-primary" type="button" data-action="new-record">＋ New record</button>') +
      '<div class="toolbar">' +
        '<label class="search-box"><span class="sr-only">Search records</span><input id="recordSearch" type="search" placeholder="Search title, field or value…" value="' + escapeHTML(state.filters.query) + '"></label>' +
        '<label><span class="sr-only">Filter by template</span><select id="recordTemplateFilter" class="control">' + templateOptions + '</select></label>' +
        '<label><span class="sr-only">From date</span><input class="control date-control" id="recordFrom" type="date" aria-label="From date" value="' + escapeHTML(state.filters.from) + '"></label>' +
        '<label><span class="sr-only">To date</span><input class="control date-control" id="recordTo" type="date" aria-label="To date" value="' + escapeHTML(state.filters.to) + '"></label>' +
        '<button class="button button-quiet button-small" type="button" data-action="clear-filters">Reset</button>' +
        '<button class="button button-secondary button-small" type="button" data-action="export-filtered-csv">Export CSV</button>' +
      '</div>' +
      '<article class="panel"><div class="panel-heading"><div><h3>Saved records</h3><p>Only records stored in this browser are shown.</p></div><span class="badge">' + records.length + ' results</span></div>' +
        recordTable(records, false) +
      '</article>';
  }

  function renderTemplates() {
    if (!state.templates.length) {
      $("#viewRoot").innerHTML = pageIntro("Templates", "Define the fields used to capture consistent information.", '<button class="button button-primary" type="button" data-action="new-template">＋ New template</button>') +
        '<article class="panel">' + emptyState("No templates available", "Create a template before adding records.", "Create template", "new-template") + '</article>';
      return;
    }
    const cards = state.templates.map(template => {
      const count = state.records.filter(record => record.templateId === template.id).length;
      const chips = template.fields.slice(0, 6).map(field => '<span class="field-chip">' + escapeHTML(field.label) + '</span>').join("");
      return '<article class="template-card"><div class="template-card-top"><span>DATA STRUCTURE</span><span>' + template.fields.length + ' FIELDS</span></div><h3>' + escapeHTML(template.name) + '</h3><p>' + escapeHTML(template.description || "Reusable record structure.") + '</p><div class="field-chips">' + chips + (template.fields.length > 6 ? '<span class="field-chip">+' + (template.fields.length - 6) + ' more</span>' : "") + '</div><div class="template-card-footer"><span>' + count + ' linked record' + (count === 1 ? "" : "s") + '</span><div class="row-actions"><button class="icon-button" type="button" data-action="edit-template" data-id="' + escapeHTML(template.id) + '" aria-label="Edit ' + escapeHTML(template.name) + '" title="Edit">↗</button><button class="icon-button danger" type="button" data-action="delete-template" data-id="' + escapeHTML(template.id) + '" aria-label="Delete ' + escapeHTML(template.name) + '" title="Delete">×</button></div></div></article>';
    }).join("");
    $("#viewRoot").innerHTML = pageIntro("Templates", "Build repeatable structures for observations, experiments, inventories and other workflows.", '<button class="button button-primary" type="button" data-action="new-template">＋ New template</button>') +
      '<section class="template-grid">' + cards + '</section>';
  }

  function renderAnalysis() {
    if (!state.templates.length) {
      $("#viewRoot").innerHTML = pageIntro("Analysis", "Review numerical fields in your saved records.") + '<article class="panel">' + emptyState("No templates to analyse", "Create a template and add records containing numerical fields.", "Create template", "new-template") + '</article>';
      return;
    }
    if (!state.analysis.templateId || !state.templates.some(item => item.id === state.analysis.templateId)) {
      state.analysis.templateId = state.templates[0].id;
    }
    const selectedTemplate = state.templates.find(item => item.id === state.analysis.templateId);
    const numericFields = selectedTemplate.fields.filter(field => field.type === "number");
    if (!numericFields.some(field => field.key === state.analysis.fieldKey)) {
      state.analysis.fieldKey = numericFields.length ? numericFields[0].key : "";
    }
    const templateOptions = state.templates.map(template => '<option value="' + escapeHTML(template.id) + '"' + (template.id === state.analysis.templateId ? " selected" : "") + '>' + escapeHTML(template.name) + '</option>').join("");
    const fieldOptions = numericFields.map(field => '<option value="' + escapeHTML(field.key) + '"' + (field.key === state.analysis.fieldKey ? " selected" : "") + '>' + escapeHTML(field.label) + '</option>').join("");
    let results = { count: 0, sum: 0, average: null, min: null, max: null };
    if (state.analysis.fieldKey) results = Core.numericSummary(state.records, selectedTemplate.id, state.analysis.fieldKey);
    const recordCount = state.records.filter(record => record.templateId === selectedTemplate.id).length;
    const stats = '<div class="analysis-stat-grid">' +
      '<div class="analysis-stat"><span>Numeric entries</span><strong>' + results.count + '</strong></div>' +
      '<div class="analysis-stat"><span>Average</span><strong>' + formatNumber(results.average) + '</strong></div>' +
      '<div class="analysis-stat"><span>Minimum</span><strong>' + formatNumber(results.min) + '</strong></div>' +
      '<div class="analysis-stat"><span>Maximum</span><strong>' + formatNumber(results.max) + '</strong></div>' +
      '</div>';
    let detail = "";
    if (!numericFields.length) {
      detail = '<div class="empty-state"><h3>No numerical fields</h3><p>This template does not contain a number field. Add one to the template to enable numerical analysis.</p></div>';
    } else if (!results.count) {
      detail = '<div class="empty-state"><h3>No numerical data yet</h3><p>There are ' + recordCount + ' records using this template, but no values have been saved for this field.</p></div>';
    } else {
      detail = '<p class="analysis-note">Aggregates are calculated from ' + results.count + ' non-empty numerical values across ' + recordCount + ' records using this template. No values are sent to a server.</p>';
    }
    $("#viewRoot").innerHTML = pageIntro("Analysis", "Calculate transparent summaries from the numerical values in your records.") +
      '<section class="analysis-grid"><article class="panel"><div class="panel-heading"><div><h3>Analysis scope</h3><p>Select the dataset to inspect</p></div></div><div class="analysis-controls">' +
        '<label>Template<select id="analysisTemplate" class="control">' + templateOptions + '</select></label>' +
        '<label>Numerical field<select id="analysisField" class="control"' + (!numericFields.length ? " disabled" : "") + '>' + (fieldOptions || '<option value="">No numeric fields</option>') + '</select></label>' +
      '</div></article><article class="panel"><div class="panel-heading"><div><h3>' + escapeHTML(selectedTemplate.name) + ' · Summary</h3><p>' + escapeHTML(selectedTemplate.description || "Numeric field summary") + '</p></div></div><div class="analysis-results">' + (numericFields.length ? stats : "") + detail + '</div></article></section>';
  }

  function renderSettings() {
    $("#viewRoot").innerHTML =
      pageIntro("Settings & backups", "Control your local data and protect your records.") +
      '<section class="settings-grid">' +
        '<article class="panel setting-card"><h3>Export a full backup</h3><p>Download all templates and records as a versioned JSON backup. Keep a copy somewhere outside this browser.</p><div class="setting-actions"><button class="button button-primary" type="button" data-action="export-json">Download JSON backup</button></div></article>' +
        '<article class="panel setting-card"><h3>Restore a backup</h3><p>Restore a DataLog JSON backup. Restoring replaces the records and templates currently stored in this browser.</p><div class="setting-actions"><label class="button button-secondary" for="backupFile">Choose backup file</label><input id="backupFile" type="file" accept=".json,application/json" hidden></div></article>' +
        '<article class="panel setting-card"><h3>Export records</h3><p>Export every record to CSV for use in spreadsheet software, or print a readable report and choose Save as PDF.</p><div class="setting-actions"><button class="button button-secondary" type="button" data-action="export-all-csv">Export CSV</button><button class="button button-secondary" type="button" data-action="print-report">Print / Save PDF</button></div></article>' +
        '<article class="panel setting-card"><h3>Clear local workspace</h3><p>Delete every record and template saved in this browser. This cannot be undone without a backup.</p><div class="setting-actions"><button class="button button-danger" type="button" data-action="clear-data">Delete local data</button></div></article>' +
      '</section>' +
      '<div class="warning-box">Privacy and storage: DataLog is local-first. Records are stored in this browser profile using IndexedDB. The application does not upload records, provide accounts, encrypt the local database or synchronise between devices. Anyone with access to this browser profile may be able to access its data. Back up important information regularly.</div>' +
      '<article class="panel setting-card section-gap"><h3>Application information</h3><div class="about-list">' +
        '<div class="about-row"><span>Version</span><strong>' + APP_VERSION + '</strong></div>' +
        '<div class="about-row"><span>Storage engine</span><strong>Browser IndexedDB</strong></div>' +
        '<div class="about-row"><span>Network requirement</span><strong>HTTPS for installation / offline cache</strong></div>' +
        '<div class="about-row"><span>Data format</span><strong>DataLog JSON backup v1 / CSV export</strong></div>' +
        '<div class="about-row"><span>Synchronisation</span><strong>Not available</strong></div>' +
        '<div class="about-row"><span>Last rendered</span><strong>' + escapeHTML(new Date().toLocaleString()) + '</strong></div>' +
      '</div></article>';
  }

  function render() {
    updateHeader();
    if (state.view === "overview") renderOverview();
    else if (state.view === "records") renderRecords();
    else if (state.view === "templates") renderTemplates();
    else if (state.view === "analysis") renderAnalysis();
    else renderSettings();
  }

  function findTemplate(id) {
    return state.templates.find(template => template.id === id);
  }

  function inputForField(field, value) {
    const id = "record-field-" + field.key;
    const label = '<label class="form-field' + (field.type === "textarea" ? " form-field-wide" : "") + '" for="' + escapeHTML(id) + '"><span>' + escapeHTML(field.label) + (field.required ? ' <b>*</b>' : "") + '</span>';
    const required = field.required ? " required" : "";
    const safeValue = escapeHTML(value === undefined || value === null ? "" : value);
    let input;
    if (field.type === "textarea") {
      input = '<textarea id="' + escapeHTML(id) + '" name="field_' + escapeHTML(field.key) + '"' + required + ' maxlength="10000" rows="3">' + safeValue + '</textarea>';
    } else if (field.type === "checkbox") {
      input = '<span class="checkbox-field"><input id="' + escapeHTML(id) + '" type="checkbox" name="field_' + escapeHTML(field.key) + '"' + (value ? " checked" : "") + '> Checked</span>';
    } else {
      const type = field.type === "number" ? "number" : field.type === "date" ? "date" : "text";
      const extra = field.type === "number" ? ' step="any"' : "";
      input = '<input id="' + escapeHTML(id) + '" type="' + type + '" name="field_' + escapeHTML(field.key) + '"' + required + extra + ' value="' + safeValue + '">';
    }
    return label + input + "</label>";
  }

  function renderRecordFields(templateId, values) {
    const template = findTemplate(templateId);
    $("#recordFields").innerHTML = template
      ? template.fields.map(field => inputForField(field, values ? values[field.key] : undefined)).join("")
      : '<p class="muted-cell">No template is selected.</p>';
  }

  function openRecordDialog(record) {
    if (!state.templates.length) {
      showToast("Create a template before adding records.", true);
      navigate("templates");
      return;
    }
    state.editingRecordId = record ? record.id : null;
    const form = $("#recordForm");
    form.reset();
    $("#recordFormError").textContent = "";
    $("#recordDialogTitle").textContent = record ? "Edit record" : "New record";
    const select = $("#recordTemplate");
    select.innerHTML = state.templates.map(template => '<option value="' + escapeHTML(template.id) + '">' + escapeHTML(template.name) + '</option>').join("");
    select.value = record ? record.templateId : state.templates[0].id;
    select.disabled = Boolean(record);
    form.elements.title.value = record ? record.title : "";
    renderRecordFields(select.value, record ? record.values : {});
    $("#recordDialog").showModal();
    form.elements.title.focus();
  }

  function collectRecordValues(template) {
    const form = $("#recordForm");
    const values = {};
    template.fields.forEach(field => {
      const control = form.elements["field_" + field.key];
      if (!control) return;
      if (field.type === "checkbox") values[field.key] = Boolean(control.checked);
      else if (field.type === "number") values[field.key] = control.value.trim() === "" ? "" : Number(control.value);
      else values[field.key] = control.value.trim();
    });
    return values;
  }

  async function saveRecord(event) {
    event.preventDefault();
    const form = $("#recordForm");
    const template = findTemplate(form.elements.templateId.value);
    if (!template) {
      $("#recordFormError").textContent = "Select a valid template.";
      return;
    }
    const now = new Date().toISOString();
    const existing = state.editingRecordId ? state.records.find(item => item.id === state.editingRecordId) : null;
    const values = collectRecordValues(template);
    const dateField = template.fields.find(field => field.type === "date" && values[field.key]);
    const record = {
      id: existing ? existing.id : makeId("rec"),
      title: form.elements.title.value.trim(),
      templateId: template.id,
      occurredAt: dateField ? values[dateField.key] : (existing ? existing.occurredAt : todayISO()),
      values,
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now
    };
    const result = Core.validateRecord(record, state.templates);
    if (!result.valid) {
      $("#recordFormError").textContent = result.errors.slice(0, 4).join(" ");
      return;
    }
    try {
      await saveItem("records", record);
      $("#recordDialog").close();
      await reloadData();
      render();
      showToast(existing ? "Record updated and saved locally." : "Record created and saved locally.");
    } catch (error) {
      $("#recordFormError").textContent = "The record could not be saved: " + error.message;
    }
  }

  function makeTemplateFieldRow(field) {
    const rowId = "field-row-" + (++state.templateRowCounter);
    const current = field || { key: "", label: "", type: "text", required: false };
    const types = [
      ["text", "Short text"], ["textarea", "Long text"], ["number", "Number"], ["date", "Date"], ["select", "Select"], ["checkbox", "Checkbox"]
    ];
    const typeOptions = types.map(([value, label]) => '<option value="' + value + '"' + (current.type === value ? " selected" : "") + '>' + label + '</option>').join("");
    const optionValues = Array.isArray(current.options) ? current.options.join(", ") : "";
    return '<div class="field-row" id="' + rowId + '" data-field-row>' +
      '<label>Field label<input name="fieldLabel" maxlength="60" required value="' + escapeHTML(current.label) + '" placeholder="e.g. Temperature"></label>' +
      '<label>Data type<select name="fieldType">' + typeOptions + '</select></label>' +
      '<label class="field-options' + (current.type === "select" ? "" : " is-hidden") + '">Options, separated by commas<input name="fieldOptions" maxlength="500" value="' + escapeHTML(optionValues) + '" placeholder="Open, In progress, Closed"></label>' +
      '<input type="hidden" name="fieldKey" value="' + escapeHTML(current.key || "") + '">' +
      '<label class="field-required">Required<input name="fieldRequired" type="checkbox"' + (current.required ? " checked" : "") + '></label>' +
      '<button class="icon-button danger field-row-remove" type="button" data-action="remove-field-row" aria-label="Remove field" title="Remove field">×</button>' +
      '</div>';
  }

  function addTemplateField(field) {
    $("#templateFieldRows").insertAdjacentHTML("beforeend", makeTemplateFieldRow(field));
  }

  function openTemplateDialog(template) {
    state.editingTemplateId = template ? template.id : null;
    const form = $("#templateForm");
    form.reset();
    $("#templateFormError").textContent = "";
    $("#templateDialogTitle").textContent = template ? "Edit template" : "New template";
    $("#templateFieldRows").innerHTML = "";
    form.elements.name.value = template ? template.name : "";
    form.elements.description.value = template ? (template.description || "") : "";
    if (template) template.fields.forEach(field => addTemplateField(field));
    else {
      addTemplateField({ label: "Category", type: "text", required: true });
      addTemplateField({ label: "Notes", type: "textarea", required: false });
    }
    $("#templateDialog").showModal();
    form.elements.name.focus();
  }

  function createFieldKey(label, used) {
    let key = String(label).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
      .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 30);
    if (!key || !/^[a-z]/.test(key)) key = "field_" + (key || "value");
    const base = key;
    let suffix = 2;
    while (used.has(key)) key = base.slice(0, 34) + "_" + suffix++;
    used.add(key);
    return key;
  }

  async function saveTemplate(event) {
    event.preventDefault();
    const form = $("#templateForm");
    const rows = $$("#templateFieldRows [data-field-row]");
    const used = new Set();
    const fields = rows.map(row => {
      const label = row.querySelector('[name="fieldLabel"]').value.trim();
      const previousKey = row.querySelector('[name="fieldKey"]').value.trim();
      const key = previousKey && !used.has(previousKey) ? (used.add(previousKey), previousKey) : createFieldKey(label, used);
      const type = row.querySelector('[name="fieldType"]').value;
      const field = { key, label, type, required: row.querySelector('[name="fieldRequired"]').checked };
      if (type === "select") field.options = row.querySelector('[name="fieldOptions"]').value.split(",").map(value => value.trim()).filter(Boolean);
      return field;
    });
    const existing = state.editingTemplateId ? findTemplate(state.editingTemplateId) : null;
    const template = {
      id: existing ? existing.id : makeId("tpl"),
      name: form.elements.name.value.trim(),
      description: form.elements.description.value.trim(),
      fields,
      isDefault: existing ? Boolean(existing.isDefault) : false,
      createdAt: existing ? existing.createdAt : new Date().toISOString()
    };
    const validation = Core.validateTemplate(template);
    if (!validation.valid) {
      $("#templateFormError").textContent = validation.errors.slice(0, 5).join(" ");
      return;
    }

    if (existing) {
      const oldFields = new Map(existing.fields.map(field => [field.key, field]));
      const newFields = new Map(fields.map(field => [field.key, field]));
      const linkedRecords = state.records.filter(record => record.templateId === existing.id);
      for (const oldField of existing.fields) {
        const replacement = newFields.get(oldField.key);
        const usedValues = linkedRecords.some(record => record.values && record.values[oldField.key] !== undefined && record.values[oldField.key] !== "");
        if (!replacement && usedValues) {
          $("#templateFormError").textContent = "Cannot remove a field that contains saved values. Keep the field or create a new template.";
          return;
        }
        if (replacement && replacement.type !== oldField.type && usedValues) {
          $("#templateFormError").textContent = "Cannot change the data type of a field that already contains saved values.";
          return;
        }
      }
    }

    try {
      await saveItem("templates", template);
      $("#templateDialog").close();
      await reloadData();
      render();
      showToast(existing ? "Template updated." : "Template created.");
    } catch (error) {
      $("#templateFormError").textContent = "The template could not be saved: " + error.message;
    }
  }

  async function deleteRecord(id) {
    const record = state.records.find(item => item.id === id);
    if (!record || !window.confirm('Delete the record "' + record.title + '"? This cannot be undone unless you have a backup.')) return;
    try {
      await deleteItem("records", id);
      await reloadData();
      render();
      showToast("Record deleted.");
    } catch (error) {
      showToast("Could not delete record: " + error.message, true);
    }
  }

  async function deleteTemplate(id) {
    const template = findTemplate(id);
    if (!template) return;
    const linked = state.records.filter(record => record.templateId === id).length;
    if (linked) {
      showToast("This template is used by " + linked + " record(s). Delete or move those records first.", true);
      return;
    }
    if (!window.confirm('Delete the template "' + template.name + '"?')) return;
    try {
      await deleteItem("templates", id);
      await reloadData();
      render();
      showToast("Template deleted.");
    } catch (error) {
      showToast("Could not delete template: " + error.message, true);
    }
  }

  function downloadFile(filename, content, type) {
    const blob = new Blob([content], { type: type || "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.hidden = true;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function dateStamp() {
    return todayISO().replace(/-/g, "");
  }

  function exportJSON() {
    const backup = Core.createBackup(state.records, state.templates);
    downloadFile("datalog-backup-" + dateStamp() + ".json", JSON.stringify(backup, null, 2), "application/json;charset=utf-8");
    showToast("JSON backup downloaded.");
  }

  function exportCSV(records) {
    const rows = records || state.records;
    downloadFile("datalog-records-" + dateStamp() + ".csv", Core.recordsToCSV(rows, state.templates), "text/csv;charset=utf-8");
    showToast(rows.length + " record(s) exported to CSV.");
  }

  function printReport(records, title) {
    const rows = records || state.records;
    const templateMap = new Map(state.templates.map(template => [template.id, template.name]));
    const bodyRows = rows.map(record => {
      const values = Object.entries(record.values || {}).map(([key, value]) => {
        const template = findTemplate(record.templateId);
        const field = template && template.fields.find(item => item.key === key);
        return (field ? field.label : key) + ": " + (typeof value === "boolean" ? (value ? "Yes" : "No") : String(value == null ? "" : value));
      }).join(" · ");
      return "<tr><td>" + escapeHTML(record.title) + "</td><td>" + escapeHTML(templateMap.get(record.templateId) || "Unknown") + "</td><td>" + escapeHTML(formatDate(record.occurredAt || record.createdAt)) + "</td><td>" + escapeHTML(values) + "</td></tr>";
    }).join("");
    $("#printReport").innerHTML = "<h1>" + escapeHTML(title || "DataLog records report") + "</h1>" +
      '<div class="print-meta">North Assembly · Generated ' + escapeHTML(new Date().toLocaleString()) + ' · ' + rows.length + ' record(s)</div>' +
      "<p>This report was generated from the records stored in the current browser profile.</p>" +
      "<table><thead><tr><th>Record</th><th>Template</th><th>Date</th><th>Values</th></tr></thead><tbody>" + bodyRows + "</tbody></table>" +
      '<p class="print-notes">Source: DataLog local workspace. Values are presented as stored; verify important conclusions against the source records.</p>';
    window.print();
  }

  async function importBackup(file) {
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) {
      showToast("Backup file exceeds the 25 MB import limit.", true);
      return;
    }
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const validation = Core.validateBackup(parsed);
      if (!validation.valid) {
        showToast("Backup rejected: " + validation.errors.slice(0, 2).join(" "), true);
        return;
      }
      const confirmed = window.confirm(
        "Restore this DataLog backup? This replaces all " + state.records.length +
        " current record(s) and " + state.templates.length + " template(s) in this browser."
      );
      if (!confirmed) return;
      await replaceDatabase(parsed.templates, parsed.records);
      await reloadData();
      render();
      showToast("Backup restored. " + state.records.length + " record(s) loaded.");
    } catch (error) {
      showToast("Could not read or restore the backup: " + error.message, true);
    } finally {
      const input = $("#backupFile");
      if (input) input.value = "";
    }
  }

  async function clearWorkspace() {
    if (!window.confirm("Permanently delete all DataLog records and templates stored in this browser? Export a backup first. This cannot be undone.")) return;
    try {
      await replaceDatabase(DEFAULT_TEMPLATES, []);
      await reloadData();
      state.filters = { query: "", templateId: "", from: "", to: "" };
      state.analysis = { templateId: "", fieldKey: "" };
      render();
      showToast("Local workspace cleared. Default templates restored.");
    } catch (error) {
      showToast("Could not clear local data: " + error.message, true);
    }
  }

  function handleAction(event) {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    const id = button.dataset.id;
    if (action === "new-record") openRecordDialog(null);
    else if (action === "edit-record") {
      const record = state.records.find(item => item.id === id);
      if (record) openRecordDialog(record);
    } else if (action === "delete-record") deleteRecord(id);
    else if (action === "new-template") openTemplateDialog(null);
    else if (action === "edit-template") {
      const template = findTemplate(id);
      if (template) openTemplateDialog(template);
    } else if (action === "delete-template") deleteTemplate(id);
    else if (action === "remove-field-row") button.closest("[data-field-row]").remove();
    else if (action === "go-records") navigate("records");
    else if (action === "clear-filters") {
      state.filters = { query: "", templateId: "", from: "", to: "" };
      renderRecords();
    } else if (action === "export-json") exportJSON();
    else if (action === "export-all-csv") exportCSV(state.records);
    else if (action === "export-filtered-csv") exportCSV(currentFilteredRecords());
    else if (action === "print-report") printReport(state.records, "DataLog records report");
    else if (action === "clear-data") clearWorkspace();
  }

  function bindEvents() {
    $$("[data-view]").forEach(button => button.addEventListener("click", () => navigate(button.dataset.view)));
    $("#addRecordTop").addEventListener("click", () => openRecordDialog(null));
    $("#viewRoot").addEventListener("click", handleAction);
    $("#recordForm").addEventListener("submit", saveRecord);
    $("#templateForm").addEventListener("submit", saveTemplate);
    $("#recordTemplate").addEventListener("change", event => renderRecordFields(event.target.value, {}));
    $("#addTemplateField").addEventListener("click", () => addTemplateField());
    document.addEventListener("click", event => {
      const close = event.target.closest("[data-close-dialog]");
      if (close) {
        const dialog = document.getElementById(close.dataset.closeDialog);
        if (dialog) dialog.close();
      }
    });
    $("#backupFile").addEventListener("change", event => importBackup(event.target.files && event.target.files[0]));

    $("#viewRoot").addEventListener("input", event => {
      if (event.target.id !== "recordSearch") return;
      state.filters.query = event.target.value;
      const cursor = event.target.selectionStart;
      renderRecords();
      const replacement = $("#recordSearch");
      replacement.focus();
      replacement.setSelectionRange(cursor, cursor);
    });
    $("#viewRoot").addEventListener("change", event => {
      if (event.target.id === "recordTemplateFilter") state.filters.templateId = event.target.value;
      else if (event.target.id === "recordFrom") state.filters.from = event.target.value;
      else if (event.target.id === "recordTo") state.filters.to = event.target.value;
      else if (event.target.id === "analysisTemplate") {
        state.analysis.templateId = event.target.value;
        state.analysis.fieldKey = "";
        renderAnalysis();
        return;
      } else if (event.target.id === "analysisField") state.analysis.fieldKey = event.target.value;
      else return;
      render();
    });

    [$("#recordDialog"), $("#templateDialog")].forEach(dialog => {
      dialog.addEventListener("click", event => {
        if (event.target === dialog) dialog.close();
      });
    });
  }

  async function boot() {
    if (!Core) throw new Error("DataLog core module did not load. Refresh the page and try again.");
    state.db = await openDatabase();
    await initialiseTemplates();
    await reloadData();
    bindEvents();
    render();
    if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
      navigator.serviceWorker.register("./sw.js").catch(error => console.warn("DataLog offline cache could not be registered:", error));
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    boot().catch(error => {
      console.error("DataLog failed to start:", error);
      setStorageStatus("Database unavailable", true);
      $("#viewRoot").innerHTML = '<section class="panel"><div class="empty-state"><span class="empty-icon" aria-hidden="true">!</span><h3>DataLog could not open its local database</h3><p>' + escapeHTML(error.message) + ' Records have not been changed. Try reloading the page in a current browser with site storage enabled.</p><button class="button button-secondary" type="button" id="retryBoot">Retry</button></div></section>';
      $("#retryBoot").addEventListener("click", () => location.reload());
    });
  });
})();