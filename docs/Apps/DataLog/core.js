(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.DataLogCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const FORMAT = "north-assembly-datalog";
  const VERSION = 1;
  const FIELD_TYPES = new Set(["text", "textarea", "number", "date", "select", "checkbox"]);
  const MAX_RECORDS = 100000;
  const MAX_TEMPLATES = 500;

  function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function cleanText(value, maxLength) {
    return String(value == null ? "" : value).trim().slice(0, maxLength || 1000);
  }

  function validateTemplate(input) {
    const errors = [];
    if (!isObject(input)) return { valid: false, errors: ["Template must be an object."] };

    const name = cleanText(input.name, 80);
    if (!name) errors.push("Template name is required.");
    const fields = Array.isArray(input.fields) ? input.fields : [];
    if (fields.length < 1 || fields.length > 20) errors.push("A template must contain between 1 and 20 fields.");

    const seen = new Set();
    fields.forEach((field, index) => {
      if (!isObject(field)) {
        errors.push("Field " + (index + 1) + " is invalid.");
        return;
      }
      const key = cleanText(field.key, 40);
      const label = cleanText(field.label, 60);
      const type = cleanText(field.type, 20);
      if (!/^[a-z][a-z0-9_]{0,39}$/.test(key)) errors.push("Field " + (index + 1) + " has an invalid key.");
      if (seen.has(key)) errors.push("Field keys must be unique: " + key + ".");
      seen.add(key);
      if (!label) errors.push("Field " + (index + 1) + " needs a label.");
      if (!FIELD_TYPES.has(type)) errors.push("Field " + (index + 1) + " has an unsupported type.");
      if (type === "select") {
        const options = Array.isArray(field.options) ? field.options.map(v => cleanText(v, 80)).filter(Boolean) : [];
        if (options.length < 1 || options.length > 30) errors.push("Select field " + label + " needs between 1 and 30 options.");
      }
    });

    return { valid: errors.length === 0, errors };
  }

  function validateRecord(input, templates) {
    const errors = [];
    if (!isObject(input)) return { valid: false, errors: ["Record must be an object."] };

    const title = cleanText(input.title, 160);
    if (!title) errors.push("A record title is required.");
    if (title.length > 160) errors.push("Record title is too long.");

    const template = (templates || []).find(item => item.id === input.templateId);
    if (!template) errors.push("The selected template does not exist.");

    const values = isObject(input.values) ? input.values : {};
    if (template) {
      template.fields.forEach(field => {
        const value = values[field.key];
        const empty = value === undefined || value === null || value === "";
        if (field.required && (empty || (typeof value === "string" && !value.trim()))) {
          errors.push(field.label + " is required.");
          return;
        }
        if (empty) return;
        if (field.type === "number" && (!Number.isFinite(Number(value)) || String(value).trim() === "")) {
          errors.push(field.label + " must be a valid number.");
        }
        if (field.type === "date" && Number.isNaN(Date.parse(String(value)))) {
          errors.push(field.label + " must be a valid date.");
        }
        if (field.type === "select" && !(field.options || []).includes(value)) {
          errors.push(field.label + " contains an unsupported option.");
        }
        if (field.type === "checkbox" && typeof value !== "boolean") {
          errors.push(field.label + " must be true or false.");
        }
        if (typeof value === "string" && value.length > 10000) errors.push(field.label + " is too long.");
      });
    }

    const createdAt = Date.parse(input.createdAt);
    const updatedAt = Date.parse(input.updatedAt);
    if (!Number.isFinite(createdAt)) errors.push("Record creation date is invalid.");
    if (!Number.isFinite(updatedAt)) errors.push("Record modification date is invalid.");

    return { valid: errors.length === 0, errors };
  }

  function filterRecords(records, filters, templates) {
    const options = filters || {};
    const query = cleanText(options.query, 200).toLocaleLowerCase();
    const templateId = options.templateId || "";
    const from = options.from ? Date.parse(options.from + "T00:00:00") : NaN;
    const to = options.to ? Date.parse(options.to + "T23:59:59.999") : NaN;
    const templateMap = new Map((templates || []).map(item => [item.id, item.name]));

    return (records || []).filter(record => {
      if (templateId && record.templateId !== templateId) return false;
      const stamp = Date.parse(record.occurredAt || record.createdAt);
      if (Number.isFinite(from) && (!Number.isFinite(stamp) || stamp < from)) return false;
      if (Number.isFinite(to) && (!Number.isFinite(stamp) || stamp > to)) return false;
      if (!query) return true;
      const haystack = [
        record.title,
        templateMap.get(record.templateId) || "",
        ...Object.values(record.values || {}).map(value => typeof value === "boolean" ? String(value) : String(value == null ? "" : value))
      ].join(" ").toLocaleLowerCase();
      return haystack.includes(query);
    }).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  }

  function numericSummary(records, templateId, fieldKey) {
    const values = (records || [])
      .filter(record => record.templateId === templateId)
      .map(record => record.values && record.values[fieldKey])
      .filter(value => value !== "" && value !== null && value !== undefined)
      .map(Number)
      .filter(Number.isFinite);

    if (!values.length) return { count: 0, sum: 0, average: null, min: null, max: null };
    const sum = values.reduce((total, value) => total + value, 0);
    return {
      count: values.length,
      sum,
      average: sum / values.length,
      min: Math.min.apply(null, values),
      max: Math.max.apply(null, values)
    };
  }

  function summarize(records, templates) {
    const rows = records || [];
    const byTemplate = (templates || []).map(template => ({
      id: template.id,
      name: template.name,
      count: rows.filter(record => record.templateId === template.id).length
    }));
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recent = rows.filter(record => Date.parse(record.occurredAt || record.createdAt) >= cutoff).length;
    return { total: rows.length, recent, templates: byTemplate.length, byTemplate };
  }

  function csvEscape(value) {
    const text = value === null || value === undefined ? "" : String(value);
    return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  }

  function recordsToCSV(records, templates) {
    const templateMap = new Map((templates || []).map(item => [item.id, item.name]));
    const keys = Array.from(new Set((records || []).flatMap(record => Object.keys(record.values || {})))).sort();
    const headers = ["id", "title", "template", "occurredAt", "createdAt", "updatedAt"].concat(keys);
    const lines = [headers.map(csvEscape).join(",")];
    (records || []).forEach(record => {
      const row = [
        record.id,
        record.title,
        templateMap.get(record.templateId) || record.templateId,
        record.occurredAt || "",
        record.createdAt || "",
        record.updatedAt || ""
      ].concat(keys.map(key => {
        const value = record.values ? record.values[key] : "";
        return typeof value === "object" && value !== null ? JSON.stringify(value) : value;
      }));
      lines.push(row.map(csvEscape).join(","));
    });
    return "\uFEFF" + lines.join("\r\n");
  }

  function createBackup(records, templates, now) {
    return {
      format: FORMAT,
      version: VERSION,
      exportedAt: (now || new Date()).toISOString(),
      templates: templates || [],
      records: records || []
    };
  }

  function validateBackup(input) {
    const errors = [];
    if (!isObject(input)) return { valid: false, errors: ["Backup must be a JSON object."] };
    if (input.format !== FORMAT) errors.push("This file is not a DataLog backup.");
    if (input.version !== VERSION) errors.push("Unsupported backup version.");
    if (!Array.isArray(input.templates) || input.templates.length > MAX_TEMPLATES) errors.push("Template list is invalid or exceeds the limit.");
    if (!Array.isArray(input.records) || input.records.length > MAX_RECORDS) errors.push("Record list is invalid or exceeds the limit.");
    if (errors.length) return { valid: false, errors };

    const templateIds = new Set();
    input.templates.forEach(template => {
      const result = validateTemplate(template);
      if (!result.valid) errors.push.apply(errors, result.errors.map(message => "Template " + (template && template.name || "") + ": " + message));
      if (!template || typeof template.id !== "string" || !template.id || templateIds.has(template.id)) errors.push("Template identifiers must be present and unique.");
      if (template && template.id) templateIds.add(template.id);
    });

    const recordIds = new Set();
    input.records.forEach(record => {
      const result = validateRecord(record, input.templates);
      if (!result.valid) errors.push.apply(errors, result.errors.map(message => "Record " + (record && record.title || "") + ": " + message));
      if (!record || typeof record.id !== "string" || !record.id || recordIds.has(record.id)) errors.push("Record identifiers must be present and unique.");
      if (record && record.id) recordIds.add(record.id);
    });

    return { valid: errors.length === 0, errors };
  }

  return {
    FORMAT,
    VERSION,
    FIELD_TYPES: Array.from(FIELD_TYPES),
    validateTemplate,
    validateRecord,
    filterRecords,
    numericSummary,
    summarize,
    recordsToCSV,
    createBackup,
    validateBackup
  };
});