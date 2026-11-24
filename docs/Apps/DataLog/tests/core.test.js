"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../core.js");

const templates = [{
  id: "tpl-observation",
  name: "Observation",
  fields: [
    { key: "category", label: "Category", type: "text", required: true },
    { key: "temperature", label: "Temperature", type: "number", required: false },
    { key: "status", label: "Status", type: "select", required: true, options: ["Open", "Closed"] }
  ]
}];

function record(id, title, values, overrides) {
  const now = "2026-11-24T12:00:00.000Z";
  return Object.assign({
    id,
    title,
    templateId: "tpl-observation",
    occurredAt: "2026-11-24",
    createdAt: now,
    updatedAt: now,
    values
  }, overrides || {});
}

test("accepts a valid template and rejects duplicate field keys", () => {
  assert.equal(core.validateTemplate(templates[0]).valid, true);
  const invalid = Object.assign({}, templates[0], {
    fields: [
      { key: "same", label: "First", type: "text" },
      { key: "same", label: "Second", type: "number" }
    ]
  });
  assert.equal(core.validateTemplate(invalid).valid, false);
});

test("rejects unsupported field types and empty templates", () => {
  assert.equal(core.validateTemplate({ name: "Bad", fields: [] }).valid, false);
  assert.equal(core.validateTemplate({
    name: "Bad type",
    fields: [{ key: "field", label: "Field", type: "html" }]
  }).valid, false);
});

test("validates required fields, numeric values and select options", () => {
  const valid = record("r1", "Room reading", { category: "Room", temperature: 21.5, status: "Open" });
  assert.equal(core.validateRecord(valid, templates).valid, true);

  const invalid = record("r2", "Room reading", { category: "", temperature: "hot", status: "Unknown" });
  const result = core.validateRecord(invalid, templates);
  assert.equal(result.valid, false);
  assert.ok(result.errors.length >= 3);
});

test("filters by text, template and date range without mutating source", () => {
  const rows = [
    record("a", "North room", { category: "North", temperature: 19, status: "Open" }),
    record("b", "South room", { category: "South", temperature: 24, status: "Closed" }, { occurredAt: "2026-11-20" })
  ];
  const found = core.filterRecords(rows, { query: "north" }, templates);
  assert.deepEqual(found.map(item => item.id), ["a"]);
  assert.equal(core.filterRecords(rows, { from: "2026-11-22" }, templates).length, 1);
  assert.equal(rows.length, 2);
});

test("computes numeric aggregates and handles an empty selection", () => {
  const rows = [
    record("a", "One", { category: "A", temperature: 10, status: "Open" }),
    record("b", "Two", { category: "B", temperature: 20, status: "Closed" }),
    record("c", "Three", { category: "C", temperature: "", status: "Open" })
  ];
  assert.deepEqual(core.numericSummary(rows, "tpl-observation", "temperature"), {
    count: 2, sum: 30, average: 15, min: 10, max: 20
  });
  assert.equal(core.numericSummary([], "tpl-observation", "temperature").average, null);
});

test("exports CSV with correct escaping for commas, quotes and line breaks", () => {
  const csv = core.recordsToCSV([
    record("a", 'Reading, "A"', { category: "line one\nline two", temperature: 5, status: "Open" })
  ], templates);
  assert.match(csv, /"Reading, ""A"""/);
  assert.match(csv, /"line one\nline two"/);
  assert.ok(csv.startsWith("\uFEFF"));
});

test("validates a full backup and rejects broken references and duplicate ids", () => {
  const good = core.createBackup([
    record("a", "Reading", { category: "Lab", temperature: 22, status: "Open" })
  ], templates, new Date("2026-11-24T12:00:00.000Z"));
  assert.equal(core.validateBackup(good).valid, true);

  const broken = core.createBackup([
    record("a", "Reading", { category: "", temperature: "NaN", status: "Bad" }),
    record("a", "Duplicate", { category: "Lab", temperature: 20, status: "Open" })
  ], templates);
  assert.equal(core.validateBackup(broken).valid, false);
});

test("summarizes total and template counts", () => {
  const rows = [
    record("a", "First", { category: "Lab", temperature: 20, status: "Open" }),
    record("b", "Second", { category: "Lab", temperature: 21, status: "Open" })
  ];
  const summary = core.summarize(rows, templates);
  assert.equal(summary.total, 2);
  assert.equal(summary.templates, 1);
  assert.equal(summary.byTemplate[0].count, 2);
});