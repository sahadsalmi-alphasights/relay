# Relay — Build Spec

> Paste this into Claude Code as the first message in a fresh project folder.
> It is the complete specification. Build to it; ask before deviating.

---

## 0. What this is

Relay is an internal capacity-and-delivery tracker for a ~50-person team at an
expert-network firm. It replaces a Google Sheet + Apps Script system.

**Roles.** Every user can act as both:
- **PL (Project Lead)** — owns projects, sets goals, staffs people.
- **Delivering Associate** — sources expert profiles against goals set by a PL.

**Core loop.** PL receives a client project → enters it → app suggests a sourcing
goal and how many people to staff → app auto-matches the lowest-loaded eligible
people → work appears on their board → they log profiles delivered → PL reviews.

---

## 1. Hard constraints (do not deviate without asking)

1. **No third-party SaaS backends.** No Supabase, Firebase, Auth0-hosted, Vercel
   KV, etc. This app will be hosted on the company's own AWS. Everything must be
   self-contained and portable.
2. **Docker Compose from turn one.** `docker compose up` must bring up the whole
   stack locally (app + Postgres). This is what makes "IT, please host this"
   a five-minute conversation instead of a rewrite.
3. **Postgres is the only datastore.** All shared state lives there. No
   browser-only state, no localStorage as a source of truth.
4. **All business logic runs server-side.** Matching, load weighting, goal
   ownership rules, stage transitions. The client renders; it does not decide.
5. **Auth via pluggable OIDC** (see §7). No hand-rolled password auth.
6. **DUMMY DATA ONLY.** Never commit or seed real client names, real employee
   names, or real project data. Company IT has not yet approved where this data
   may live. Seed with obviously-fake data (Client_A, Resource_Zeta, etc.).
7. **Desktop-first, responsive.** Most people use this on a PC; that's the
   primary target. Mobile must still work well — people check it on their
   phone and toggle evening coverage after hours — so build it responsive:
   desktop-first, with mobile as a proper adaptive layout, not a shrunken
   desktop and not a stretched phone screen. See §8 for the breakpoint
   behavior.

---

## 2. Stack

- **Frontend:** React + TypeScript + Vite. Mobile-first CSS.
- **Backend:** Node + TypeScript, Fastify. REST + WebSockets.
- **DB:** Postgres 16. Migrations via a standard tool (node-pg-migrate or Prisma).
- **Realtime:** WebSockets — when anything changes, push to connected clients so
  boards update live. This is the headline improvement over the spreadsheet.
- **Packaging:** Dockerfile + docker-compose.yml (app, db). `.env.example` for config.
- **Tests:** unit tests for §5 (the rules engine). That logic is the heart of the
  app and must be provably correct.

---

## 3. Domain model

### team
| field | type | notes |
|---|---|---|
| id | uuid | |
| name | text | e.g. "Team_Alpha" |

### person
| field | type | notes |
|---|---|---|
| id | uuid | |
| email | text unique | from SSO |
| name | text | |
| team_id | uuid → team | assigned at first login (§7a) |
| is_manager | bool | grants team-admin permissions (§7b) |
| practice_area | text | e.g. Tech, PIPE, Energy, COG |
| status | enum | `Available` \| `On vacation` \| `Sick` \| `Offline` |
| evening_coverage | bool | **self-serve, live toggle** — opted in to work after 19:00 |

**Everyone is both a PL and a deliverer.** Role is derived per-project (you are the
PL of projects you lead; a deliverer on assignments you hold). There is no global
"manager vs associate" role — `is_manager` only unlocks team admin.

### sunday_rota  (a SCHEDULE, not a preference)
| field | type | notes |
|---|---|---|
| id | uuid | |
| rota_date | date | a specific Sunday |
| person_id | uuid → person | rostered to work that Sunday |
| team_id | uuid → team | |
Unique on (rota_date, person_id).

### sunday_swap_request
| field | type | notes |
|---|---|---|
| id | uuid | |
| rota_date | date | |
| requested_by | uuid → person | |
| note | text | e.g. "can anyone take this? I'm away" |
| resolved | bool | only a manager may resolve |

### project
| field | type | notes |
|---|---|---|
| id | uuid | |
| pl_id | uuid → person | the PL who owns it |
| client | text | e.g. "Client_A" |
| account | text | sub-account |
| topic | text | |
| project_link | text NOT NULL | **required at intake, validated server-side as a http(s) URL** (bug fix — it used to be optional and, it turned out, never surfaced anywhere once collected). The project/client name is a hyperlink to this everywhere a project appears: PL board, Delivery board, First Deliverables, Team view. Opens in a new tab. |
| project_type | enum | `Pitch` \| `Due Diligence` \| `Strategy` — **one per project**, shared by all its angles. Changes the goal/staffing formula (§5a/§5b, run once per angle) and, for a Pitch with no calls agreed, the load formula too (§5c) |
| expert_pool | enum | see §4. **One per project**, shared by all its angles — angles don't get their own pool |
| status | enum | `matched` \| `open` (open = unmatched, up for grabs). Project-wide: `open` only if there are zero assignments across **every** angle; a project with at least one assignment anywhere is `matched`, even if some angle is still fully unstaffed (a known limitation — see §3a) |
| archived | bool | |

**Big structural change (§3a): calls_n, goal_total, calls_sold, and
calls_sold_updated_at moved to `angle`.** A project no longer stores any of
these directly — they're per-workstream now, not per-project. Everywhere the
API returns a `project`, `callsN`/`goalTotal`/`callsSold` are still present
on it, computed as the **sum across the project's angles** at query time
(§3a), so every existing "project totals" display kept working unchanged for
the common one-angle case.

**No `stage` or `stage_entered_at` column** (domain change 8) — stage lives on
`assignment` now, per deliverer. The project's `earliestStage` is still
**computed as the earliest stage among its assignments** (§6), never stored,
and still `null` for a project with no assignments yet (open pool) — but as
of the eight-changes batch (bug 2) it is **no longer surfaced as a rolled-up
label on the PL board card**; stage is per-deliverer now, so the roll-up
doesn't need its own display. It's still returned by the API and still
drives the "not yet staffed" pill and the pace indicator.

### angle  (big structural change — see §3a)
| field | type | notes |
|---|---|---|
| id | uuid | |
| project_id | uuid → project | |
| name | text | e.g. "Buy-side diligence" — pre-filled from the project's `topic` (or "Main") for the default first angle, so a simple project never surfaces the word "angle" in the UI |
| calls_n | int | **N = calls the client wants to take, for THIS angle** |
| goal_total | int | **profiles to source for this angle** (suggested by §5a from this angle's own `calls_n`, PL-editable) |
| calls_sold | int | how many of **this angle's** calls have actually sold. **PL-editable, enforced server-side** (§5e) — a stepper on the PL board, one per angle when a project has more than one. **Manual for now**, same as before the angle split. |
| calls_sold_updated_at | timestamptz | when this angle's `calls_sold` was last written; drives the end-of-day nudge below. Stamped automatically whenever `calls_sold` changes. |

**A project always has at least one angle.** There is no separate
"project-level vs angle-level" mode — a "simple" project is just a project
with a single angle, and the intake/board UI keeps that case visually
identical to how it looked before angles existed (§8). Deliverers are
assigned per angle (`assignment.angle_id`, below); auto-match, the goal/
staffing formula, and calls_sold all run per angle, never off a project-wide
number.

**End-of-day calls_sold nudge.** If a PL has an active (non-archived) led
project with **any** angle whose `calls_sold` hasn't been touched yet today
(Asia/Dubai calendar day, per that angle's own `calls_sold_updated_at`), the
Project Leading tab shows a banner prompting them to update it — the flag is
computed per angle then OR'd across the project's angles, not from a summed
total (see the chase-client note in §5d for why summing would be wrong).

**Editing an angle's `calls_n` re-suggests its `goal_total`** from §5a using
the new N (unless the caller also explicitly sets `goal_total`, e.g. a PL
revising the suggestion down — same downward-revision audit rule as intake,
§5g). If the goal actually changes **and the angle already has staffed
assignments** (an active goal), each of those assignments' own `goal` is
recalculated and pushed through the exact same rounds mechanism a
stage-driven goal change already uses (§3, `delivery_round` below): the
closed round is archived, `delivered` resets to 0 under the new goal. Editing
N on an unstaffed angle just updates the angle's own numbers — there's
nothing to cascade to.

### assignment  (one per deliverer per angle)
| field | type | notes |
|---|---|---|
| id | uuid | |
| angle_id | uuid → angle | **Big structural change** — assignments attach to an angle, not directly to a project (an assignment's `project_id`, as returned by the API, is a derived join through its angle — `angle.project_id` — kept on every API response so existing consumers didn't need to change). Uniqueness is on `(angle_id, deliverer_id)`, not `(project_id, deliverer_id)` — a person may hold assignments on two different angles of the same project (different workstreams), which was never possible before. |
| deliverer_id | uuid → person | |
| goal | int | profiles from our system pool |
| delivered | int | |
| custom_goal | int | **auto-calculated from `goal`, never set by hand** (§5) — the portion of `goal` expected to come from outside our system |
| stage | enum | see §6. **Per-deliverer, not per-project** (domain change 8) — one assignee can be on Second Deliverable while another on the same project (or the same angle) is still on First. Unaffected by the angle split — stage and load both stay exactly as they were, still summed/read per assignment regardless of which angle or project it belongs to. |
| stage_entered_at | timestamptz | drives *this assignment's* elapsed timer |
| custom_delivered | int | |

### 3a. Angles — one uniform structure, no special cases

**A project always has at least one angle.** A "simple" project is just a
project with a single angle — there is no separate "project-level vs
angle-level" mode. Everything (N, the suggested goal, staffing, assignments,
matching, calls_sold) attaches to an angle, always. One code path, not two.

- **Project type stays on the project** (one type per project) — the
  goal/staffing formula for that type runs **per angle**, using that angle's
  own `calls_n` (§5a/§5b).
- **A project's totals are the sum across its angles** — `callsN`,
  `goalTotal`, and `callsSold`, everywhere they appear in the API/UI
  (`project.callsN` etc.), are computed as `SUM(angle.*)` at query time, not
  stored columns. This is deliberate: it means every screen that displayed a
  project's totals before angles existed kept working with **zero changes**
  for the common one-angle case, and correctly sums for multi-angle projects.
- **Chase-client and the calls-sold nudge are the one exception to "just
  sum it."** Both are computed **per angle** and then OR'd across a
  project's angles — never derived from summed totals. A resolved angle
  (fully delivered and fully sold) can hide a genuinely lagging one if you
  sum first: e.g. angle A delivered=3/callsSold=3/callsN=3 (resolved) and
  angle B delivered=0/callsSold=0/callsN=2 (not started yet, no chase
  needed) sums to delivered=3>0 and callsSold=3<callsN=5 — a false
  positive that summing would produce and per-angle-then-OR does not.
- **Stage and load are unchanged.** Stage stays per-assignment (§6); load
  still sums across every assignment a person holds, regardless of which
  angle or project it belongs to (§5c). Neither rule needed to change at all
  — they already operated at the assignment level, angles or not.
- **A person may hold assignments on two different angles of the same
  project** (different workstreams) — the uniqueness constraint moved from
  `(project_id, deliverer_id)` to `(angle_id, deliverer_id)` specifically to
  allow this; it was never possible before.
- **Manual override + justification (§5g), auto-match, and the goal/
  staffing suggestion all run per angle.** Auto-match for a two-angle
  project is two independent ranking calls, one per angle — the same
  ranking logic, unaware of anything angle-specific, just invoked twice.

**Deliberate simplification — accepting an open-pool project.** An
unstaffed (`status = open`) project could in principle have more than one
angle, all unstaffed. Claiming one (§4, first-commit-wins) always lands the
claimant on the project's **first (earliest-created) angle** — there's no
angle picker in the accept flow. Multi-angle open-pool projects aren't a
described product scenario yet; if that becomes real, accepting needs its
own angle-selection step.

**Migration.** Every project that existed before this change became a
project with exactly one angle: named from its `topic` (or "Main" if the
topic was never set), carrying over its existing `calls_n`/`goal_total`/
`calls_sold`/`calls_sold_updated_at` unchanged, with every one of its
existing assignments re-pointed at that one new angle. No data loss.

### delivery_round  (domain change 9 — one row per CLOSED round; the live round lives on `assignment` itself)
| field | type | notes |
|---|---|---|
| id | uuid | |
| assignment_id | uuid → assignment | |
| goal | int | the closed round's goal |
| delivered | int | the closed round's delivered count |
| custom_delivered | int | the closed round's custom_delivered count |
| closed_at | timestamptz | when the goal change that closed this round happened |

**A goal change always closes the current round and opens a new one.** When
the PL edits `goal` on an assignment: the assignment's *current*
`(goal, delivered, custom_delivered)` is archived as a new `delivery_round`
row, then the assignment itself resets to `delivered = 0`,
`custom_delivered = 0` under the new `goal` (and recomputed `custom_goal`,
§5b2). This happens in one transaction so a concurrent progress update can't
be lost between the archive and the reset. `custom_goal` is not archived —
it's a derived display value, not part of the round's history. The
deliverer's board and load (§5c) always read the assignment's own live
fields, i.e. the current round; `delivery_round` exists purely as append-only
history for cumulative-delivered analytics (current round's delivered plus
the sum of every archived round for that assignment).

### note
| field | type | notes |
|---|---|---|
| id | uuid | |
| project_id | uuid → project | |
| author_id | uuid → person | |
| author_role | enum | `PL` \| `Delivery` |
| body | text | |
| is_public | bool | **public = everyone on the project; private = author only** |
| created_at | timestamptz | |

### goal_change_request
| field | type | notes |
|---|---|---|
| id | uuid | |
| project_id / assignment_id | uuid | |
| requested_by | uuid → person | a deliverer |
| body | text | |
| resolved | bool | only the PL may resolve |

### audit_log
Append-only: who changed what, when, old → new. Non-negotiable for a shared
work tool — it's what makes drift debuggable, unlike the spreadsheet.
Write-only by design so far: no `GET` route or UI screen surfaces it yet
(inspected via SQL / the test suite only). Worth confirming that's still the
intent rather than an oversight, same class of question `project_link` turned
out to be.

### Audited: collected-but-unused fields (bug fix follow-up)
Prompted by finding `project_link` and `calls_sold` unused after collection,
a pass over every stored field turned up two more that are computed/stored
but never read back anywhere:
- **`assignment.custom_goal`** — computed at §5b2, returned by the API, typed
  on the client — but no screen ever displays it. The PL currently sees the
  running `custom_delivered` tally, never the target they're meant to aim
  for.
- **`delivery_round`** (the whole table: `goal`, `delivered`,
  `custom_delivered`, `closed_at`) — archived automatically whenever a goal
  change starts a new round (§3/§9), queryable via
  `GET /assignments/:id/rounds` — but no web screen ever calls that route. A
  PL has no way to see a project's round history without querying the API
  directly.

Neither has been wired into the UI yet; flagging here so they're a deliberate
backlog item, not a silent gap.

---

## 4. Expert pools and the time model

**This is the most misunderstood part of the domain. Read carefully.**

All times are **Asia/Dubai**. Working day starts **08:00**. After **19:00** it is
"after hours".

### Expert pool = when the expert pool is AWAKE. It sets the goal's WEIGHT by
### time of day. It does NOT determine who is eligible to be staffed.

Pools: `Global`, `EU & MEA & India`, `AUS / NZ / Sing / JP`, `US only`

`pool_weight(pool, dubai_hour)`:

| pool | before 15:00 | 15:00 onwards |
|---|---|---|
| Global | 1 | 1 |
| EU & MEA & India | 1 | 1 |
| AUS / NZ / Sing / JP | **2** | **0** |
| US only | **0** | **2** |

**Why.** If you hold a goal of 5 on a US-pool project at 10:00 Dubai, the US is
asleep — you literally cannot convert, so that goal contributes **0** to your
load and you read as free for other work. The moment the US wakes (15:00), that
same goal becomes **double-weighted**: you have only a few hours of your day left
to convert it, so you should take on nothing else. APAC is the mirror image.

### Availability — FOUR INDEPENDENT RULES. Do not fuse them.

These are separate concepts that a previous iteration wrongly merged. Keep them apart.

**Rule 1 — status.** `Sick`, `On vacation` and `Offline` people are **never eligible
for allocation and never appear in the capacity ranking at all**. Only `Available`
people are considered. (Operationally the team ensures such a person has no pending
work before the status is set; the app does not need to auto-reassign, but it SHOULD
warn a manager who sets a non-Available status on someone with outstanding profiles.)

**Rule 2 — Sunday rota. THIS IS A SCHEDULE, NOT A PREFERENCE.**
Only a subset of the team works Sundays. **Managers set the rota in advance, per
date**, in a Sunday calendar (`sunday_rota`). On a Sunday, **only the people rostered
for THAT SPECIFIC DATE are eligible.** There is no per-person "sunday_coverage" flag —
eligibility is a lookup against that date's rota.
- People **see which Sundays they're rostered on**.
- A rostered person can **request a swap** (`sunday_swap_request`) with a note; only a
  **manager** can resolve it (i.e. edit the rota).
- Only managers may edit the rota. Enforce server-side.

**Rule 3 — evening coverage. VOLUNTARY AND SELF-SERVE.**
Everyone leaves ~19:00 but client work still arrives. Each person owns their own
`evening_coverage` toggle — **managers do NOT set it.** After 19:00 (or before 08:00),
only people currently toggled **on** are eligible.
- It is a **live** switch, flipped at any moment: someone may be available until 21:00,
  then go to bed and toggle off. Work already assigned to them stays assigned; they
  simply stop receiving new allocations.
- Therefore it must be **reachable in one tap from anywhere** — put a persistent
  toggle in the app header, plus the fuller card on the Delivery board.
- Plain-language state, e.g. after 19:00 and OFF: "You're set as unavailable this
  evening — you won't be allocated work. Toggle to change." ON: "You're online now —
  thanks for covering! Toggle off when you're done for the night."

**Do not conflate Rules 2 and 3.** One is a manager-owned calendar; the other is a
personal live switch. They stack: at 20:00 on a Sunday a person must be on that
date's rota AND have evening coverage on.

**Rule 4 — pool weight (§4 above).** This is NOT an eligibility rule. It only changes
the *weight* of a goal by time of day. Never use it to filter who can be staffed.
**(bug 1, eight changes) It also never gates logging work** — a deliverer must
always be able to log delivered/custom-delivered on any assignment they hold,
at any hour, dormant pool or not. The 💤/⚡ chip on the Delivery board is
informational only; the only real gate on those steppers is ownership (§5e).

```
is_eligible(person, dubai_now):
    if person.status != 'Available':                              return false  // rule 1
    if is_sunday(dubai_now)
       and person not in sunday_rota[date(dubai_now)]:            return false  // rule 2
    if after_hours(dubai_now) and not person.evening_coverage:    return false  // rule 3
    return true
```

**A project is never left open for people to claim while an eligible person
exists — the PL always assigns.** After hours, auto-matching does not change
its behavior, it changes its *candidate pool*: Rule 3 already restricts
eligibility to people with evening coverage on, and matching then picks the
lowest-load eligible person from that (possibly after-hours-narrowed) pool and
assigns them directly, exactly as during the day. The open pool / Accept-Decline
is a **last resort**, triggered only when the eligible set is genuinely empty
(zero evening-coverage volunteers, or every volunteer's status/rota fails
Rules 1/2 too) — never merely because everyone eligible happens to be busy.
Only then does the project go to **status = open**, appearing in a claimable
pool that evening-coverage volunteers can **Accept** or **Decline** (first to
accept takes it). Phase two sends this as a push notification.

---

## 5. The rules engine (server-side; unit-test this)

### 5a. Suggested goal — N (calls) → profiles to source
**(eight changes, change 4) Project type changes the formula, not just the
label.** Show the calculation on the suggestion screen for every type, so a
deliverer can always see why their goal is what it is.

**(big structural change, §3a) This formula runs per angle, using that
angle's own N** — never a project-wide N. Project type is shared by every
angle on a project (it's a project field, not an angle field), so the same
formula branch below applies to all of a project's angles; only the N (and
therefore the goal) differs per angle.

**Strategy** — the original formula, unchanged:
```
SMALL_CALLS  = 2
MULT_SMALL   = 3     // N <= 2  -> goal = N * 3   (2 calls -> 6 profiles)
MULT_LARGE   = 2     // N >= 3  -> goal = N * 2
```

**Pitch** — a preview list, usually with no calls agreed yet:
- **N = 0 is allowed at intake** (every other type still requires N >= 1).
  At N = 0, goal is a flat default of **8** (5–10 range), staffed to **1**
  deliverer — not sized off calls at all.
- The moment the client agrees to calls (N is set > 0, at intake or later via
  editing the project), **it converts to Strategy's formula above** — goal
  and staffing both — for as long as N stays > 0.

**Due Diligence** — N is typically high and sourcing is harder:
```
goal = N * 3          // always, no small/large split like Strategy
```
This is intentionally heavier than Strategy at the same N (e.g. N=10 ->
30 profiles for DD vs. 20 for Strategy) — DD both staffs more people (§5b)
and gives each more to source.

**These are placeholder constants supplied by the product owner and are expected
to be tuned.** Put them in one config module; do not scatter them.

### 5b. Suggested staffing
```
N = 1   -> 1 deliverer
N = 2   -> 2 deliverers                  // NOT ceil(2/2)=1 -- bug fix
N >= 3  -> ceil(N / 2) deliverers        // 1 deliverer per 2 calls
```
**(bug fix)** N=1 and N=2 are called out explicitly rather than falling
through to `ceil(N / 2)`: two calls' worth of sourcing is a two-person job,
even though `ceil(2/2)` is 1. Only N>=3 uses the divide-by-2 rule.

Same formula for Strategy, Due Diligence, and a Pitch once N > 0 (the DD
worked example: N=10 -> 5 deliverers -> 30 profiles / 5 = 6 each). A
no-calls Pitch (N=0) staffs exactly **1**, a special case ahead of this rule.

The suggestion is a default, not a constraint: whatever headcount the PL sets
(before confirming) is exactly how many are matched and staffed — the server
is authoritative on this (`autoMatch()`), not the client.

**(big structural change, §3a) Staffing, like the goal, is suggested and
matched per angle.** Auto-match for a project with N angles is N independent
`autoMatch()` calls, one per angle with that angle's own suggested headcount
— `rankCandidates`/`autoMatch` themselves are completely unaware angles
exist; the caller just invokes them once per angle instead of once per
project.

### 5b2. Custom goal — always derived, never set by hand
```
custom_goal = IF(goal <= 1, 0, MAX(ROUNDUP(goal * 0.33), 1))
```
`custom_goal` is **part of** `goal`, not additional to it: a goal of 10 means
the deliverer owes 10 profiles total, of which ~4 should ideally be
custom-sourced. It is recomputed automatically every time `goal` changes
(on assignment creation, and whenever the PL edits the goal) — there is no
separate control for it anywhere, for the PL or anyone else. `custom_delivered`
still counts toward `goal` exactly as before (§5c).

### 5c. Load score — "who is first up"
Lowest load = first up.

```
stage_weight:  First Deliverable = 2
               Second Deliverable = 1
               Hail Mary = 0.5
               Selling = 0          // deliverer's job is done

// CUSTOM PROFILES COUNT TOWARD THE GOAL. A profile sourced outside our system is
// still a delivered profile. custom_delivered is tracked separately only so the PL
// can see the split — it is NOT a separate goal to satisfy.
remaining(a)   = max(goal - (delivered + custom_delivered), 0)
progress(a)    = (delivered + custom_delivered) / goal

load(person)   = SUM over their assignments of
                   remaining(a) * stage_weight(a.stage)                 // per-assignment (§8)
                                * pool_weight(project.expert_pool, dubai_hour)
```

**(eight changes, change 4) Pitch with no calls agreed (N=0) pins load at a
flat 1**, regardless of `remaining(a)` — a preview list must not consume the
deliverer's capacity proportionally. **(big structural change, §3a)** this
reads live off the assignment's own **angle's** current `calls_n` (N is an
angle field, not a project field) — the instant that angle's N is set > 0,
it converts to the normal `load(person)` formula above, same as Strategy —
nothing needs to explicitly "convert" it. A person holding a no-calls-Pitch
angle alongside other, ordinary assignments still gets the flat pin only on
that one angle's contribution to their total load; the rest sums normally.

### 5d. Matching / auto-staffing — sort order
Given a project and the current Dubai hour, rank all people:

1. **Eligible first** (§4 `is_eligible`). Ineligible people are never auto-staffed.
2. **Practice-area soft rule.** Among eligible people, prefer someone in the
   **PL's practice area** who is **free**, ahead of a lower-load person outside it.
   - `free` := that person's **raw remaining profiles** (unweighted sum of
     `remaining(a)`) is **<= the median** raw remaining across all `Available` people.
   - **(bug fix)** A no-calls Pitch angle's (`calls_n = 0`) `remaining(a)` is
     **excluded** from this sum, exactly as it's excluded from `load` above —
     otherwise someone carrying only a Pitch would read as busy in the
     free/busy label while the load model itself says they aren't. Someone
     whose only work is a no-calls Pitch has raw remaining of 0 and shows as
     free. Once that angle's Pitch converts (`calls_n > 0`) its profiles
     count normally again, same as it does for `load`.
3. **Then lowest `load`** (§5c).

Pick the top `staff_count`. If zero eligible people exist → `status = open` (§4).

People failing Rule 1 (sick/vacation/offline) are **excluded from the ranking entirely** —
they do not appear greyed out, they simply are not there. People failing Rules 2 or 3
DO appear in the match reveal, greyed, with the reason ("not on Sunday crew" / "no
evening coverage") — so the PL can see who *would* be available.

Surface the reasoning in the UI (show each candidate's load, their practice area,
and why someone was picked). Users must be able to see *why*, or they won't trust it.

### 5e. Goal ownership — THE PL OWNS THE GOAL, ALWAYS
- **PL may:** edit `goal` on any assignment of their project (which
  auto-recomputes `custom_goal`, per §5b2 — there is no separate control for
  it, — and, per domain change 9, **closes the current round**: the
  assignment's prior `(goal, delivered, custom_delivered)` is archived to
  `delivery_round` and the assignment resets to 0 delivered under the new
  goal); swap a deliverer; change stage; archive; edit any project field.
- **Deliverer may:** edit only their own `delivered` and `custom_delivered`;
  add notes; **request** a goal change.
- **A deliverer may never write to `goal` or `custom_goal`, and nobody — PL
  included — ever writes `custom_goal` directly.** Enforce this server-side,
  not just by hiding buttons. A goal-change request creates a
  `goal_change_request` row; only the PL can act on it.
- **(eight changes, change 6) Audit-log whenever a PL revises the suggested
  goal downwards** at intake, before it's ever staffed: `goalTotal` below
  what `suggestGoal(callsN, projectType)` would produce writes an
  `audit_log` row (`downward_goal_revision`) with the suggested value and
  what the PL actually set. No notification — this is a quiet audit trail,
  not a warning.

### 5f. Swapping a deliverer
Reassigning an assignment to a new person:
- The assignment keeps its `delivered` / `custom_delivered` counts (project
  progress is preserved; the new person inherits the remaining work).
- The **credit for what was already delivered stays attributed to the original
  person** — record this in `audit_log` so historical stats stay honest.
- Both people's loads re-rank immediately.

### 5g. Manual override, with justification (eight changes, change 6)
At intake and when editing the team, **the PL may always override the
auto-match/suggested pick and choose anyone currently free** — "Edit team"
(§8) shows every eligible candidate, not just the top-ranked ones. Picking
someone other than the suggested candidate is an **override**:
- **Requires a written justification** before the pick is confirmed.
- **Never notifies anyone about the override itself** — the person actually
  picked still gets the ordinary "assigned" notification (§8b); nobody gets
  told they were passed over.
- **Always logged to `audit_log`** (`manual_override`): who overrode, who
  was picked instead of whom, the justification, and a timestamp. Applies
  both at intake (staffing a new project) and later (swapping someone in via
  "Edit team").
- **(big structural change, §3a)** at intake, this is per angle — a
  two-angle project's override flow (and the justification requirement) is
  independent per angle, since each angle runs its own auto-match. "Edit
  team" asks which angle a new deliverer is being added to first, when a
  project has more than one (silently the project's one angle otherwise).

---

## 6. Stages

Ordered: `First Deliverable` → `Second Deliverable` → `Hail Mary` → `Selling`

**Stage is per-deliverer, not per-project** (domain change 8). It lives on
`assignment`, so two people staffed on the same project can be at different
stages — advancing or backing one assignee's stage never touches another
assignee's, even on the same project. Load weighting (§5c) always reads the
*assignment's own* stage, never a project-level one.

- Advancing sets that assignment's `stage_entered_at = now()`.
- **A "back a stage" action is required** (mis-clicks happen). Same reset.
- **`Selling`** = delivery is done and good, but the calls haven't sold yet — it's
  now on the PL to close. Carries `stage_weight = 0`.
- Every **assignee row** shows its own **live elapsed timer** for
  time-in-current-stage, colour-banded: **< 30 min green · 30–60 amber · 60+
  red**. A project card shows a summary badge — the **earliest** stage among
  its assignees (§3) — but that summary is read-only; advance/back always
  targets one specific assignee.

---

## 7. Auth

- **(§11 step 6, built) OIDC / OAuth2 (Authorization Code + PKCE)** against the
  company IdP, via `openid-client` (discovery against the standard
  `/.well-known/openid-configuration` document, so no provider — Okta / Azure
  AD / Google Workspace / ... — is ever hardcoded). Issuer URL, client ID,
  client secret, and redirect URI all come from **env vars**
  (`OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`,
  `OIDC_REDIRECT_URI`).
  - `GET /auth/oidc/login` builds the PKCE code verifier/challenge + state +
    nonce, stashes them in a short-lived signed httpOnly cookie, and redirects
    to the IdP.
  - `GET /auth/oidc/callback` verifies the state, exchanges the code (with the
    PKCE verifier) for tokens, and validates the ID token — all via
    `openid-client`, nothing hand-rolled.
  - Discovery is lazy (first login attempt) and cached, not done at server
    boot, so an unreachable IdP can't crash-loop the process before it even
    binds a port.
- Session via secure, httpOnly cookie — the **same** `relay_session` cookie
  DEV_AUTH already used; OIDC is just a second way to populate it, so nothing
  else in the app (authorization, `request.actor`) needed to change.
- On first login, **upsert a `person` row from the OIDC claims** (email,
  name) — team-less until §7a onboarding runs, exactly like a fresh DEV_AUTH
  person.
- Provide a **`DEV_AUTH=true` mode** that bypasses OIDC and lets you pick a seeded
  dummy user — so local development and the demo work before IT provisions SSO.
  This must be impossible to enable in production config, **and the reverse
  also holds**: with `DEV_AUTH=false`, the server refuses to boot unless all
  four `OIDC_*` vars are set (see `config.ts`) — a half-configured production
  deploy fails loudly at startup instead of silently locking everyone out.
  The two auth paths are also mutually exclusive at the route level: the
  `/auth/oidc/*` routes 403 while DEV_AUTH is on, and `/auth/dev-*` routes 403
  once it's off.
- `GET /auth/mode` is a public, unauthenticated endpoint returning
  `{ devAuth: boolean }` so the web app can decide which login screen to
  render without baking the mode into the build.
- Role is not global: a person is a PL *on projects they lead* and a deliverer
  *on assignments they hold*. Authorise per-resource, not per-user-role.

### 7a. First-login onboarding
On first login (no `team_id` yet), ask **one thing: which team are you on?**
- Pick an existing team, or create one (creator becomes `is_manager = true`).
- **Do NOT ask "are you a manager or an associate?"** Everyone is both a PL and a
  deliverer. A permanent role choice would break the model.
- **Check with IT first:** the company directory / SSO may already supply team and
  manager. If it does, skip this screen entirely and populate from OIDC claims.

### 7b. Manager permissions (`is_manager = true`)
A manager may, **for their own team only**:
- set any member's `status` (Available / On vacation / Sick / Offline)
- add and remove team members
- view other teams' capacity **read-only**

- **own and edit the Sunday rota** for upcoming Sundays, and resolve swap requests (§4 Rule 2)

A manager may **not** set anyone's `evening_coverage` — that is each person's own live
toggle (§4 Rule 3). Managers see it read-only in the team panel.

Everyone else sees the team roster read-only. Enforce server-side.
When a manager sets a non-`Available` status on someone holding outstanding
profiles, **warn them** and link to the reassignment (swap) flow. This count
is deliberately **not** subject to the Pitch-exclusion bug fix in §5d: a
no-calls Pitch's profiles are still real, unsourced work someone will need to
cover if the person goes offline, even though they're excluded from `load`
and from the free/busy label. "Outstanding" and "raw remaining for free/busy"
answer different questions on purpose.

---

## 8. Screens (responsive: desktop-first, mobile-adaptive)

**Four views:** `Project Leading` · `Delivery` · `Capacity Ranking` · `First Deliverables`

### Responsive layout (§1.7)
Desktop is the primary target; mobile is a real adaptive layout, not a scaled
copy of one or the other.

**Desktop (≥1024px):**
- A persistent **left sidebar** replaces the top tab bar for the four views.
- Project cards lay out in a **fluid multi-column grid** (bug fix, three
  columns): `repeat(auto-fill, minmax(340px, 1fr))`, no hardcoded column
  count. A ~1440px laptop fits **3** across; a ~1920px monitor fits **3-4**
  (the content area caps at 1600px so it doesn't run unbounded); a smaller
  laptop (~1280px and below) drops back to **2** automatically. Card content
  is tightened to fit a narrower card: meta chips sit on a single line (the
  pool chip ellipsizes first if a long pool name won't fit), and the
  per-assignee stage/timer/back/advance row is denser (smaller chip/button
  chrome, and the timer chip no longer repeats the stage name the adjacent
  pill already shows) — still legible, it just wraps to a clean second line
  in the rare case (longest stage name + double-digit minutes) it doesn't
  fit on one.
- **Capacity Ranking** and **First Deliverables** render as dense, **sortable
  tables** (click a column header to sort), not stacked cards.
- Sheets (intake wizard, swap, notes, rota, team panel) render as **centered
  dialogs or right-hand side panels**, not mobile bottom sheets.
- Full width — no ~480px max-width cap.

**Mobile (<768px):** the original mobile-first layout — top tab bar, single
stacked column of cards, bottom sheets, and the persistent one-tap
evening-coverage toggle in the header (reachable from any screen; people flip
it at 21:00 from bed).

**768–1023px (tablet gap):** not separately designed — let the desktop
structure (sidebar, grid, tables, panels) flex down; grids reflow to fewer
columns and the sidebar may narrow, rather than falling back to the mobile
top-bar layout.

**Scope toggle (applies to every view): `My view` / `Team view`.**
- *My view* — only your own projects / assignments.
- *Team view* — everything across your team, broken out per person.
- Managers may additionally view other teams read-only.

**Profile / My Team** — an avatar button (header on mobile; sidebar on desktop)
opens the team panel: roster with each member's status, outstanding profile
count, and their (read-only) coverage flags; add/remove members. Editable only
by managers (§7b).

**Evening coverage toggle** — a persistent one-tap switch, reachable from any
screen on both breakpoints, plus a fuller card on the Delivery board with the
plain-language states in §4.

**Sunday rota screen** — a calendar of upcoming Sundays. Each date shows who's on and
how many. Managers tap to add/remove people. Non-managers see their own rostered dates
and can **request a swap** with a note, which goes to the manager to resolve.

**Sunday banner** — on Sundays, a banner telling the user whether they're on today's
rota, the headcount, and a link to view the rota.

1. **Project Leading (PL board)** — projects you lead, as cards: client/topic/type, N,
   pool (with live/asleep state), profiles progress bar, pace indicator,
   "delivered, not yet sold — chase client" flag. **(big structural change,
   §3a)** N/goal/calls_sold shown on the card are the **sum across the
   project's angles** — the card itself doesn't change for a one-angle
   project; the chase-client flag is computed **per angle then OR'd**, never
   from those summed totals (a resolved angle could otherwise mask a
   genuinely lagging one — see §3a for the worked example). **No rolled-up
   "Earliest: X" stage label** (bug 2, eight changes) — stage is
   per-deliverer, the roll-up doesn't need its own display; a project with
   nothing staffed yet still shows "Not yet staffed."
   **Assignees are grouped under their angle when a project has more than
   one; a single-angle project shows the exact same flat assignee list as
   before angles existed** — no angle chrome at all for the simple case.
   Each **assignee row** carries its own stage pill, elapsed timer, an
   **"Edit goals"** stepper for that one assignee (bug 3 — this used to be
   "swap"), and advance/back controls. **Advancing a stage prompts for a new
   goal for the new stage** (change 5) — setting it is what starts a new
   round (§3/§5b2/§5g), same mechanism as any direct goal edit; "back"
   (mis-click recovery) stays a direct action.
   Project-level actions: **"Edit team"** (bug 3 — this used to be "Edit
   goals," and actually edited goals; it now does what its name says: change
   deliverers or add new ones, picking anyone currently free including an
   override of the suggested candidate, which requires a justification and
   is audit-logged, never notified, §5g — on a multi-angle project it asks
   which angle first; silently the project's one angle otherwise), **edit
   calls sold** (PL-only, same stepper pattern, now **one stepper per angle**
   when there's more than one — **manual for now**: a PL types it in; phase
   two wires this to whatever system actually tracks sold calls, so it
   populates automatically instead), an **edit (pencil) button** opening the
   project's set-up details — client, topic, project link, type, and its
   angles (rename, add, edit an angle's N, remove an angle) — PL-only,
   enforced server-side, audit-logged (§3a), notes, archive. Pending
   goal-change requests appear as a badge + banner to resolve, and a separate
   banner prompts the PL to update calls_sold for any active led project
   with any angle that hasn't been touched yet today.
2. **Delivering (associate board)** — projects assigned to you. Your goal, your
   progress. Steppers to log **delivered** and **custom delivered** — **always
   enabled for your own assignment, at any hour, on any pool** (bug 1, eight
   changes: pool weight governs load only, never eligibility to log work).
   Shows "💤 pool asleep — goal inactive" or "⚡ pool live — double weight" per
   §4 as **information only**, never as a gate on the steppers.
   "Request goal change" (never a direct goal edit). Notes.
   Plus the **Open pool** — unmatched projects with Accept / Decline.
3. **Capacity Ranking** — everyone ranked by load, showing practice area, team,
   free/busy, raw profiles left. This is the "who gets the next project" answer.
   Sick / on-vacation / offline people are **not listed at all** (§4 Rule 1).
4. **First Deliverables** — its own tab. **Lists deliverers, not projects**
   (domain change 8): one row per assignment still on `First Deliverable`
   stage, sorted by time-in-stage (oldest first), each with its own progress
   bar and a **30 min+ · ping due** flag. If one assignee on a project has
   moved to Second Deliverable while another hasn't, only the still-on-First
   one appears here. A summary banner counts how many are overdue.
5. **New project intake (3 steps)** — (1) client, topic, N calls (**0 allowed
   for Pitch only** — a preview list with no calls agreed yet; every other
   type needs N>=1), type, pool, link → (2) suggested goal + suggested
   staffing, both PL-editable, **showing the calculation used** (§5a — which
   formula, and why, for whichever type is selected) → (3) auto-match reveal
   showing each candidate's load and why they were picked, **plus the option
   to override and pick anyone else currently free instead, with a required
   justification** (§5g, change 6) → confirm.
   **(big structural change, §3a) Angles.** By default, step 1 shows exactly
   one N input and no other angle chrome — the user sets N and moves on,
   barely aware "angle" is a concept. A **"+ Add angle"** control reveals a
   second N input plus a name field for each angle (the first angle's name
   defaults to the topic, or "Main," if never typed); only once a second
   angle exists does the angle structure become visible at all. Steps 2 and
   3 then repeat **once per angle** — each angle gets its own suggested
   goal/staffing with its own calculation shown, and its own independent
   auto-match reveal and override flow — while staying visually identical to
   the original single-section flow for the common one-angle case.

### UI requirements
- **Live Dubai time** is always visible (header on mobile, top bar on desktop);
  all logic derives from it.
- Include a **demo clock override** (scrub the hour) so the evening/pool flows can
  be demonstrated at any time of day. Dev/demo only — gate it behind a flag.
- **Contrast:** never light text on light backgrounds. Check every chip/pill/label.
- Archived projects collapse to a list with a **Resurface** action.

---

## 8a. Realtime (WebSockets) — §11 step 5

One socket per connected client, `GET /ws`, authenticated with the exact same
signed session cookie as every REST route (`app.requireAuth` runs as this
route's preHandler — an unauthenticated request never completes the upgrade,
it just gets the normal 401).

**Every message is an "invalidate" signal, never a data payload.** The server
never pushes project/person details over the socket; it pushes a tiny typed
event (`{ type: "project", projectId }`, `{ type: "capacity-ranking" }`,
`{ type: "people" }`, `{ type: "open-pool" }`, `{ type: "sunday-rota" }`) and
the client reacts by refetching via the same authorized REST endpoints it
already uses. This means the WS layer never has to duplicate REST's
authorization logic — it only has to decide **who gets notified**:

- **Project-scoped events** (goal edit, swap, stage change, progress logged,
  a goal-change request raised/resolved, project fields edited,
  archive/resurface, an open project accepted) go only to that project's PL
  and current assignees, plus every teammate of each of them — exactly the
  set that `GET /projects?scope=team` already exposes. Nobody outside that
  ever hears about it.
- **Org-wide events** (capacity ranking, the people list, the open pool, the
  Sunday rota) go to every connected client — because the equivalent REST
  endpoint is *already* unscoped by team (capacity ranking is explicitly
  org-wide per §8 screen 3; `/people` and the open-pool list carry no team
  filter either). The socket layer mirrors REST's visibility rules; it never
  invents broader ones.

**Client:** a single reconnecting WebSocket (exponential backoff, capped),
reused across the whole app. Every message — and every successful
(re)connect, which also forces a resync in case anything was missed while
disconnected (laptop sleep, wifi drop) — just bumps the same reload counter
the UI already uses after a local mutation. Whichever board is currently on
screen refetches its own already-authorized data; nothing new to authorize
client-side.

**Stage timers never hit the server for this.** The live elapsed-time display
(§6) is a client-side `setInterval` ticking against `stage_entered_at`,
completely independent of the socket; a WS-triggered refetch only updates
`stage_entered_at` when it actually changed, so the timer never visibly
jumps or resets from unrelated traffic.

---

## 8b. Notifications (moved here from §9 phase two — now built)

Two layers: **triggers** (what creates a notification) and **channels** (how
it reaches the person).

### Triggers
1. **Project assigned to you** — a PL staffs you, whether via auto-match at
   project creation or a manual swap onto an assignment.
2. **Goal-change request** — a deliverer raises one → notify the PL. When the
   PL resolves it → notify the deliverer back.
3. **30-minute stale First Deliverable** — an assignment sits in First
   Deliverable for 30+ minutes with no progress logged → notify both the
   deliverer and the PL. **This is a server-side scheduler, not a WebSocket
   event** — nobody acted, time simply passed, so nothing else could trigger
   the check. `assignment.progress_updated_at` (bumped on every delivered/
   custom_delivered write, every stage change, every new round) and
   `assignment.stale_notified_threshold_minutes` (the highest 30-min
   multiple already notified for) together ensure a given idle stretch
   produces exactly one notification per threshold — 30, then 60, then 90 —
   never a repeat, and any activity resets both.
4. **Open project up for grabs** — a project falls to the open pool (§4's
   true last resort: zero eligible people at staffing time) → notify
   everyone *currently* eligible to claim it, computed live against the same
   `isEligible()` rules auto-match itself uses (status/rota/evening-coverage
   — never restricted to the PL's own team, since eligibility never was).
5. **Delivery logged** (eight changes, change 5) — a deliverer logs progress
   → notify the PL to review. Pairs with the PL board's stage-advance flow:
   changing an assignee's stage prompts the PL for a new goal for the new
   stage, and setting that goal is what closes the current round and opens a
   new one (§3/§5b2 — previous round archived, new round starts at 0
   delivered), exactly the existing rounds mechanism, just now reachable from
   the stage-advance action too, not only a direct goal edit.

### Channels
- **In-app** — a `notification` table (person_id, type, title, body,
  entity_type/entity_id, read, created_at), surfaced as a bell with an
  unread badge. Persisted, so it survives a refresh; `PATCH
  /notifications/:id/read` and `POST /notifications/read-all` mark it read,
  always scoped to the caller's own notifications.
- **Live (tab open)** — the one WebSocket event type that carries real
  content instead of just an invalidate signal (`{ type: "notification",
  notification }`), sent only to that one person (never their team) since
  it's already fully scoped by definition. The client also raises a browser
  `Notification` popup here if permission was granted.
- **Web Push (tab closed)** — a `push_subscription` table (person_id,
  endpoint, p256dh, auth — one row per browser/device) and VAPID keys
  (`VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT`). The service
  worker's `push` event is the only thing that can show a notification with
  the tab closed; `notificationclick` focuses or opens the app. **Never
  auto-subscribes anyone** — only wired to an explicit "turn on" click in the
  notification bell, which also requests `Notification` permission first. A
  subscription that starts failing with 404/410 (browser dropped it) is
  pruned on the next send.

### PWA
A web app manifest (`manifest.webmanifest`), 192px/512px icons, and the same
service worker that handles push make the app installable to the home
screen on Android and iOS. **On iOS, push only works once the app has
actually been added to the home screen** — Safari does not deliver Web Push
to a page open in a regular browser tab, unlike Chrome/Android. Document this
prominently for users (see README).

---

## 9. Phase two — design for it, don't build it yet

Leave clean seams; do not implement now:
- **Analytics** (delivery throughput, conversion, pacing over time).
- **AI auto-fill** of project intake from the internal system, and live call-count
  sync.

---

## 10. Deliverables

1. Running app: `docker compose up` → working locally with seeded dummy data.
2. `README.md` written **for the company IT team**, stating plainly:
   - what the app is and who uses it (~50 internal users),
   - what it needs to run (a Postgres DB, an OIDC provider, these env vars),
   - how to build the container and run migrations,
   - what they must provision on AWS (container host, managed Postgres, secrets,
     TLS, the SSO app registration).
3. Migrations + a seed script (dummy data only).
4. Unit tests for §5.

---

## 10b. Visual reference

`RelayApp.jsx` (supplied alongside this spec) is a working, clickable prototype of
every screen with dummy data. It is **not production code** — it is stateless, has no
auth, and no server. Use it as the visual and interaction reference; rebuild the logic
properly per §5 on the server.

---

## 11. Build order

1. Repo skeleton, Docker Compose, Postgres, migrations, seed. Prove `up` works.
2. §5 rules engine + unit tests. **Get this right before any UI.** Test especially:
   the four availability rules kept separate (§4); custom profiles counting toward
   the goal (§5c); the practice-area soft rule (§5d); Sunday + evening stacking.
3. REST API + authorisation rules (§5e enforced server-side).
4. Screens (§8), mobile-first, with `DEV_AUTH`.
5. WebSockets for live updates.
6. **(built)** Real OIDC + the IT README.

Work in that order. Do not start the UI before the rules engine passes its tests.
