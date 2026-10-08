import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeRequest, buildPrompt, checkDraft, parseJson, RequestError, DraftError } from "../lib/draft.js";

const plan = {
  title: "Japan",
  days: [
    { date: "2026-10-29", label: "Matsusaka", events: [
      { start: "14:00", end: "15:00", title: "Castle ruins", place: "Matsusaka Castle", notes: "" },
      { start: "09:30", end: "", title: "Train to Matsusaka", place: "Iseshi Station", notes: "Cash only\nNo IC" },
    ]},
    { date: "2026-10-28", label: "Ise", events: [] },
    { date: "nope", events: [] },
  ],
};

test("prompt lists days and events in order with neighbours visible", () => {
  const prompt = buildPrompt(sanitizeRequest({ text: " lunch at Wadakin ", plan, today: "2026-10-08" }));
  assert.ok(prompt.indexOf("Day 1 | 2026-10-28 Wed | Ise") < prompt.indexOf("Day 2 | 2026-10-29 Thu | Matsusaka"));
  assert.ok(prompt.indexOf("09:30  Train to Matsusaka") < prompt.indexOf("14:00-15:00  Castle ruins @ Matsusaka Castle"));
  assert.match(prompt, /notes: Cash only \/ No IC/);
  assert.match(prompt, /<note>\nlunch at Wadakin\n<\/note>/);
  assert.doesNotMatch(prompt, /nope/);
});

test("follow-up answers are carried into the prompt", () => {
  const prompt = buildPrompt(sanitizeRequest({ text: "dinner", plan, followUps: [{ questions: ["Which day?"], answer: "the 29th" }, { questions: ["x"], answer: "" }] }));
  assert.match(prompt, /<you_asked>\n- Which day\?\n<\/you_asked>\n<traveller_answered>\nthe 29th/);
  assert.equal(prompt.match(/<you_asked>/g).length, 1);
});

test("empty text is rejected", () => {
  assert.throws(() => sanitizeRequest({ text: "  ", plan }), RequestError);
});

test("drafts are checked before they reach the page", () => {
  const lunch = { date: "2026-10-29", start: "12:00", end: "11:00", title: " Lunch ", place: "", notes: "" };
  const train = { date: "2026-10-29", start: "09:10", end: "09:20", title: "Train", place: "Iseshi Station", notes: "" };
  assert.deepEqual(checkDraft({ needs_more_info: false, reply: "ok", questions: [], events: [lunch, train] }).events, [
    train,
    { date: "2026-10-29", start: "12:00", end: "", title: "Lunch", place: "", notes: "" },
  ]);
  assert.throws(() => checkDraft({ needs_more_info: false, reply: "", questions: [], events: [train, { ...lunch, start: "noon" }] }), DraftError);
  assert.throws(() => checkDraft({ needs_more_info: false, reply: "", questions: [], events: [] }), DraftError);
  assert.throws(() => checkDraft({ needs_more_info: true, reply: "", questions: [" "], events: [] }), DraftError);
  assert.deepEqual(checkDraft({ needs_more_info: true, reply: "r", questions: ["Which day?"], events: [] }).questions, ["Which day?"]);
});

test("JSON is recovered from fenced or chatty replies and loose shapes are rejected", () => {
  assert.deepEqual(parseJson('Sure!\n```json\n{"a": 1}\n```'), { a: 1 });
  assert.throws(() => parseJson("no json here"), DraftError);
  assert.throws(() => checkDraft({ needs_more_info: false }), DraftError);
  assert.throws(() => checkDraft(null), DraftError);
});
