# P4 End-to-End Walkthrough

> Tested: 2026-10-06, main branch, no API key mode, curl + real server.
> Server: `OPENMIMIC_DB=/tmp/test.db PORT=7891 npx tsx server/src/main.ts`

## Step-by-step results

| # | Step | Method | Result | Notes |
|---|------|--------|--------|-------|
| 1 | Homepage (/) | GET / | PASS | SPA index.html served; InviterView renders with demo card + create form |
| 2 | Create subject | POST /api/subjects | PASS | Returns `{id, displayName}` |
| 3 | Create invite | POST /api/subjects/:id/invites | PASS | Returns `{token, url, expiresAt}`. `url` is relative by default; with `OPENMIMIC_PUBLIC_URL` it is absolute |
| 4 | Open invite page (/i/:token) | GET /i/:token | PASS | SPA fallback serves index.html; InterviewView loads |
| 5 | Resolve invite (friend) | GET /api/invites/:token | PASS | Returns subject name + questionnaire (10 questions) |
| 6 | Submit testimony (friend 1) -- quotable, skip q3 | POST /api/invites/:token/testimony | PASS | Returns `{witnessId, testimonyId, count: 1}` |
| 7 | Submit testimony (friend 2) -- synthesis_only | POST (new invite token) | PASS | count: 2 |
| 8 | Submit testimony (friend 3) -- quotable, family | POST (new invite token) | PASS | count: 3 |
| 9 | Check progress | GET /api/subjects/:id/progress | PASS | `{testimonyCount: 3, witnessCount: 3}` |
| 10 | Meta-perception: get questions | GET /api/subjects/:id/meta/questions | PASS | Returns 5 qids + witness list |
| 11 | Meta-perception: submit predictions | POST /api/subjects/:id/meta/predictions | PASS | Locks predictions |
| 12 | Meta-perception: score (no key) | POST /api/subjects/:id/meta/score | NEEDS_MODEL | Returns 501 -- correct behavior, needs LLM |
| 13 | Run court (no key) | POST /api/subjects/:id/court | PASS (501) | Clear message: "服务器未配置语言模型" |
| 14 | Open room (no key) | POST /api/subjects/:id/rooms | PASS (501) | Clear message: "服务器未配置语言模型" |
| 15 | View court report page (/court/:id) | GET /court/:id | PASS | Page loads; shows "no claims" when court hasn't run |
| 16 | View room page (/room/:id) | GET /room/:id | PASS | Loads; shows "not found" for non-existent room |
| 17 | Demo room (Lin Mo) | GET /api/rooms/:id | PASS | Pre-seeded room loads; behind transcript plays |
| 18 | Push door on demo room | POST /api/rooms/:id/door | PASS | Returns room with front transcript |
| 19 | Export .persona | GET /api/subjects/:id/export | PASS | Returns valid persona package (v2) |
| 20 | Import .persona (second DB) | POST /api/import | PASS | Creates new subject with "(导入)" suffix |
| 21 | Gate: contested claims | GET /api/subjects/:id/contested | PASS | Returns empty list (no court run) |
| 22 | Silence signals | GET /api/subjects/:id/silence-signals | PASS | Returns empty list |
| 23 | List subjects | GET /api/subjects | PASS | Returns all subjects |

## Access control

| Scenario | Result |
|----------|--------|
| No OPENMIMIC_ADMIN_TOKEN: server binds 127.0.0.1 only | PASS |
| With OPENMIMIC_ADMIN_TOKEN: server binds 0.0.0.0 | PASS |
| Admin route without token -> 401 | PASS |
| Admin route with wrong token -> 401 | PASS |
| Admin route with correct Bearer token -> 200/201 | PASS |
| Admin route with ?_token=... -> 200/201 | PASS |
| Invite routes without admin token -> 200/201 | PASS |
| Health check without token -> 200 | PASS |
| /v1/models without admin token -> 401 | PASS |

## Rate limiting

| Scenario | Result |
|----------|--------|
| 30+ rapid POST /api/invites/:token/testimony -> 429 after 30 | PASS |

## UI navigation

| From | To | Method | Status |
|------|----|--------|--------|
| InviterView (/) | Create subject | Button "生成邀请链接" | PASS |
| InviterView | Copy invite link | Button "复制链接" | PASS |
| InviterView | Open room | Button in room list | PASS |
| InviterView | Run court | Button "开审" | PASS (added in P4) |
| InviterView | Court report | Button "查看报告" | PASS (added in P4) |
| InviterView | Meta-perception | Button "元知觉" | PASS (added in P4) |
| InviterView | Demo room | Button "走进这间房" | PASS |
| CourtReportView | Back to home | Button "首页" | PASS (added in P4) |
| RoomView | Contrast view | Button "对照" | PASS (after push door) |

## Breakpoints found and fixed

1. **Gate/silence-signal/meta-perception plugins not loaded by HTTP server** -- routes returned 404. Fixed: added to plugin-resolver.ts and server.ts useNames.
2. **No UI to run court or view report from InviterView** -- Fixed: added "开审", "查看报告", "元知觉" buttons.
3. **No access control** -- Fixed: OPENMIMIC_ADMIN_TOKEN environment variable; 127.0.0.1-only when unset.
4. **No rate limiting** -- Fixed: in-memory fixed-window rate limiter on submission routes.
5. **No navigation back from court report** -- Fixed: added "首页" back button.
6. **Invite URL always relative** -- Fixed: respects OPENMIMIC_PUBLIC_URL environment variable.
7. **No GET /api/subjects endpoint** -- Fixed: added list subjects route.

## Bug fix: buildNoTalkListFallback

The `topic` field was derived from `factText.substring(0, 30)` which captured the preceding sentence (context) rather than the marker sentence (the actual secret). The `keywords` field was always empty `[]`.

Fixed: `topic` now comes from the marker sentence itself; `keywords` are populated from extractFactElements (amounts, verbs, nouns). Two new tests verify this.

## Items requiring a real model (leave for main controller)

- [ ] Run court with LLM and verify claims, episodes, divergences
- [ ] Meta-perception scoring (POST /api/subjects/:id/meta/score)
- [ ] Open a non-demo room with LLM and verify behind/front transcript
- [ ] Push door on a non-demo room
- [ ] Verify LLM-based no-talk list generation (vs the rule-based fallback tested here)
- [ ] Verify interview AI follow-up questions
- [ ] Verify OpenAI-compatible chat endpoint with persona (POST /v1/chat/completions)

## Pre-demo checklist

### Must have (blocking demo)

- [x] Subject creation works from UI
- [x] Invite link generation works (with public URL for remote friends)
- [x] Friends can fill interview and submit (mobile browser)
- [x] Operator can see testimony count live
- [x] Court, room, and door APIs return clear "needs model" when unconfigured
- [x] Access control: admin token protects management routes
- [x] Rate limiting: submission routes protected
- [x] Gate/silence-signal/meta-perception routes work
- [x] Navigation: operator can reach court report, meta-perception, rooms from home page
- [ ] Configure LLM (fill .env with real provider)
- [ ] Verify court + room with real model (see items above)
- [ ] Deploy to public server (Docker or systemd)
- [ ] Set OPENMIMIC_PUBLIC_URL for invite links
- [ ] HTTPS (reverse proxy with TLS termination)

### Nice to have

- [ ] QR code for invite link (needs `qrcode` dependency -- not added)
- [ ] Export .persona download button in UI
- [ ] Mobile-specific polish for contrast view (two-column may be tight on phones)
- [ ] Notification when new testimony arrives (currently polling every 10s)

### Can wait

- [ ] GraphEngine (planned, no code)
- [ ] Multi-tenancy / accounts
- [ ] Parallel organization (multi-room cascade)
- [ ] Plugin marketplace
- [ ] Community persona package distribution
