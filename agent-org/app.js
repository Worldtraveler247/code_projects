"use strict";

// Public roster only. Seats that handle personal messages, mail or money are
// kept out of this file on purpose; do not add them here.
const KINDS = {
  agent:   { label: "On-demand agent",   color: "var(--cyan)" },
  skill:   { label: "Skill",             color: "var(--purple)" },
  routine: { label: "Scheduled routine", color: "var(--green)" },
  script:  { label: "Local script",      color: "var(--amber)" },
  vacant:  { label: "Vacant seat",       color: "var(--muted)" }
};

const STAFF = [
  { id: "checkin", ab: "CI", name: "Check-in", role: "Chief of staff", kind: "skill", say: "/checkin",
    does: "Gathers pending drafts, the day's calendar and open loops into one numbered approval queue.",
    rule: "Drafts only. Nothing is sent or deleted without a numbered command." },
  { id: "memory", ab: "ME", name: "Memory index", role: "Memory and learning", kind: "skill", say: "what do you remember about <topic>?",
    does: "A file-based memory every session loads: projects, standing preferences and lessons from past corrections.",
    rule: "Wrong entries get corrected at the source, not worked around." },
  { id: "review", ab: "WR", name: "Weekly Review", role: "Strategy check", kind: "routine", when: "Weekly", say: "board meeting",
    does: "Writes a dated brief: a scorecard, countdowns, one recommendation and three questions for the week.",
    rule: "Proposes only. It changes no plans by itself." },
  { id: "verifier", ab: "?", name: "Independent verifier", role: "Checks other agents' work", kind: "vacant", say: "",
    does: "A read-only agent that checks claims, commands and numbers against sources before anything is published.",
    rule: "Not built yet. Until it is, the human does the checking." }
];

const DEPTS = [
  { name: "Career & Hiring", goal: "Land the role", seats: [
    { id: "coach", ab: "CC", name: "SysAdmin Career Coach", role: "Director · search, résumé, interview drills", kind: "agent", lead: true, say: "weekly search",
      does: "Runs the weekly job search, tailors a résumé to a posting, drills interview questions and reviews portfolio code.",
      rule: "Drafts applications. A person submits them." },
    { id: "jobsearch", ab: "JS", name: "Daily Job Search", role: "Finds new postings", kind: "routine", when: "Daily", say: "show today's job search results",
      does: "Searches for roles that match a written target profile and reports the matches.", rule: "Reports only." },
    { id: "tickets", ab: "TD", name: "Ticket Documenter", role: "Writes lab procedures", kind: "agent", say: "document ticket <number>",
      does: "Turns a lab ticket into a step-by-step procedure in a fixed template, then a deeper explanation of the technology.",
      rule: "Writes documents. Runs nothing on lab hosts unasked." },
    { id: "drill", ab: "RD", name: "Recall Drill", role: "Daily spoken practice", kind: "skill", say: "/drill-5",
      does: "Picks five past tickets, grades spoken answers against the guide and updates a tracker.", rule: "Edits only its own tracker." }
  ]},
  { name: "Study & Skills", goal: "Build the skill", seats: [
    { id: "saa", ab: "SA", name: "AWS Study Coach", role: "Director · drills and pace", kind: "agent", lead: true, say: "drill me for SAA",
      does: "Quizzes with exam-style scenarios aimed at weak domains and tracks pace against the exam date.",
      rule: "Quizzes and tracks. It does not write the study notes." },
    { id: "python", ab: "PY", name: "Python Security Mentor", role: "Teaching and code review", kind: "agent", say: "teach me <python concept>",
      does: "Teaches a Python concept through a security exercise, or reviews code for idiom, typing, error handling and tests.",
      rule: "Teaches and reviews." },
    { id: "log", ab: "LL", name: "Learning Log", role: "Study journal", kind: "skill", say: "/daily-learning-log",
      does: "Prompts for the day's study entry and appends it to a journal.", rule: "Appends only." },
    { id: "advice", ab: "SS", name: "Senior Security Advice", role: "Daily mentoring note", kind: "routine", when: "Daily", say: "show today's senior security advice",
      does: "Writes one piece of senior-level security advice each day.", rule: "Writes to its own folder only." },
    { id: "speaking", ab: "SP", name: "Speaking Scripts", role: "Daily speaking drills", kind: "routine", when: "Daily", say: "show today's speaking scripts",
      does: "Writes a set of short scripts for practicing clear technical speech.", rule: "Writes to its own folders only." }
  ]},
  { name: "Content & Audience", goal: "Show the work", seats: [
    { id: "video", ab: "VC", name: "Video Co-builder", role: "Director · ideas, scripts, packaging", kind: "agent", lead: true, say: "what should I cover this week?",
      does: "Reads the learning journal, picks the next video and writes the outline, title and description.",
      rule: "Plans and writes. A person records and publishes." },
    { id: "webarch", ab: "WA", name: "Web App Architect", role: "Builds the apps on this hub", kind: "agent", say: "build <app idea> for the App Hub",
      does: "Designs, builds, debugs and deploys web apps, from the first idea to a live page.",
      rule: "Syncs with the remote before every push." },
    { id: "brief", ab: "DB", name: "The Daily Brief", role: "Nightly newsletter", kind: "routine", when: "Nightly", say: "check last night's newsletter run",
      does: "Builds and publishes a nightly newsletter issue from the day's material.", rule: "Publishes on a schedule. Failures are reported." },
    { id: "narrator", ab: "BN", name: "Blog Narrator", role: "Audio for every entry", kind: "script", when: "Once per entry", say: "add an audio version to log entry <number>",
      does: "Turns a blog entry into a narration script and renders it to audio with a local voice model.",
      rule: "Reads the page as written. It changes no text." }
  ]}
];

const all = [...STAFF, ...DEPTS.flatMap((d) => d.seats)];
const byId = Object.fromEntries(all.map((s) => [s.id, s]));
let filter = "all";
let openId = null;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function seatHTML(s) {
  const vacant = s.kind === "vacant";
  return `<button type="button" class="seat${s.lead ? " lead" : ""}${vacant ? " vacant" : ""}" data-id="${s.id}" data-kind="${s.kind}" aria-expanded="false" style="--kc:${KINDS[s.kind].color}">
    <span class="badge" aria-hidden="true">${esc(s.ab)}</span>
    <span class="txt"><span class="nm">${esc(s.name)}</span><span class="role">${esc(s.role)}</span></span>${vacant ? '<span class="flag">Vacant</span>' : ""}</button>`;
}

function render() {
  $("staff").innerHTML = STAFF.map(seatHTML).join("");
  $("depts").innerHTML = DEPTS.map((d) =>
    `<div class="panel"><div class="panel-head"><h3>${esc(d.name)}</h3><span>${esc(d.goal)}</span></div><div class="seats">${d.seats.map(seatHTML).join("")}</div></div>`
  ).join("");
  const count = (k) => all.filter((s) => s.kind === k).length;
  $("tally").innerHTML = `<li><b>1</b> human</li><li><b>${all.length - count("vacant")}</b> seats filled</li><li><b>${count("vacant")}</b> vacant</li><li><b>${DEPTS.length}</b> departments</li>`;
  const chips = [["all", "Everyone", all.length], ...Object.entries(KINDS).map(([k, v]) => [k, v.label, count(k)])];
  $("filters").innerHTML = chips.map(([k, label, c]) =>
    `<button type="button" class="chip" data-f="${k}" aria-pressed="${k === filter}">${esc(label)} · ${c}</button>`
  ).join("");
}

function applyFilter() {
  document.querySelectorAll(".seat").forEach((b) => { b.hidden = filter !== "all" && b.dataset.kind !== filter; });
  document.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.f === filter)));
}

function showDetail(id) {
  const box = $("detail");
  openId = id;
  document.querySelectorAll(".seat").forEach((b) => b.setAttribute("aria-expanded", String(b.dataset.id === id)));
  if (!id) { box.hidden = true; box.innerHTML = ""; return; }
  const s = byId[id];
  const k = KINDS[s.kind];
  box.hidden = false;
  box.innerHTML = `<div class="detail" style="--kc:${k.color}">
    <div class="detail-head"><div><p class="kind">${esc(k.label)}</p><h3>${esc(s.name)}</h3></div><button type="button" class="btn" id="detail-close">Close</button></div>
    <p>${esc(s.does)}</p>
    <dl><dt>Role</dt><dd>${esc(s.role)}</dd>${s.when ? `<dt>Runs</dt><dd>${esc(s.when)}</dd>` : ""}<dt>Guardrail</dt><dd>${esc(s.rule)}</dd></dl>
    ${s.say ? `<div><p class="kind">How it is called</p><div class="say"><code id="say-text">${esc(s.say)}</code><button type="button" class="btn primary" id="say-copy">Copy</button></div></div>` : ""}
  </div>`;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  box.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
}

function copySay(btn) {
  const selectText = () => {
    const range = document.createRange();
    range.selectNodeContents($("say-text"));
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    btn.textContent = "Selected";
  };
  if (!navigator.clipboard) { selectText(); return; }
  navigator.clipboard.writeText(byId[openId].say).then(() => {
    btn.textContent = "Copied";
    setTimeout(() => { btn.textContent = "Copy"; }, 1400);
  }, selectText);
}

document.addEventListener("click", (e) => {
  const seat = e.target.closest(".seat");
  const chip = e.target.closest(".chip");
  if (seat) { showDetail(openId === seat.dataset.id ? null : seat.dataset.id); return; }
  if (chip) { filter = chip.dataset.f; applyFilter(); return; }
  if (e.target.id === "detail-close") { showDetail(null); return; }
  if (e.target.id === "say-copy") { copySay(e.target); }
});

render();
applyFilter();

if (window.location.hash === "#signed-up") {
  $("signup-note").textContent = "Thanks. Your address was received, and the next set of build notes will come to you.";
}
