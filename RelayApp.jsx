import React, { useState, useEffect } from "react";

/* =========================================================================
   RELAY — capacity & delivery tracker (core-loop prototype)
   Mobile-first. In-memory only (demo). Modelled on the anonymised sheet.

   TIME: real Dubai clock drives everything (workday 08:00; after 19:00 only
   evening-coverage volunteers are online; US pool wakes at 15:00, APAC sleeps
   at 15:00). A demo slider lets you preview other times when presenting.
   POOL sets the goal's WEIGHT by time of day (not who's eligible).
   EVENING COVERAGE = after-hours availability (opt-in yes/no).
   N = calls the client wants.  GOAL = profiles to source ( N × multiplier ).
   NOTES: public = everyone on the project; private = author only.
   ========================================================================= */

/* ------- tunable business constants (swap in your real numbers) ------- */
const SMALL_CALLS = 2;
const MULT_SMALL = 3;              // small projects: 2 calls -> 6 profiles
const MULT_LARGE = 2;              // larger projects: 2 calls -> 4 profiles
const STAFF_PER_CALLS = 2;         // 1 deliverer per 2 calls on larger projects
const STAGE_WEIGHT = { "First Deliverable": 2, "Second Deliverable": 1, "Hail Mary": 0.5, "Selling": 0 };
const ORDER = ["First Deliverable", "Second Deliverable", "Hail Mary", "Selling"];

function suggestGoal(calls) { return Math.round(calls * (calls <= SMALL_CALLS ? MULT_SMALL : MULT_LARGE)); }
function suggestStaff(calls) { return calls <= SMALL_CALLS ? 1 : Math.ceil(calls / STAFF_PER_CALLS); }
function multFor(calls) { return calls <= SMALL_CALLS ? MULT_SMALL : MULT_LARGE; }

/* ------------------------------ time model ------------------------------ */
function realDubaiHour() {
  const d = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Dubai" }));
  return d.getHours() + d.getMinutes() / 60;
}
function afterHours(hour) { return hour >= 19 || hour < 8; }
function dubaiNow() { return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Dubai" })); }
function isSunday() { return dubaiNow().getDay() === 0; }
function ymd(d) { return d.toISOString().slice(0, 10); }
function todayKey() { return ymd(dubaiNow()); }
/* next N Sundays from today, as yyyy-mm-dd */
function upcomingSundays(n) {
  const out = [], d = dubaiNow();
  d.setDate(d.getDate() + ((7 - d.getDay()) % 7));      // this/next Sunday
  for (let i = 0; i < n; i++) { out.push(ymd(d)); d.setDate(d.getDate() + 7); }
  return out;
}
function prettySunday(key) {
  const d = new Date(key + "T00:00:00");
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
const AVAILABLE = "Available";
function poolWeight(pool, hour) {
  if (pool === "Global" || pool === "EU & MEA & India") return 1;
  if (pool === "AUS / NZ / Sing / JP") return hour < 15 ? 2 : 0;
  if (pool === "US only") return hour >= 15 ? 2 : 0;
  return 1;
}
/* Four independent availability rules — do not fuse them:
   1. status       — Sick / On vacation / Offline: never eligible, never ranked.
   2. sunday rota  — a SCHEDULE set in advance by managers. On a Sunday, only the
                     people rostered for THAT DATE are eligible. Not a preference.
   3. evening      — VOLUNTARY, self-serve live toggle. After 19:00 only people
                     currently toggled on are eligible. They can flip it off anytime.
   4. pool weight  — separate concept; affects goal WEIGHT, not eligibility.     */
function isEligible(person, hour, onRotaToday) {
  if (!person) return false;
  if (person.status !== AVAILABLE) return false;                    // 1 status
  if (onRotaToday !== null && !onRotaToday.has(person.id)) return false; // 2 sunday rota
  if (afterHours(hour) && !person.eveningCoverage) return false;    // 3 evening (voluntary)
  return true;
}
function unavailable(person) { return person.status !== AVAILABLE; }

/* ------------------------------ load / rank ------------------------------ */
function personLoad(person, projects, hour) {
  let load = 0;
  projects.forEach(p => p.assignments.forEach(a => {
    if (a.deliverer !== person.id) return;
    const remaining = Math.max(a.goal - (a.delivered + a.customDelivered), 0);   // custom counts toward the goal
    load += remaining * (STAGE_WEIGHT[p.stage] || 0) * poolWeight(p.timezone, hour);
  }));
  return load;
}
function remainingN(person, projects) {
  let rem = 0;
  projects.forEach(p => p.assignments.forEach(a => {
    if (a.deliverer !== person.id) return;
    rem += Math.max(a.goal - (a.delivered + a.customDelivered), 0);   // custom counts toward the goal
  }));
  return rem;
}
function median(nums) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b), m = Math.floor((s.length - 1) / 2);
  return s.length % 2 ? s[m] : (s[m] + s[m + 1]) / 2;
}
function rankCandidates(peopleIn, projects, hour, plPractice, onRotaToday) {
  const people = peopleIn.filter(p => !unavailable(p));   // sick / vacation / offline are never ranked
  const med = median(people.map(p => remainingN(p, projects)));
  return people.map(p => {
    const rem = remainingN(p, projects), free = rem <= med;
    return { person: p, eligible: isEligible(p, hour, onRotaToday), load: personLoad(p, projects, hour), rem, free, practiceBoost: !!plPractice && p.practice === plPractice && free };
  }).sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    if (a.practiceBoost !== b.practiceBoost) return a.practiceBoost ? -1 : 1;
    return a.load - b.load;
  });
}

/* ------------------------------- seed data ------------------------------- */
const POOLS = ["Global", "EU & MEA & India", "AUS / NZ / Sing / JP", "US only"];
const TYPES = ["Pitch", "Due Diligence", "Strategy"];
const STATUSES = ["Available", "On vacation", "Sick", "Offline"];
const PEOPLE = [
  { id: "lead30", name: "Lead_User_30", practice: "Tech", team: "Team_Alpha", manager: true, status: "Available", eveningCoverage: true },
  { id: "zeta", name: "Resource_Zeta", practice: "Tech", team: "Team_Alpha", manager: false, status: "Available", eveningCoverage: true },
  { id: "epsilon", name: "Resource_Epsilon", practice: "Tech", team: "Team_Alpha", manager: false, status: "Available", eveningCoverage: false },
  { id: "theta", name: "Resource_Theta", practice: "PIPE", team: "Team_Alpha", manager: false, status: "On vacation", eveningCoverage: false },
  { id: "kappa", name: "Resource_Kappa", practice: "Energy", team: "Team_Beta", manager: true, status: "Available", eveningCoverage: true },
  { id: "gamma", name: "Resource_Gamma", practice: "PIPE", team: "Team_Beta", manager: false, status: "Available", eveningCoverage: true },
  { id: "lambda", name: "Resource_Lambda", practice: "COG", team: "Team_Beta", manager: false, status: "Sick", eveningCoverage: false },
];
const teamOf = id => (PEOPLE.find(p => p.id === id) || {}).team || "";
const isManager = id => !!(PEOPLE.find(p => p.id === id) || {}).manager;
const initials = n => n.replace("Resource_", "").replace("Lead_User_", "L").slice(0, 2).toUpperCase();
const nameOf = id => (PEOPLE.find(p => p.id === id) || {}).name || id;
const practiceOf = id => (PEOPLE.find(p => p.id === id) || {}).practice || "";

let SEQ = 100;
const T = Date.now();
const SEED_PROJECTS = [
  { id: "p1", pl: "lead30", client: "BCG", account: "Growth", topic: "EV charging infra", type: "Pitch",
    timezone: "EU & MEA & India", calls: 6, goalTotal: 18, stage: "First Deliverable", stageEnteredAt: T - 22 * 60000,
    sold: 4, marketShare: 0.4, status: "matched", archived: false, link: "", noteList: [],
    assignments: [
      { id: "a1", deliverer: "epsilon", goal: 9, delivered: 3, customGoal: 0, customDelivered: 0 },
      { id: "a2", deliverer: "theta", goal: 9, delivered: 6, customGoal: 0, customDelivered: 0 },
    ] },
  { id: "p2", pl: "lead30", client: "McKinsey", account: "PE", topic: "Semiconductor supply", type: "Due Diligence",
    timezone: "US only", calls: 8, goalTotal: 52, stage: "Second Deliverable", stageEnteredAt: T - 3 * 3600000,
    sold: 6, marketShare: 0.5, status: "matched", archived: false, link: "",
    noteList: [{ id: "n1", author: "lead30", role: "PL", text: "Client chasing more US East experts — prioritise zeta.", public: true, ts: T - 40 * 60000 }],
    assignments: [
      { id: "a3", deliverer: "zeta", goal: 26, delivered: 20, customGoal: 4, customDelivered: 2 },
      { id: "a4", deliverer: "kappa", goal: 26, delivered: 25, customGoal: 0, customDelivered: 0 },
    ] },
  { id: "p3", pl: "kappa", client: "Bain", account: "Tech", topic: "Cloud migration", type: "Strategy",
    timezone: "Global", calls: 5, goalTotal: 20, stage: "First Deliverable", stageEnteredAt: T - 47 * 60000,
    sold: 0, marketShare: 0, status: "matched", archived: false, link: "", noteList: [],
    assignments: [{ id: "a5", deliverer: "epsilon", goal: 20, delivered: 2, customGoal: 0, customDelivered: 0 }] },
];

function fmtElapsed(ms) { const m = Math.max(0, Math.floor(ms / 60000)); return m < 60 ? m + "m" : Math.floor(m / 60) + "h " + String(m % 60).padStart(2, "0") + "m"; }
function timerClass(ms) { const m = ms / 60000; return m < 30 ? "t-green" : m < 60 ? "t-amber" : "t-red"; }

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap');
* { box-sizing:border-box; -webkit-tap-highlight-color:transparent; }
.relay { --bg:#EDEFF3; --surface:#FFF; --ink:#141922; --soft:#586070; --line:#E3E7EE;
  --pl:#3B41C9; --pl-soft:#ECEDFB; --dl:#0E8C7F; --dl-soft:#E3F4F1;
  --green:#2C9E63; --amber:#C77D12; --red:#D14343; --green-bg:#E5F4EC; --amber-bg:#FBF0DE; --red-bg:#FBE7E7;
  font-family:'Inter',system-ui,sans-serif; color:var(--ink); background:var(--bg); min-height:100vh; width:100%;
  max-width:480px; margin:0 auto; position:relative; padding-bottom:96px; }
.mono { font-family:'Space Grotesk',monospace; font-feature-settings:"tnum"; }
.relay button { font-family:inherit; cursor:pointer; border:none; background:none; color:var(--ink); }
.relay button:focus-visible { outline:2px solid var(--pl); outline-offset:2px; }
.relay button:disabled { cursor:not-allowed; }
.hdr { position:sticky; top:0; z-index:20; background:var(--surface); border-bottom:1px solid var(--line); }
.hdr-top { display:flex; align-items:center; justify-content:space-between; padding:12px 16px 10px; }
.brand { display:flex; align-items:baseline; gap:8px; }
.brand h1 { font-family:'Space Grotesk'; font-size:20px; font-weight:700; letter-spacing:-.5px; margin:0; color:var(--ink); }
.brand span { font-size:11px; color:var(--soft); font-weight:500; }
.persona { display:flex; align-items:center; gap:6px; background:var(--bg); border:1px solid var(--line); border-radius:999px; padding:5px 10px; font-size:12px; font-weight:600; color:var(--ink); }
.persona select { border:none; background:none; font:inherit; font-weight:600; color:var(--ink); outline:none; }
.controls { padding:0 16px 8px; }
.seg { display:flex; background:var(--bg); border-radius:10px; padding:3px; }
.seg button { flex:1; padding:8px 2px; font-size:12px; font-weight:600; border-radius:8px; color:var(--soft); transition:all .15s; display:flex; align-items:center; justify-content:center; gap:3px; white-space:nowrap; }
.seg button.on-pl { background:var(--surface); color:var(--pl); box-shadow:0 1px 3px rgba(0,0,0,.1); }
.seg button.on-dl { background:var(--surface); color:var(--dl); box-shadow:0 1px 3px rgba(0,0,0,.1); }
.seg button.on-rk { background:var(--surface); color:var(--ink); box-shadow:0 1px 3px rgba(0,0,0,.1); }
.seg button.on-fd { background:var(--surface); color:#A82F2F; box-shadow:0 1px 3px rgba(0,0,0,.1); }
.timebar { display:flex; align-items:center; gap:8px; padding:0 16px 11px; }
.clock-time { font-family:'Space Grotesk'; font-weight:700; font-size:12px; color:var(--ink); white-space:nowrap; }
.time-cap { font-size:11px; color:var(--soft); font-weight:500; line-height:1.3; padding-left:8px; border-left:1px solid var(--line); }
.scope { display:flex; background:var(--bg); border-radius:9px; padding:3px; margin-top:8px; }
.scope button { flex:1; padding:6px 0; font-size:12px; font-weight:700; border-radius:7px; color:var(--soft); }
.scope button.on { background:var(--surface); color:var(--ink); box-shadow:0 1px 3px rgba(0,0,0,.1); }
.scope-note { font-size:11px; font-weight:600; color:var(--soft); background:var(--bg); border-radius:8px; padding:7px 10px; margin-bottom:12px; }
.foot-note { font-size:11px; color:var(--soft); text-align:center; padding:14px 16px 4px; line-height:1.5; }
.body { padding:14px 16px 0; }
.mode-strip { height:3px; border-radius:3px; margin-bottom:14px; }
.mode-strip.pl { background:var(--pl); } .mode-strip.dl { background:var(--dl); } .mode-strip.rk { background:var(--ink); }
.section-lbl { font-size:11px; font-weight:700; letter-spacing:.6px; text-transform:uppercase; color:var(--soft); margin:2px 0 10px; display:flex; align-items:center; gap:8px; }
.section-lbl.spaced { margin-top:22px; }
.section-lbl .count { background:var(--line); color:var(--ink); border-radius:999px; padding:1px 8px; font-size:11px; }
.card { background:var(--surface); border:1px solid var(--line); border-radius:16px; padding:14px; margin-bottom:12px; box-shadow:0 1px 2px rgba(20,26,34,.04); }
.card-top { display:flex; justify-content:space-between; align-items:flex-start; gap:10px; }
.client { font-family:'Space Grotesk'; font-weight:700; font-size:16px; letter-spacing:-.3px; color:var(--ink); }
.topic { font-size:13px; color:var(--soft); margin-top:1px; }
.tag { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.4px; padding:3px 8px; border-radius:6px; white-space:nowrap; }
.tag.pitch { background:var(--pl-soft); color:var(--pl); } .tag.dd { background:#F3E8FB; color:#8E3BC9; } .tag.strategy { background:#E7F0FB; color:#2C6FC9; }
.meta { display:flex; flex-wrap:wrap; gap:6px; margin-top:10px; }
.chip { font-size:11px; font-weight:600; color:var(--soft); background:var(--bg); border-radius:7px; padding:4px 8px; }
.chip b { color:var(--ink); font-weight:700; }
.chip.timer { font-family:'Space Grotesk'; display:inline-flex; align-items:center; gap:5px; }
.chip.t-green { background:var(--green-bg); color:#1F7D4C; } .chip.t-amber { background:var(--amber-bg); color:#9A5F0C; } .chip.t-red { background:var(--red-bg); color:#A82F2F; }
.chip.live { background:var(--amber-bg); color:#9A5F0C; } .chip.dormant { background:var(--bg); color:var(--soft); }
.progress { margin-top:12px; }
.progress-top { display:flex; justify-content:space-between; align-items:baseline; margin-bottom:5px; }
.progress-num { font-family:'Space Grotesk'; font-weight:700; font-size:15px; color:var(--ink); } .progress-num small { color:var(--soft); font-weight:600; font-size:12px; }
.bar { height:7px; background:var(--bg); border-radius:5px; overflow:hidden; } .bar span { display:block; height:100%; border-radius:5px; transition:width .4s ease; }
.stage-row { display:flex; align-items:center; gap:6px; margin-top:12px; flex-wrap:wrap; }
.stage-pill { font-size:11px; font-weight:700; padding:4px 9px; border-radius:7px; }
.stage-first { background:var(--green-bg); color:#1F7D4C; } .stage-second { background:var(--amber-bg); color:#9A5F0C; } .stage-hail { background:var(--red-bg); color:#A82F2F; } .stage-selling { background:var(--pl-soft); color:var(--pl); }
.pace { margin-left:auto; font-size:11px; font-weight:700; font-family:'Space Grotesk'; display:flex; align-items:center; gap:5px; }
.dot { width:7px; height:7px; border-radius:50%; }
.assignees { margin-top:12px; padding-top:12px; border-top:1px dashed var(--line); }
.assignee { display:flex; align-items:center; gap:9px; padding:7px 0; }
.avatar { width:28px; height:28px; border-radius:8px; background:var(--pl-soft); color:var(--pl); font-family:'Space Grotesk'; font-weight:700; font-size:12px; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
.avatar.dl { background:var(--dl-soft); color:var(--dl); }
.assignee-name { font-size:13px; font-weight:600; color:var(--ink); } .assignee-sub { font-size:11px; color:var(--soft); }
.assignee-num { margin-left:auto; font-family:'Space Grotesk'; font-weight:700; font-size:13px; text-align:right; color:var(--ink); }
.actions { display:flex; gap:8px; margin-top:12px; }
.btn { flex:1; padding:10px; border-radius:10px; font-size:13px; font-weight:700; text-align:center; }
.btn-ghost { background:var(--bg); color:var(--ink); } .btn-pl { background:var(--pl); color:#fff; } .btn-dl { background:var(--dl); color:#fff; }
.btn-sm { padding:7px 12px; font-size:12px; font-weight:700; border-radius:8px; }
.step { display:flex; align-items:center; gap:10px; }
.step button { width:30px; height:30px; border-radius:8px; background:var(--bg); font-weight:800; font-size:16px; color:var(--ink); display:flex; align-items:center; justify-content:center; }
.step .val { font-family:'Space Grotesk'; font-weight:700; font-size:16px; min-width:30px; text-align:center; color:var(--ink); }
.badge { background:var(--red); color:#fff; font-size:10px; font-weight:800; border-radius:999px; padding:1px 6px; margin-left:2px; }
.review-strip { background:var(--amber-bg); border:1px solid #F0DCB0; border-radius:12px; padding:10px 12px; margin-bottom:12px; font-size:12px; color:#7A520E; display:flex; align-items:center; gap:8px; }
.empty { text-align:center; color:var(--soft); font-size:13px; padding:40px 20px; } .empty b { color:var(--ink); display:block; font-size:14px; margin-bottom:4px; }
.rank-row { display:flex; align-items:center; gap:11px; background:var(--surface); border:1px solid var(--line); border-radius:13px; padding:11px 13px; margin-bottom:8px; }
.rank-num { font-family:'Space Grotesk'; font-weight:700; font-size:15px; color:var(--soft); width:22px; text-align:center; }
.rank-row.top .rank-num { color:var(--dl); }
.rank-body { flex:1; min-width:0; } .rank-name { font-size:14px; font-weight:600; color:var(--ink); }
.rank-sub { font-size:11px; color:var(--soft); margin-top:1px; display:flex; gap:6px; flex-wrap:wrap; align-items:center; }
.mini { font-size:10px; font-weight:700; padding:2px 6px; border-radius:5px; }
.mini.free { background:var(--green-bg); color:#1F7D4C; } .mini.busy { background:var(--line); color:#4A5462; }
.mini.off { background:var(--red-bg); color:#A82F2F; } .mini.prac { background:var(--pl-soft); color:var(--pl); }
.mini.team { background:var(--dl-soft); color:var(--dl); }
.profile-btn { width:32px; height:32px; border-radius:10px; background:var(--pl); color:#fff; font-family:'Space Grotesk'; font-weight:700; font-size:12px; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
.sunday-strip { background:#EEF3FD; border:1px solid #CFE0F7; border-radius:12px; padding:10px 12px; margin-bottom:12px; font-size:12px; color:#1F4E85; line-height:1.4; }
.sunday-strip b { font-weight:700; }
.member { border:1px solid var(--line); border-radius:14px; padding:12px; margin-bottom:10px; }
.member-top { display:flex; align-items:center; gap:9px; }
.status-pick { display:flex; gap:5px; margin-top:10px; flex-wrap:wrap; }
.status-pick button { flex:1; min-width:66px; padding:7px 3px; font-size:11px; font-weight:700; border-radius:8px; background:var(--bg); color:var(--soft); border:1px solid var(--line); }
.status-pick button.sel { background:var(--ink); color:#fff; border-color:var(--ink); }
.warn-line { font-size:11px; color:#A82F2F; background:var(--red-bg); border-radius:8px; padding:7px 9px; margin-top:8px; line-height:1.4; }
.cov-row { display:flex; align-items:center; justify-content:space-between; margin-top:9px; }
.cov-lbl { font-size:12px; font-weight:600; color:var(--ink); } .cov-lbl small { color:var(--soft); font-weight:500; }
.remove-btn { width:100%; margin-top:10px; padding:7px; font-size:11px; font-weight:700; color:#A82F2F; background:var(--red-bg); border-radius:8px; }
.add-row { display:flex; gap:8px; margin-top:6px; }
.add-row input { flex:1; padding:10px 12px; border:1px solid var(--line); border-radius:11px; font:inherit; font-size:14px; background:var(--bg); color:var(--ink); outline:none; }
.mini.vac { background:#EEF3FD; color:#1F4E85; }
.cov-card { background:var(--surface); border:1px solid var(--line); border-radius:16px; padding:4px 14px; margin-bottom:14px; }
.cov-item { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:12px 0; }
.cov-item + .cov-item { border-top:1px dashed var(--line); }
.cov-title { font-size:13px; font-weight:700; color:var(--ink); }
.cov-state { font-size:11px; margin-top:2px; line-height:1.35; }
.cov-state.on { color:#1F7D4C; } .cov-state.off { color:var(--soft); }
.cov-readonly { display:flex; align-items:center; gap:6px; margin-top:10px; flex-wrap:wrap; }
.cov-hint { font-size:10px; color:var(--soft); font-weight:600; }
.eve-btn { width:32px; height:32px; border-radius:10px; background:var(--bg); border:1px solid var(--line); font-size:15px; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
.eve-btn.on { background:#2B2F52; border-color:#2B2F52; }
.cov-tagline { font-size:10px; font-weight:600; color:var(--soft); background:var(--bg); padding:2px 6px; border-radius:5px; margin-left:4px; }
.link-btn { font-size:11px; font-weight:700; color:#1F4E85; text-decoration:underline; margin-left:6px; }
.rota-dates { display:flex; gap:7px; overflow-x:auto; padding-bottom:6px; margin-bottom:6px; }
.rota-date { flex-shrink:0; padding:9px 12px; border-radius:11px; border:1px solid var(--line); background:var(--bg); text-align:center; min-width:74px; }
.rota-date b { display:block; font-family:'Space Grotesk'; font-size:13px; font-weight:700; color:var(--ink); }
.rota-date small { display:block; font-size:10px; color:var(--soft); margin-top:2px; }
.rota-date.sel { border-color:var(--pl); background:var(--pl-soft); }
.rota-date.mine b { color:var(--dl); }



.rank-load { text-align:right; } .rank-load b { font-family:'Space Grotesk'; font-weight:700; font-size:16px; display:block; color:var(--ink); } .rank-load small { font-size:10px; color:var(--soft); }
.fab { position:fixed; bottom:20px; left:50%; transform:translateX(-50%); z-index:30; background:var(--pl); color:#fff; font-weight:700; font-size:14px; padding:14px 22px; border-radius:999px; box-shadow:0 6px 20px rgba(59,65,201,.4); display:flex; align-items:center; gap:8px; }
.scrim { position:fixed; inset:0; background:rgba(20,26,34,.45); z-index:40; display:flex; align-items:flex-end; justify-content:center; }
.sheet { background:var(--surface); width:100%; max-width:480px; border-radius:22px 22px 0 0; padding:20px 18px 8px; max-height:92vh; overflow-y:auto; animation:up .25s ease; }
@keyframes up { from{ transform:translateY(30px); opacity:.6 } to{ transform:translateY(0); opacity:1 } }
.sheet h2 { font-family:'Space Grotesk'; font-size:19px; font-weight:700; margin:0 0 2px; color:var(--ink); } .sheet .sub { font-size:12px; color:var(--soft); margin-bottom:18px; }
.field { margin-bottom:14px; } .field label { font-size:12px; font-weight:700; display:block; margin-bottom:6px; color:var(--ink); }
.field input, .field select { width:100%; padding:11px 12px; border:1px solid var(--line); border-radius:11px; font:inherit; font-size:14px; background:var(--bg); color:var(--ink); outline:none; }
.field input::placeholder { color:#9AA2AD; }
.field input:focus, .field select:focus { border-color:var(--pl); background:#fff; }
.field select option { color:var(--ink); background:#fff; }
.pick { display:flex; gap:8px; } .pick button { flex:1; padding:11px 4px; border-radius:11px; border:1px solid var(--line); background:var(--bg); font-size:13px; font-weight:600; color:var(--soft); }
.pick button.sel { background:var(--pl); color:#fff; border-color:var(--pl); }
.sheet-footer { position:sticky; bottom:0; background:var(--surface); padding:12px 0; margin-top:10px; border-top:1px solid var(--line); z-index:2; }
.close { font-size:14px; font-weight:700; color:var(--soft); background:var(--bg); border-radius:10px; padding:11px; width:100%; margin-top:8px; }
.suggest { background:var(--pl-soft); border:1px solid #D3D5F7; border-radius:14px; padding:14px; margin:6px 0 16px; }
.suggest-lbl { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.5px; color:var(--pl); }
.suggest-big { font-family:'Space Grotesk'; font-weight:700; font-size:30px; margin:4px 0 2px; color:var(--ink); } .suggest-calc { font-size:11px; color:var(--soft); font-family:'Space Grotesk'; }
.suggest-edit { display:flex; align-items:center; gap:10px; margin-top:10px; }
.match-hint { font-size:11px; color:var(--soft); background:var(--bg); border-radius:9px; padding:8px 11px; margin-bottom:12px; line-height:1.4; } .match-hint b { color:var(--pl); }
.match-line { display:flex; align-items:center; gap:10px; padding:10px 12px; border-radius:12px; margin-bottom:8px; border:1px solid var(--line); animation:fade .3s ease backwards; }
.match-line.picked { background:var(--dl-soft); border-color:#B9E3DC; } .match-line.picked .avatar { background:var(--dl); color:#fff; }
@keyframes fade { from{ opacity:0; transform:translateY(6px) } to{ opacity:1; transform:translateY(0) } }
.load-score { margin-left:auto; text-align:right; } .load-score b { font-family:'Space Grotesk'; font-weight:700; font-size:14px; display:block; color:var(--ink); } .load-score small { font-size:10px; color:var(--soft); }
.picktag { font-size:10px; font-weight:800; color:var(--dl); text-transform:uppercase; letter-spacing:.4px; }
.blocked { opacity:.55; } .blocked .load-score b { color:var(--red); }
.toggle { display:flex; align-items:center; justify-content:space-between; background:var(--surface); border:1px solid var(--line); border-radius:14px; padding:14px; margin-bottom:12px; }
.toggle-name { font-weight:700; font-size:14px; color:var(--ink); } .toggle-sub { font-size:12px; color:var(--soft); }
.sw { width:46px; height:27px; border-radius:999px; background:var(--line); position:relative; transition:.2s; flex-shrink:0; } .sw.on { background:var(--dl); }
.sw span { position:absolute; top:3px; left:3px; width:21px; height:21px; border-radius:50%; background:#fff; transition:.2s; box-shadow:0 1px 3px rgba(0,0,0,.2); } .sw.on span { left:22px; }
.note-item { background:var(--bg); border-radius:12px; padding:11px 13px; margin-bottom:8px; }
.note-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:5px; gap:8px; }
.note-author { font-size:12px; font-weight:700; color:var(--ink); }
.note-text { font-size:13px; color:var(--ink); line-height:1.4; }
.note-controls { display:flex; align-items:center; gap:8px; margin:12px 0 4px; }
.note-controls span { font-size:12px; font-weight:600; color:var(--ink); }
`;

/* ================================ component =============================== */
export default function RelayApp() {
  const [me, setMe] = useState("lead30");
  const [view, setView] = useState("PL");
  const [scope, setScope] = useState("mine");
  const [hour, setHour] = useState(realDubaiHour());
  const sunday = isSunday();
  const [projects, setProjects] = useState(SEED_PROJECTS);
  const [people, setPeople] = useState(PEOPLE);
  const [requests, setRequests] = useState([]);
  const [intakeOpen, setIntakeOpen] = useState(false);
  const [swapFor, setSwapFor] = useState(null);
  const [teamOpen, setTeamOpen] = useState(false);
  const [rotaOpen, setRotaOpen] = useState(false);
  const [swapReqs, setSwapReqs] = useState([]);   // {id, date, from, note}
  const [rota, setRota] = useState(() => {
    const sundays = upcomingSundays(6), r = {};
    sundays.forEach((d, i) => { r[d] = i % 2 === 0 ? ["zeta", "kappa"] : ["epsilon", "gamma"]; });
    const t = todayKey(); if (isSunday() && !r[t]) r[t] = ["zeta", "kappa"];
    return r;
  });
  const [notesFor, setNotesFor] = useState(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => { setNow(Date.now()); setHour(realDubaiHour()); }, 1000);
    return () => clearInterval(t);
  }, []);

  const myTeam = teamOf(me);
  const teamMates = people.filter(p => p.team === myTeam);
  const teamIds = new Set(teamMates.map(p => p.id));
  const teamView = scope === "team";

  const active = projects.filter(p => !p.archived);
  const myProjectsPL = teamView
    ? active.filter(p => teamIds.has(p.pl))
    : active.filter(p => p.pl === me);
  const myArchivedPL = projects.filter(p => p.pl === me && p.archived);
  const myProjectsDL = teamView
    ? active.filter(p => p.status === "matched" && p.assignments.some(a => teamIds.has(a.deliverer)))
    : active.filter(p => p.status === "matched" && p.assignments.some(a => a.deliverer === me));
  const openPool = active.filter(p => p.status === "open");
  const myRequests = requests.filter(r => projects.find(p => p.id === r.projectId && p.pl === me));
  const fdScope = teamView
    ? active.filter(p => p.stage === "First Deliverable" && p.status === "matched" && (teamIds.has(p.pl) || p.assignments.some(a => teamIds.has(a.deliverer))))
    : active.filter(p => p.stage === "First Deliverable" && p.status === "matched" && (p.pl === me || p.assignments.some(a => a.deliverer === me)));
  const fdCount = fdScope.length;
  const rankPeople = teamView ? teamMates : people;
  const myself = people.find(p => p.id === me) || {};
  const onRotaToday = sunday ? new Set(rota[todayKey()] || []) : null;   // null = not a Sunday, rota not applied
  const meOnRotaToday = sunday && onRotaToday.has(me);
  const mySundays = Object.keys(rota).filter(d => (rota[d] || []).includes(me)).sort();

  const updateProject = (id, patch) => setProjects(ps => ps.map(p => p.id === id ? { ...p, ...patch } : p));
  const updateAssignment = (pid, aid, patch) => setProjects(ps => ps.map(p => p.id !== pid ? p : { ...p, assignments: p.assignments.map(a => a.id === aid ? { ...a, ...patch } : a) }));
  const addProject = (proj, matched) => { setProjects(ps => [{ ...proj, status: matched.length ? "matched" : "open", assignments: matched }, ...ps]); setIntakeOpen(false); setView("PL"); };
  const advanceStage = p => { const i = ORDER.indexOf(p.stage); if (i < ORDER.length - 1) updateProject(p.id, { stage: ORDER[i + 1], stageEnteredAt: Date.now() }); };
  const returnStage = p => { const i = ORDER.indexOf(p.stage); if (i > 0) updateProject(p.id, { stage: ORDER[i - 1], stageEnteredAt: Date.now() }); };
  const swapDeliverer = (pid, aid, newId) => { setProjects(ps => ps.map(p => p.id !== pid ? p : { ...p, assignments: p.assignments.map(a => a.id === aid ? { ...a, deliverer: newId } : a) })); setSwapFor(null); };
  const claim = pid => setProjects(ps => ps.map(p => p.id !== pid ? p : { ...p, status: "matched", stageEnteredAt: Date.now(), assignments: [{ id: "a" + (SEQ++), deliverer: me, goal: p.goalTotal, delivered: 0, customGoal: 0, customDelivered: 0 }] }));
  const requestChange = (pid, text) => setRequests(rs => [{ id: "r" + (SEQ++), projectId: pid, from: me, text }, ...rs]);
  const resolveRequest = rid => setRequests(rs => rs.filter(r => r.id !== rid));
  const toggleEvening = id => setPeople(ps => ps.map(p => p.id === id ? { ...p, eveningCoverage: !p.eveningCoverage } : p));
  const toggleRota = (date, id) => setRota(r => {
    const cur = r[date] || [];
    return { ...r, [date]: cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id] };
  });
  const askSwap = (date, note) => setSwapReqs(rs => [{ id: "s" + (SEQ++), date, from: me, note }, ...rs]);
  const resolveSwap = sid => setSwapReqs(rs => rs.filter(r => r.id !== sid));
  const setStatus = (id, status) => setPeople(ps => ps.map(p => p.id === id ? { ...p, status } : p));
  const removeMember = id => setPeople(ps => ps.map(p => p.id === id ? { ...p, team: "" } : p));
  const addMember = name => setPeople(ps => [...ps, { id: "u" + (SEQ++), name, practice: "Tech", team: myTeam, manager: false, status: "Available", eveningCoverage: false }]);
  const addNote = (pid, note) => setProjects(ps => ps.map(p => p.id === pid ? { ...p, noteList: [{ id: "n" + (SEQ++), ts: Date.now(), ...note }, ...(p.noteList || [])] } : p));

  const projStats = p => {
    const goal = p.assignments.reduce((s, a) => s + a.goal, 0);
    const done = p.assignments.reduce((s, a) => s + a.delivered + a.customDelivered, 0);
    return { goal, done, pct: goal ? Math.min(100, Math.round(done / goal * 100)) : 0 };
  };
  const paceColor = (pct, stage) => stage === "Hail Mary" ? { c: "var(--red)", label: "Behind" } : stage === "Selling" ? { c: "var(--pl)", label: "Selling" } : pct >= 66 ? { c: "var(--green)", label: "On pace" } : pct >= 33 ? { c: "var(--amber)", label: "Watch" } : { c: "var(--red)", label: "Behind" };
  const barColor = pct => pct >= 66 ? "var(--green)" : pct >= 33 ? "var(--amber)" : "var(--red)";
  const stageClass = s => s === "First Deliverable" ? "stage-first" : s === "Second Deliverable" ? "stage-second" : s === "Hail Mary" ? "stage-hail" : "stage-selling";
  const typeClass = t => t === "Pitch" ? "pitch" : t === "Due Diligence" ? "dd" : "strategy";
  const poolState = tz => { const w = poolWeight(tz, hour); return w === 0 ? "dormant" : w === 2 ? "live" : "normal"; };
  const visibleNotes = p => (p.noteList || []).filter(n => n.public || n.author === me).length;

  const hh = Math.floor(hour), mm = Math.floor((hour - hh) * 60);
  const timeStr = String(hh).padStart(2, "0") + ":" + String(mm).padStart(2, "0");
  const ah = afterHours(hour);

  return (
    <div className="relay">
      <style>{CSS}</style>
      <div className="hdr">
        <div className="hdr-top">
          <div className="brand"><h1>Relay</h1><span>capacity & delivery</span></div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div className="persona"><span style={{ color: "var(--soft)" }}>as</span>
              <select value={me} onChange={e => setMe(e.target.value)}>{people.map(p => <option key={p.id} value={p.id}>{p.name}{p.manager ? " (mgr)" : ""}</option>)}</select>
            </div>
            <button className={"eve-btn " + (myself.eveningCoverage ? "on" : "")} onClick={() => toggleEvening(me)}
              title={myself.eveningCoverage ? "Evening coverage ON — tap to go off" : "Evening coverage OFF — tap to go on"}>
              {myself.eveningCoverage ? "🌙" : "💤"}
            </button>
            <button className="profile-btn" onClick={() => setTeamOpen(true)} title="My team">{initials(nameOf(me))}</button>
          </div>
        </div>
        <div className="controls">
          <div className="seg">
            <button className={view === "PL" ? "on-pl" : ""} onClick={() => setView("PL")}>Leading{myRequests.length > 0 && <span className="badge">{myRequests.length}</span>}</button>
            <button className={view === "Delivery" ? "on-dl" : ""} onClick={() => setView("Delivery")}>Delivery</button>
            <button className={view === "Ranking" ? "on-rk" : ""} onClick={() => setView("Ranking")}>Capacity</button>
            <button className={view === "FirstDel" ? "on-fd" : ""} onClick={() => setView("FirstDel")}>1st Del{fdCount ? ` · ${fdCount}` : ""}</button>
          </div>
          <div className="scope">
            <button className={scope === "mine" ? "on" : ""} onClick={() => setScope("mine")}>My view</button>
            <button className={scope === "team" ? "on" : ""} onClick={() => setScope("team")}>Team view</button>
          </div>
        </div>
        <div className="timebar">
          <span className="clock-time">🇦🇪 {timeStr} Dubai</span>
          <span className="time-cap">{ah ? "After hours — evening coverage only" : "Working hours"} · {hour >= 15 ? "US pool live 2×" : "US pool asleep"} · {hour < 15 ? "APAC live 2×" : "APAC done"}</span>
        </div>
      </div>

      <div className="body">
        <div className={"mode-strip " + (view === "PL" ? "pl" : view === "Delivery" ? "dl" : "rk")} />
        {sunday && (
          <div className="sunday-strip">🗓 <b>Sunday</b> — {meOnRotaToday ? "you're on the rota today, thanks for the effort!" : "you're not on the rota today, enjoy your Sunday."} {(rota[todayKey()] || []).length} on coverage.
            <button className="link-btn" onClick={() => setRotaOpen(true)}>View rota</button>
          </div>
        )}

        {view === "PL" && (
          <>
            {myRequests.map(r => (
              <div key={r.id} className="review-strip"><span>↩</span>
                <div style={{ flex: 1 }}><b>{nameOf(r.from)}</b> requests: {r.text}</div>
                <button className="btn-sm btn-pl" onClick={() => resolveRequest(r.id)}>Resolve</button>
              </div>
            ))}
            <div className="section-lbl">Projects you lead <span className="count">{myProjectsPL.length}</span></div>
            {myProjectsPL.length === 0 && <div className="empty"><b>No projects yet</b>Tap “New project” to add one and auto-staff it.</div>}

            {myProjectsPL.map(p => {
              const { goal, done, pct } = projStats(p);
              const pace = paceColor(pct, p.stage), elapsed = now - p.stageEnteredAt, ps = poolState(p.timezone), nc = visibleNotes(p);
              return (
                <div key={p.id} className="card">
                  <div className="card-top"><div><div className="client">{p.client}</div><div className="topic">{p.topic} · {p.account}</div></div><div className={"tag " + typeClass(p.type)}>{p.type}</div></div>
                  <div className="meta">
                    <div className="chip">N <b>{p.calls}</b> calls</div>
                    <div className={"chip " + (ps === "dormant" ? "dormant" : ps === "live" ? "live" : "")}>{p.timezone}{ps === "live" ? " · live 2×" : ps === "dormant" ? " · asleep" : ""}</div>
                    <div className="chip">sold <b>{p.sold}</b></div>
                    <div className={"chip timer " + timerClass(elapsed)}>⏱ {fmtElapsed(elapsed)} in {p.stage.replace(" Deliverable", "")}</div>
                  </div>
                  <div className="progress">
                    <div className="progress-top"><span className="progress-num">{done}<small> / {goal} profiles</small></span><span className="mono" style={{ fontSize: 12, color: "var(--soft)" }}>goal {p.goalTotal}</span></div>
                    <div className="bar"><span style={{ width: pct + "%", background: barColor(pct) }} /></div>
                  </div>
                  <div className="stage-row">
                    <span className={"stage-pill " + stageClass(p.stage)}>{p.stage}</span>
                    {p.sold < done && <span className="chip" style={{ color: "#A82F2F", background: "var(--red-bg)" }}>delivered &gt; sold — chase client</span>}
                    <span className="pace" style={{ color: pace.c }}><span className="dot" style={{ background: pace.c }} />{pace.label}</span>
                  </div>
                  <div className="assignees">
                    {p.assignments.map(a => (
                      <div key={a.id} className="assignee">
                        <div className="avatar">{initials(nameOf(a.deliverer))}</div>
                        <div><div className="assignee-name">{nameOf(a.deliverer)} <span style={{ color: "var(--soft)", fontWeight: 500 }}>· {practiceOf(a.deliverer)}</span></div>
                          <div className="assignee-sub">{a.customDelivered > 0 ? `incl. ${a.customDelivered} custom` : "no custom"}</div></div>
                        <div className="assignee-num">{a.delivered + a.customDelivered}/{a.goal}
                          <button className="btn-sm" style={{ display: "block", marginTop: 4, color: "var(--pl)", background: "var(--pl-soft)" }} onClick={() => setSwapFor({ projectId: p.id, assignmentId: a.id })}>swap</button></div>
                      </div>
                    ))}
                  </div>
                  <div className="actions"><GoalEditor project={p} onChange={updateAssignment} /></div>
                  <div className="actions">
                    <button className="btn btn-ghost" disabled={p.stage === "First Deliverable"} style={{ opacity: p.stage === "First Deliverable" ? .4 : 1 }} onClick={() => returnStage(p)}>← Back</button>
                    <button className="btn btn-ghost" disabled={p.stage === "Selling"} style={{ opacity: p.stage === "Selling" ? .4 : 1 }} onClick={() => advanceStage(p)}>Advance →</button>
                  </div>
                  <div className="actions">
                    <button className="btn btn-ghost" onClick={() => setNotesFor({ projectId: p.id, role: "PL" })}>📝 Notes{nc ? ` · ${nc}` : ""}</button>
                    <button className="btn btn-ghost" onClick={() => updateProject(p.id, { archived: true })}>Archive</button>
                  </div>
                </div>
              );
            })}

            {myArchivedPL.length > 0 && (
              <>
                <div className="section-lbl spaced">Archived <span className="count">{myArchivedPL.length}</span></div>
                {myArchivedPL.map(p => (
                  <div key={p.id} className="rank-row">
                    <div className="rank-body"><div className="rank-name">{p.client} · {p.topic}</div><div className="rank-sub"><span>{p.type} · {p.timezone}</span></div></div>
                    <button className="btn-sm btn-pl" onClick={() => updateProject(p.id, { archived: false, stageEnteredAt: Date.now() })}>Resurface</button>
                  </div>
                ))}
              </>
            )}
          </>
        )}

        {view === "Delivery" && (
          <>
            {openPool.length > 0 && (
              <>
                <div className="section-lbl" style={{ color: "#9A5F0C" }}>Open — up for grabs <span className="count">{openPool.length}</span></div>
                {openPool.map(p => {
                  const canTake = isEligible(people.find(x => x.id === me), hour, onRotaToday);
                  return (
                    <div key={p.id} className="card" style={{ borderColor: "#F0DCB0", background: "#FFFDF8" }}>
                      <div className="card-top"><div><div className="client">{p.client}</div><div className="topic">{p.topic} · {p.timezone}</div></div><div className={"tag " + typeClass(p.type)}>{p.type}</div></div>
                      <div className="meta"><div className="chip">N <b>{p.calls}</b> calls</div><div className="chip">goal <b>{p.goalTotal}</b></div></div>
                      <p style={{ fontSize: 12, color: "var(--soft)", margin: "10px 0 0" }}>No one was free to auto-match. {ah ? "Evening volunteers — first to accept takes it." : "First to accept takes it."}</p>
                      <div className="actions">
                        <button className="btn btn-ghost" onClick={() => updateProject(p.id, { status: "declined-" + me })}>Decline</button>
                        <button className="btn btn-dl" disabled={!canTake} style={{ opacity: canTake ? 1 : .4 }} onClick={() => claim(p.id)}>{canTake ? "Accept" : "Not online now"}</button>
                      </div>
                    </div>
                  );
                })}
              </>
            )}
            <div className="cov-card">
              <div className="cov-item">
                <div>
                  <div className="cov-title">🌙 Evening coverage <span className="cov-tagline">voluntary</span></div>
                  <div className={"cov-state " + (myself.eveningCoverage ? "on" : "off")}>
                    {myself.eveningCoverage
                      ? (ah ? "You're online now — thanks for covering! Toggle off when you're done for the night."
                            : "You're on for this evening. Thank you! You can switch off anytime.")
                      : (ah ? "You're set as unavailable this evening — you won't be allocated work. Toggle to change."
                            : "You're off in the evenings. Toggle on to take after-hours work.")}
                  </div>
                </div>
                <button className={"sw " + (myself.eveningCoverage ? "on" : "")} onClick={() => toggleEvening(me)}><span /></button>
              </div>
              <div className="cov-item">
                <div style={{ flex: 1 }}>
                  <div className="cov-title">🗓 Sunday rota <span className="cov-tagline">set by your manager</span></div>
                  <div className="cov-state off">
                    {mySundays.length
                      ? <>You're rostered on <b>{mySundays.slice(0, 2).map(prettySunday).join(", ")}</b>{mySundays.length > 2 ? ` +${mySundays.length - 2} more` : ""}.</>
                      : "You're not on any upcoming Sunday."}
                  </div>
                </div>
                <button className="btn-sm btn-ghost" onClick={() => setRotaOpen(true)}>View</button>
              </div>
            </div>

            <div className="section-lbl">Assigned to you <span className="count">{myProjectsDL.length}</span></div>
            {myProjectsDL.length === 0 && <div className="empty"><b>Nothing assigned</b>When a PL staffs you, it lands here.</div>}
            {myProjectsDL.map(p => {
              const a = p.assignments.find(x => x.deliverer === me);
              const doneAll = a.delivered + a.customDelivered;                      // custom counts toward goal
              const remaining = Math.max(a.goal - doneAll, 0);
              const pct = a.goal ? Math.min(100, Math.round(doneAll / a.goal * 100)) : 0;
              const elapsed = now - p.stageEnteredAt, ps = poolState(p.timezone), nc = visibleNotes(p);
              return (
                <div key={p.id} className="card">
                  <div className="card-top"><div><div className="client">{p.client}</div><div className="topic">{p.topic} · PL {nameOf(p.pl)}</div></div><span className={"stage-pill " + stageClass(p.stage)}>{p.stage}</span></div>
                  <div className="meta">
                    <div className={"chip timer " + timerClass(elapsed)}>⏱ {fmtElapsed(elapsed)} in {p.stage.replace(" Deliverable", "")}</div>
                    {ps === "dormant" && <div className="chip dormant">💤 {p.timezone} asleep — goal inactive now</div>}
                    {ps === "live" && <div className="chip live">⚡ {p.timezone} live — double weight, convert now</div>}
                  </div>
                  <div className="progress">
                    <div className="progress-top"><span className="progress-num">{doneAll}<small> / {a.goal} your goal</small></span><span className="mono" style={{ fontSize: 12, color: remaining ? "#9A5F0C" : "#1F7D4C" }}>{remaining ? remaining + " to go" : "done ✓"}</span></div>
                    <div className="bar"><span style={{ width: pct + "%", background: barColor(pct) }} /></div>
                  </div>
                  <div className="assignees">
                    <div className="assignee"><div className="avatar dl">✓</div><div><div className="assignee-name">From our system</div><div className="assignee-sub">counts toward your goal</div></div>
                      <div className="step" style={{ marginLeft: "auto" }}><button onClick={() => updateAssignment(p.id, a.id, { delivered: Math.max(0, a.delivered - 1) })}>−</button><span className="val">{a.delivered}</span><button onClick={() => updateAssignment(p.id, a.id, { delivered: a.delivered + 1 })}>+</button></div>
                    </div>
                    <div className="assignee"><div className="avatar dl" style={{ background: "#F3E8FB", color: "#8E3BC9" }}>★</div><div><div className="assignee-name">Custom sourced</div><div className="assignee-sub">outside the system · also counts</div></div>
                      <div className="step" style={{ marginLeft: "auto" }}><button onClick={() => updateAssignment(p.id, a.id, { customDelivered: Math.max(0, a.customDelivered - 1) })}>−</button><span className="val">{a.customDelivered}</span><button onClick={() => updateAssignment(p.id, a.id, { customDelivered: a.customDelivered + 1 })}>+</button></div>
                    </div>
                  </div>
                  <div className="actions"><RequestChange onSend={txt => requestChange(p.id, txt)} /></div>
                  <div className="actions"><button className="btn btn-ghost" onClick={() => setNotesFor({ projectId: p.id, role: "Delivery" })}>📝 Notes{nc ? ` · ${nc}` : ""}</button></div>
                </div>
              );
            })}
          </>
        )}

        {view === "Ranking" && <RankingView people={rankPeople} projects={active} hour={hour} onRotaToday={onRotaToday} sunday={sunday} teamView={teamView} myTeam={myTeam} />}
        {view === "FirstDel" && <FirstDelView projects={fdScope} now={now} teamView={teamView} myTeam={myTeam} />}
      </div>

      {view === "PL" && <button className="fab" onClick={() => setIntakeOpen(true)}>＋ New project</button>}
      {intakeOpen && <IntakeSheet me={me} people={people} projects={active} hour={hour} sunday={sunday} onRotaToday={onRotaToday} onClose={() => setIntakeOpen(false)} onCreate={addProject} />}
      {swapFor && <SwapSheet me={me} people={people} projects={active} hour={hour} sunday={sunday} onRotaToday={onRotaToday} swapFor={swapFor} onClose={() => setSwapFor(null)} onSwap={swapDeliverer} />}
      {notesFor && <NotesSheet me={me} role={notesFor.role} project={projects.find(p => p.id === notesFor.projectId)} onClose={() => setNotesFor(null)} onAdd={addNote} />}
      {rotaOpen && <RotaSheet me={me} people={people} rota={rota} swapReqs={swapReqs} myTeam={myTeam}
        onToggle={toggleRota} onAskSwap={askSwap} onResolveSwap={resolveSwap} onClose={() => setRotaOpen(false)} />}
      {teamOpen && <MyTeamSheet me={me} people={people} projects={active} myTeam={myTeam}
        onClose={() => setTeamOpen(false)} onStatus={setStatus}
        onRemove={removeMember} onAdd={addMember} onOpenRota={() => { setTeamOpen(false); setRotaOpen(true); }} />}
    </div>
  );
}



/* ------------------------------ sunday rota ------------------------------ */
function RotaSheet({ me, people, rota, swapReqs, myTeam, onToggle, onAskSwap, onResolveSwap, onClose }) {
  const mgr = isManager(me);
  const dates = upcomingSundays(6);
  const [sel, setSel] = useState(dates[0]);
  const [note, setNote] = useState("");
  const [asking, setAsking] = useState(false);
  const mates = people.filter(p => p.team === myTeam);
  const onDate = rota[sel] || [];
  const meOnSel = onDate.includes(me);
  const reqs = swapReqs.filter(r => r.date === sel);

  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <h2>Sunday rota</h2>
        <div className="sub">{mgr ? "You're a manager — tap anyone to add or remove them from a Sunday." : "Set by your manager. If a date doesn't work, request a swap."}</div>

        <div className="rota-dates">
          {dates.map(d => {
            const cnt = (rota[d] || []).length;
            const mine = (rota[d] || []).includes(me);
            return (
              <button key={d} className={"rota-date " + (sel === d ? "sel " : "") + (mine ? "mine" : "")} onClick={() => setSel(d)}>
                <b>{prettySunday(d)}</b><small>{cnt} on{mine ? " · you" : ""}</small>
              </button>
            );
          })}
        </div>

        {reqs.map(r => (
          <div key={r.id} className="review-strip"><span>⇄</span>
            <div style={{ flex: 1 }}><b>{nameOf(r.from)}</b> asks to swap: {r.note}</div>
            {mgr && <button className="btn-sm btn-pl" onClick={() => onResolveSwap(r.id)}>Resolve</button>}
          </div>
        ))}

        <div className="section-lbl" style={{ marginTop: 14 }}>On rota — {prettySunday(sel)} <span className="count">{onDate.length}</span></div>
        {mates.map(p => {
          const on = onDate.includes(p.id);
          return (
            <div key={p.id} className={"match-line " + (on ? "picked" : "")}
              onClick={mgr ? () => onToggle(sel, p.id) : undefined}
              style={{ cursor: mgr ? "pointer" : "default" }}>
              <div className="avatar">{initials(p.name)}</div>
              <div>
                <div className="assignee-name">{p.name}{p.id === me ? " (you)" : ""}</div>
                <div className="assignee-sub">{on ? "on this Sunday" : "off"}{p.status !== AVAILABLE ? ` · ${p.status}` : ""}</div>
              </div>
              {mgr && <span className="load-score"><b>{on ? "✓" : "+"}</b></span>}
            </div>
          );
        })}

        {!mgr && meOnSel && !asking && (
          <button className="btn btn-ghost" style={{ width: "100%", marginTop: 10 }} onClick={() => setAsking(true)}>⇄ Request a swap for this Sunday</button>
        )}
        {!mgr && asking && (
          <div style={{ marginTop: 10 }}>
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. can anyone take this? I'm away"
              style={{ width: "100%", padding: 11, borderRadius: 11, border: "1px solid var(--line)", fontSize: 14, background: "var(--bg)", color: "var(--ink)" }} />
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button className="btn btn-ghost" onClick={() => setAsking(false)}>Cancel</button>
              <button className="btn btn-dl" onClick={() => { if (note.trim()) { onAskSwap(sel, note.trim()); setNote(""); setAsking(false); } }}>Send to manager</button>
            </div>
          </div>
        )}

        <div className="sheet-footer"><button className="btn btn-pl" style={{ width: "100%" }} onClick={onClose}>Done</button></div>
      </div>
    </div>
  );
}

/* ------------------------------ my team sheet ------------------------------ */
function MyTeamSheet({ me, people, projects, myTeam, onClose, onStatus, onRemove, onAdd, onOpenRota }) {
  const [newName, setNewName] = useState("");
  const mgr = isManager(me);
  const mates = people.filter(p => p.team === myTeam);
  const statusClass = s => s === "Available" ? "free" : s === "Sick" ? "off" : s === "On vacation" ? "vac" : "busy";
  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <h2>My team · {myTeam.replace("Team_", "")}</h2>
        <div className="sub">{mgr ? "You're a manager — you can set status and the roster. Coverage is each person's own choice." : "View only. Managers manage the roster."}</div>

        {mates.map(p => {
          const held = remainingN(p, projects);
          return (
            <div key={p.id} className="member">
              <div className="member-top">
                <div className="avatar">{initials(p.name)}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="assignee-name">{p.name}{p.manager ? " · mgr" : ""}</div>
                  <div className="assignee-sub">{p.practice}{held > 0 ? ` · ${held} profiles outstanding` : " · no open work"}</div>
                </div>
                <span className={"mini " + statusClass(p.status)}>{p.status}</span>
              </div>

              {mgr && (
                <>
                  <div className="status-pick">
                    {STATUSES.map(s => (
                      <button key={s} className={p.status === s ? "sel" : ""} onClick={() => onStatus(p.id, s)}>{s}</button>
                    ))}
                  </div>
                  {p.status !== "Available" && held > 0 && (
                    <div className="warn-line">⚠ {p.status} with {held} profiles outstanding — reassign via the project card.</div>
                  )}
                  <div className="cov-readonly">
                    <span className={"mini " + (p.eveningCoverage ? "free" : "busy")}>🌙 Evening {p.eveningCoverage ? "on" : "off"}</span>
                    <span className="cov-hint">evening is their own choice</span>
                  </div>
                  {p.id !== me && <button className="remove-btn" onClick={() => onRemove(p.id)}>Remove from team</button>}
                </>
              )}
            </div>
          );
        })}

        {mgr && (
          <button className="close" style={{ background: "var(--pl-soft)", color: "var(--pl)", marginBottom: 10 }} onClick={onOpenRota}>🗓 Manage Sunday rota →</button>
        )}
        {mgr && (
          <div className="add-row">
            <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Add team member by name…" />
            <button className="btn-sm btn-pl" onClick={() => { if (newName.trim()) { onAdd(newName.trim()); setNewName(""); } }}>Add</button>
          </div>
        )}

        <div className="sheet-footer"><button className="btn btn-pl" style={{ width: "100%" }} onClick={onClose}>Done</button></div>
      </div>
    </div>
  );
}

/* --------------------------- capacity ranking --------------------------- */
function RankingView({ people, projects, hour, onRotaToday, sunday, teamView, myTeam }) {
  const ranked = rankCandidates(people, projects, hour, null, onRotaToday).sort((a, b) => a.load - b.load);
  return (
    <>
      <div className="scope-note">{teamView ? `Team view — ${myTeam}` : "Everyone across all teams"}</div>
      <div className="section-lbl">First up now — lowest load leads <span className="count">{ranked.length}</span></div>
      {ranked.length === 0 && <div className="empty">No one online.</div>}
      {ranked.map((r, i) => (
        <div key={r.person.id} className={"rank-row " + (i < 2 && r.eligible ? "top" : "")}>
          <div className="rank-num">{i + 1}</div><div className="avatar">{initials(r.person.name)}</div>
          <div className="rank-body"><div className="rank-name">{r.person.name}</div>
            <div className="rank-sub"><span className="mini prac">{r.person.practice}</span>
              <span className="mini team">{r.person.team.replace("Team_", "")}</span>
              {!r.eligible ? <span className="mini off">off now</span> : r.free ? <span className="mini free">free</span> : <span className="mini busy">busy</span>}
              <span>{r.rem} profiles left</span></div>
          </div>
          <div className="rank-load"><b>{r.load.toFixed(1)}</b><small>load</small></div>
        </div>
      ))}
      <p className="foot-note">Load = remaining profiles × stage weight × expert-pool weight for the current Dubai hour. Lowest load is staffed next.</p>
    </>
  );
}

/* --------------------------- first deliverables --------------------------- */
function FirstDelView({ projects, now, teamView, myTeam }) {
  const rows = projects.map(p => ({ p, elapsed: now - p.stageEnteredAt })).sort((a, b) => b.elapsed - a.elapsed);
  const overdue = rows.filter(r => r.elapsed / 60000 >= 30).length;
  return (
    <>
      <div className="scope-note">{teamView ? `Team view — ${myTeam}` : "My projects only"}</div>
      {overdue > 0 && <div className="review-strip"><span>⏱</span><div style={{ flex: 1 }}><b>{overdue}</b> past 30 min with no update — ping due</div></div>}
      <div className="section-lbl">First deliverables in flight <span className="count">{rows.length}</span></div>
      {rows.length === 0 && <div className="empty"><b>Nothing in first deliverable</b>Projects appear here the moment they start.</div>}
      {rows.map(({ p, elapsed }) => (
        <div key={p.id} className="card">
          <div className="card-top">
            <div><div className="client">{p.client}</div><div className="topic">{p.topic} · PL {nameOf(p.pl)}</div></div>
            <div className={"chip timer " + timerClass(elapsed)} style={{ fontSize: 14, fontWeight: 700 }}>⏱ {fmtElapsed(elapsed)}</div>
          </div>
          <div className="meta">
            <div className="chip">N <b>{p.calls}</b></div>
            <div className="chip">goal <b>{p.goalTotal}</b></div>
            <div className="chip">{p.timezone}</div>
            {elapsed / 60000 >= 30 && <div className="chip" style={{ background: "var(--red-bg)", color: "#A82F2F" }}>30m+ · ping due</div>}
          </div>
          <div className="assignees" style={{ paddingTop: 10 }}>
            {p.assignments.map(a => {
              const dAll = a.delivered + a.customDelivered;
              const pct = a.goal ? Math.min(100, Math.round(dAll / a.goal * 100)) : 0;
              return (
                <div key={a.id} className="assignee">
                  <div className="avatar dl">{initials(nameOf(a.deliverer))}</div>
                  <div style={{ flex: 1 }}>
                    <div className="assignee-name">{nameOf(a.deliverer)}</div>
                    <div className="bar" style={{ marginTop: 4 }}><span style={{ width: pct + "%", background: pct >= 66 ? "var(--green)" : pct >= 33 ? "var(--amber)" : "var(--red)" }} /></div>
                  </div>
                  <div className="assignee-num">{dAll}/{a.goal}</div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      <p className="foot-note">Sorted by time in first deliverable — oldest first. At 30 min with no update the live build pings the PL and deliverer.</p>
    </>
  );
}

/* --------------------------- PL: edit a goal --------------------------- */
function GoalEditor({ project, onChange }) {
  const [open, setOpen] = useState(false);
  const [aid, setAid] = useState(project.assignments[0]?.id);
  const a = project.assignments.find(x => x.id === aid) || project.assignments[0];
  if (!a) return null;
  if (!open) return <button className="btn btn-pl" onClick={() => setOpen(true)}>Edit goals</button>;
  return (
    <div style={{ flex: 1 }}>
      {project.assignments.length > 1 && (
        <select value={aid} onChange={e => setAid(e.target.value)} style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid var(--line)", marginBottom: 8, fontSize: 13, color: "var(--ink)" }}>
          {project.assignments.map(x => <option key={x.id} value={x.id}>{nameOf(x.deliverer)}</option>)}
        </select>
      )}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 600, flex: 1, color: "var(--ink)" }}>Goal for {nameOf(a.deliverer)}</span>
        <div className="step"><button onClick={() => onChange(project.id, a.id, { goal: Math.max(0, a.goal - 1) })}>−</button><span className="val">{a.goal}</span><button onClick={() => onChange(project.id, a.id, { goal: a.goal + 1 })}>+</button></div>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 600, flex: 1, color: "#8E3BC9" }}>Custom goal</span>
        <div className="step"><button onClick={() => onChange(project.id, a.id, { customGoal: Math.max(0, a.customGoal - 1) })}>−</button><span className="val">{a.customGoal}</span><button onClick={() => onChange(project.id, a.id, { customGoal: a.customGoal + 1 })}>+</button></div>
      </div>
      <button className="btn btn-ghost" style={{ width: "100%" }} onClick={() => setOpen(false)}>Done</button>
    </div>
  );
}

/* --------------------- Delivery: request a change --------------------- */
function RequestChange({ onSend }) {
  const [open, setOpen] = useState(false);
  const [txt, setTxt] = useState("");
  if (!open) return <button className="btn btn-ghost" onClick={() => setOpen(true)}>Request goal change ↩</button>;
  return (
    <div style={{ flex: 1 }}>
      <input value={txt} onChange={e => setTxt(e.target.value)} placeholder="e.g. lower goal to 15 — pool is thin" style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid var(--line)", fontSize: 13, marginBottom: 8, color: "var(--ink)" }} />
      <div style={{ display: "flex", gap: 8 }}><button className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button><button className="btn btn-dl" onClick={() => { if (txt.trim()) { onSend(txt); setTxt(""); setOpen(false); } }}>Send to PL</button></div>
      <p style={{ fontSize: 11, color: "var(--soft)", margin: "8px 0 0", textAlign: "center" }}>The PL owns the goal — they’ll confirm any change.</p>
    </div>
  );
}

/* ------------------------------ notes sheet ------------------------------ */
function NotesSheet({ me, role, project, onClose, onAdd }) {
  const [txt, setTxt] = useState("");
  const [pub, setPub] = useState(false);
  if (!project) return null;
  const visible = (project.noteList || []).filter(n => n.public || n.author === me);
  const add = () => { if (txt.trim()) { onAdd(project.id, { author: me, role, text: txt.trim(), public: pub }); setTxt(""); setPub(false); } };
  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <h2>Notes</h2>
        <div className="sub">{project.client} · {project.topic}. Public notes are seen by everyone on the project; private notes only by you.</div>
        {visible.length === 0 && <div className="empty">No notes yet.</div>}
        {visible.map(n => (
          <div key={n.id} className="note-item">
            <div className="note-head">
              <span className="note-author">{nameOf(n.author)} · {n.role}</span>
              <span className={"mini " + (n.public ? "free" : "busy")}>{n.public ? "Public" : "Private"}</span>
            </div>
            <div className="note-text">{n.text}</div>
          </div>
        ))}
        <div className="sheet-footer">
          <input value={txt} onChange={e => setTxt(e.target.value)} placeholder="Add a note…" style={{ width: "100%", padding: 11, borderRadius: 11, border: "1px solid var(--line)", fontSize: 14, color: "var(--ink)", background: "var(--bg)" }} />
          <div className="note-controls">
            <button className={"sw " + (pub ? "on" : "")} onClick={() => setPub(!pub)}><span /></button>
            <span>{pub ? "Public — everyone on the project" : "Private — only you"}</span>
          </div>
          <button className="btn btn-pl" style={{ width: "100%" }} onClick={add}>Add note</button>
          <button className="close" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------- intake sheet ----------------------------- */
function IntakeSheet({ me, people, projects, hour, sunday, onRotaToday, onClose, onCreate }) {
  const [step, setStep] = useState(1);
  const [f, setF] = useState({ client: "", account: "", topic: "", link: "", type: "Pitch", timezone: "Global", calls: 2 });
  const [goalTotal, setGoalTotal] = useState(null);
  const [staff, setStaff] = useState(1);
  const [matched, setMatched] = useState(null);
  const [matching, setMatching] = useState(false);
  const plPractice = practiceOf(me);
  const calls = Number(f.calls) || 0;

  const goSuggest = () => { setGoalTotal(suggestGoal(calls)); setStaff(suggestStaff(calls)); setStep(2); };
  const runMatch = () => {
    setMatching(true); setStep(3);
    setTimeout(() => {
      const ranked = rankCandidates(people, projects, hour, plPractice, onRotaToday);
      setMatched({ ranked, picked: ranked.filter(r => r.eligible).slice(0, staff) });
      setMatching(false);
    }, 900);
  };
  const confirm = () => {
    const per = Math.ceil(goalTotal / (matched.picked.length || 1));
    const customEach = calls <= SMALL_CALLS ? 1 : 0;
    const assignments = matched.picked.map(r => ({ id: "a" + (SEQ++), deliverer: r.person.id, goal: per, delivered: 0, customGoal: customEach, customDelivered: 0 }));
    onCreate({ id: "p" + (SEQ++), pl: me, client: f.client || "New client", account: f.account, topic: f.topic || "Untitled",
      type: f.type, timezone: f.timezone, calls, goalTotal, stage: "First Deliverable", stageEnteredAt: Date.now(), sold: 0, marketShare: 0, archived: false, link: f.link, noteList: [] }, assignments);
  };

  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        {step === 1 && (
          <>
            <h2>New project</h2><div className="sub">Relay estimates the sourcing goal and auto-staffs it.</div>
            <div className="field"><label>Client</label><input value={f.client} onChange={e => setF({ ...f, client: e.target.value })} placeholder="e.g. BCG" /></div>
            <div className="field"><label>Topic / account</label><input value={f.topic} onChange={e => setF({ ...f, topic: e.target.value })} placeholder="e.g. EV charging infra" /></div>
            <div className="field"><label>N — calls the client wants</label><input type="number" value={f.calls} onChange={e => setF({ ...f, calls: e.target.value })} /></div>
            <div className="field"><label>Project type</label><div className="pick">{TYPES.map(t => <button key={t} className={f.type === t ? "sel" : ""} onClick={() => setF({ ...f, type: t })}>{t}</button>)}</div></div>
            <div className="field"><label>Expert timezone pool</label><select value={f.timezone} onChange={e => setF({ ...f, timezone: e.target.value })}>{POOLS.map(p => <option key={p}>{p}</option>)}</select></div>
            <div className="field"><label>Project link (optional)</label><input value={f.link} onChange={e => setF({ ...f, link: e.target.value })} placeholder="paste link" /></div>
            <div className="sheet-footer"><button className="btn btn-pl" style={{ width: "100%" }} onClick={goSuggest}>Estimate goal →</button><button className="close" onClick={onClose}>Cancel</button></div>
          </>
        )}
        {step === 2 && (
          <>
            <h2>Suggested plan</h2><div className="sub">You own these numbers — adjust before confirming.</div>
            <div className="suggest">
              <div className="suggest-lbl">Goal — profiles to source</div><div className="suggest-big">{goalTotal}</div>
              <div className="suggest-calc">{calls} calls (N) × {multFor(calls)} = {goalTotal} profiles</div>
              <div className="suggest-edit"><span style={{ fontSize: 12, fontWeight: 600 }}>Adjust goal</span>
                <div className="step" style={{ marginLeft: "auto" }}><button onClick={() => setGoalTotal(Math.max(1, goalTotal - 1))}>−</button><span className="val">{goalTotal}</span><button onClick={() => setGoalTotal(goalTotal + 1)}>+</button></div></div>
            </div>
            <div className="suggest" style={{ background: "var(--dl-soft)", borderColor: "#B9E3DC" }}>
              <div className="suggest-lbl" style={{ color: "var(--dl)" }}>Delivering associates to staff</div>
              <div className="suggest-edit"><span style={{ fontSize: 12, fontWeight: 600 }}>{staff} {staff > 1 ? "people" : "person"} · ~{Math.ceil(goalTotal / staff)} each{calls <= SMALL_CALLS ? " · +1 custom" : ""}</span>
                <div className="step" style={{ marginLeft: "auto" }}><button onClick={() => setStaff(Math.max(1, staff - 1))}>−</button><span className="val">{staff}</span><button onClick={() => setStaff(staff + 1)}>+</button></div></div>
            </div>
            <div className="sheet-footer"><button className="btn btn-pl" style={{ width: "100%" }} onClick={runMatch}>Find who’s first up →</button><button className="close" onClick={() => setStep(1)}>← Back</button></div>
          </>
        )}
        {step === 3 && (
          <>
            <h2>{matching ? "Finding who’s first up…" : "Auto-matched"}</h2>
            <div className="sub">{matching ? "Ranking by current load." : sunday ? "Sunday — only people on today's rota." : afterHours(hour) ? "After hours — evening-coverage volunteers only." : "Working hours — all available staff."}</div>
            {!matching && <div className="match-hint">Soft rule: prefers your practice area (<b>{plPractice}</b>) when they’re free — remaining profiles at or below the team median.</div>}
            {matching && <div style={{ textAlign: "center", padding: 30, fontFamily: "'Space Grotesk'", color: "var(--soft)" }}>ranking…</div>}
            {!matching && matched && matched.picked.length === 0 && (
              <div className="suggest" style={{ background: "var(--amber-bg)", borderColor: "#F0DCB0" }}>
                <div className="suggest-lbl" style={{ color: "#9A5F0C" }}>No one available now</div>
                <p style={{ fontSize: 13, margin: "6px 0 0", color: "var(--ink)" }}>It’ll go to the open pool — eligible people can accept or decline.{afterHours(hour) ? " (In the live build this is where the evening push goes out to volunteers.)" : ""}</p>
              </div>
            )}
            {!matching && matched && matched.ranked.slice(0, 6).map((r, i) => (
              <div key={r.person.id} className={"match-line " + (matched.picked.includes(r) ? "picked " : "") + (r.eligible ? "" : "blocked")} style={{ animationDelay: (i * 0.06) + "s" }}>
                <div className="avatar">{initials(r.person.name)}</div>
                <div><div className="assignee-name">{r.person.name} <span style={{ color: "var(--soft)", fontWeight: 500 }}>· {r.person.practice}</span></div>
                  <div className="assignee-sub">{!r.eligible ? (sunday && onRotaToday && !onRotaToday.has(r.person.id) ? "not on today's Sunday rota" : "evening coverage off") : matched.picked.includes(r) ? <span className="picktag">picked ✓{r.practiceBoost ? " · your practice" : ""}</span> : (r.free ? "free" : "available")}</div></div>
                <div className="load-score"><b>{r.load.toFixed(1)}</b><small>load</small></div>
              </div>
            ))}
            {!matching && <div className="sheet-footer"><button className="btn btn-pl" style={{ width: "100%" }} onClick={confirm}>{matched.picked.length ? `Assign ${matched.picked.length} & notify` : "Post to open pool"}</button><button className="close" onClick={() => setStep(2)}>← Back</button></div>}
          </>
        )}
      </div>
    </div>
  );
}

/* ------------------------------ swap sheet ------------------------------ */
function SwapSheet({ me, people, projects, hour, sunday, onRotaToday, swapFor, onClose, onSwap }) {
  const project = projects.find(p => p.id === swapFor.projectId);
  const a = project.assignments.find(x => x.id === swapFor.assignmentId);
  const ranked = rankCandidates(people.filter(p => p.id !== a.deliverer), projects, hour, practiceOf(project.pl), onRotaToday);
  const remaining = Math.max(a.goal - a.delivered, 0);
  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <h2>Swap deliverer</h2><div className="sub">{nameOf(a.deliverer)} keeps credit for {a.delivered} delivered. The new person inherits the {remaining} remaining.</div>
        {ranked.slice(0, 6).map(r => (
          <div key={r.person.id} className={"match-line " + (r.eligible ? "" : "blocked")}>
            <div className="avatar">{initials(r.person.name)}</div>
            <div><div className="assignee-name">{r.person.name} <span style={{ color: "var(--soft)", fontWeight: 500 }}>· {r.person.practice}</span></div>
              <div className="assignee-sub">{!r.eligible ? (sunday && onRotaToday && !onRotaToday.has(r.person.id) ? "not on today's rota" : "evening coverage off") : r.practiceBoost ? "your practice · free" : r.free ? "free" : "available"}</div></div>
            <div className="load-score" style={{ marginRight: 10 }}><b>{r.load.toFixed(1)}</b><small>load</small></div>
            <button className="btn-sm btn-pl" disabled={!r.eligible} style={{ opacity: r.eligible ? 1 : .4 }} onClick={() => onSwap(project.id, a.id, r.person.id)}>Assign</button>
          </div>
        ))}
        <div className="sheet-footer"><button className="close" style={{ marginTop: 0 }} onClick={onClose}>Cancel</button></div>
      </div>
    </div>
  );
}
