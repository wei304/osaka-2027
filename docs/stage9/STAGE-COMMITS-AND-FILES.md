# 阶段提交与完整变更文件

阶段0为架构审查；参考基线aae87d6（V1.9.1），未发现独立的阶段0代码提交。不将其当作回退目标。

发布辅助提交：V1.10：1f66592..5bff5f2；V1.11：29fbd11..bfc35b4。下列文件路径相对仓库根目录。阶段9报告及证据的最终提交以当前分支git log为准。

## 阶段1 界面减法

提交范围：`aae87d6..fbc796b`

```text
0b01ba2 Consolidate daily navigation, collections and grouped departure checks
c40fadb Default dictation off and fold speech diagnostics and AI advanced controls
4f4c9cf Keep AI questions above settings and preserve normal and slow phrase playback
e358770 Preserve bookmarked sections and deduplicate travel shortcuts without removing data paths
11240e2 Keep one visible departure entry and verify responsive navigation and opt-in input
fbc796b Document entry comparison, isolated validation, screenshots and safe rollback
```

变更文件：

```text
STAGE1-界面减法验收.md
app.js
dictation-ui.js
index.html
navigation.css
qa/browser-v14.mjs
safety-ui.js
speech.js
sw.js
travel-ui.js
ui-disclosures.js
ui-navigation.js
```

## 阶段2 离线日语

提交范围：`fbc796b..9bc9644`

```text
b18ad54 Add stable readonly phrase templates and private device library with deduplicated backups
bc7c3ed Add opt-in phrase AI with session-bound idempotency, shared metering and recoverable drafts
2d91742 Connect temporary phrase editing, current-text playback and offline local library UI
a215278 Harden local refresh and verify cross-engine AI recovery after reload
9bc9644 Document phrase semantics, 35-sample language review, validation and optional deployment
```

变更文件：

```text
PHRASE-LANGUAGE-REVIEW.md
STAGE2-离线短句验收.md
ai-client.js
index.html
package.json
phrase-ai-client.js
phrase-ai-core.js
phrase-ai-ui.js
phrase-core.js
phrase-store.js
phrase-ui.js
phrases-extra.js
phrases.css
phrases.js
qa/browser-v14.mjs
qa/migration-v192.mjs
qa/phrase-browser.mjs
speech.js
supabase/functions/ai-trip/handler.js
supabase/functions/ai-trip/index.ts
supabase/functions/ai-trip/phrases.js
supabase/v1_9_2_phrase_ai.sql
sw.js
tests/phrase-library.test.js
tests/travel.test.js
travel-ui.js
```

## 阶段3 B可靠地区

提交范围：`9bc9644..1f66592`

```text
863df52 Add conservative region aliases, city-qualified address candidates and provenance boundaries
0b5febb Add authenticated preview and atomic audited region confirmation without itinerary writes
5f84efc Add cached region review filters, per-source batch preview and recoverable mobile confirmation
d354fc9 Bound address rules to explicit neighbourhood structures and reject ambiguous city aliases
de8f1d5 Disable region recovery controls during shared cache synchronization
1f66592 Document reliable region scope, actual validation, screenshots and isolated rollout
```

变更文件：

```text
STAGE3-可靠地区核实验收.md
favorite-region-core.js
favorite-regions-ui.js
favorites-client.js
favorites-ui.js
favorites.css
package.json
qa/browser-v14.mjs
qa/migration-v193.mjs
qa/region-browser.mjs
supabase/functions/shared-trip/handler.js
supabase/functions/shared-trip/index.ts
supabase/functions/shared-trip/regions.js
supabase/v1_9_3_favorite_regions.sql
sw.js
tests/favorite-regions.test.js
```

## 阶段2快捷翻译补充

提交范围：`5bff5f2..84b39e1`

```text
80cba22 ui: put phrase translation shortcut next to Chinese text
5a257de release: bump phrase shortcut update to v1.10.1
303d952 test: preserve offline API transport failure across reload
99417ed test: apply offline transport to outgoing document too
84b39e1 Release V1.10.1: quick phrase translation entry
```

变更文件：

```text
index.html
package-lock.json
package.json
phrase-ai-ui.js
phrase-ui.js
qa/favorite-days-browser.mjs
qa/phrase-browser.mjs
sw.js
```

## 阶段4 A有限分批

提交范围：`84b39e1..25e3d11`

```text
7aff686 feat: add bounded favorite tasks over existing AI billing chain
810eac9 feat: add finite batch controls and centralized editable review
12d3cb5 fix: guard uncertain review recovery and offline task snapshots
5b3c460 test: focus simulated device before mobile navigation
25e3d11 docs: record stage4 acceptance and bounded recovery verification
```

变更文件：

```text
STAGE4-有限批量智能整理验收.md
favorite-ai-ui.js
favorite-bulk-client.js
favorite-bulk-ui.js
favorites.css
package.json
qa/browser-v14.mjs
qa/favorite-bulk-browser.mjs
qa/migration-v110-all.mjs
qa/migration-v110.mjs
supabase/functions/ai-trip/favorites.js
supabase/functions/ai-trip/handler.js
supabase/v1_10_favorite_bulk.sql
sw.js
tests/favorite-bulk.test.js
```

## 阶段5 E批量日期

提交范围：`25e3d11..ff751da`

```text
d574c0a feat: reuse date RPC in atomic offline-aware favorite batches
b75835c feat: add filtered multi-select date preview and conflict review
5ea5683 test: close browser fixture resources from one cleanup path
ff751da docs: record stage5 atomic date batch acceptance and rollback
```

变更文件：

```text
STAGE5-收藏批量日期关联验收.md
favorite-days-batch-core.js
favorite-days-batch-ui.js
favorites-client.js
favorites-core.js
favorites-ui.js
favorites.css
package.json
qa/browser-v14.mjs
qa/favorite-days-batch-browser.mjs
qa/migration-v111-all.mjs
qa/migration-v111.mjs
supabase/functions/shared-trip/handler.js
supabase/v1_11_favorite_batch_days.sql
sw.js
tests/favorite-days-batch.test.js
```

## 阶段6 D本地排序

提交范围：`ff751da..29fbd11`

```text
c7d2438 feat: add deterministic daily favorite ranking with verified local scope
fcfaad0 feat: add daily sort controls local priorities and folding
884e0bd fix: guard daily preference persistence before further changes
29fbd11 docs: record daily favorite ranking acceptance and rollout
```

变更文件：

```text
STAGE6-每日收藏本地排序验收.md
favorite-day-order-core.js
favorites-client.js
favorites-days-ui.js
favorites.css
package.json
qa/browser-v14.mjs
qa/favorite-day-order-browser.mjs
qa/migration-v112-all.mjs
qa/migration-v112.mjs
supabase/v1_12_favorite_day_sort.sql
sw.js
tests/favorite-day-order.test.js
```

## 阶段7 聊天室

提交范围：`bfc35b4..c8b12fa`

```text
9fd4405 feat(ai): add mobile chat shell with safe markdown and retained replies
f5d13d4 feat(ai): bound chat context and reuse metered requests with durable receipts
5bf4deb feat(ai): persist local conversations and embed guarded itinerary drafts
e410cee test(ai): verify chat recovery privacy and mobile regressions
c8b12fa test: make offline region regression independent of random pagination
```

变更文件：

```text
STAGE7-AI-CHAT-V2.md
ai-client.js
ai-core.js
ai-ui.js
chat-controller.js
chat-core.js
chat-markdown.js
chat-shell.js
chat-store.js
chat.css
docs/stage7/chat-v2-conversation-320-chrome.png
docs/stage7/chat-v2-conversation-390-chrome.png
docs/stage7/chat-v2-conversation-390-webkit.png
docs/stage7/chat-v2-conversation-768-chrome.png
docs/stage7/chat-v2-markdown-390-chrome.png
index.html
package-lock.json
package.json
qa/browser-v14.mjs
qa/chat-browser.mjs
qa/migration-v112-all.mjs
qa/migration-v20.mjs
qa/region-browser.mjs
supabase/functions/ai-trip/chat.js
supabase/functions/ai-trip/handler.js
supabase/functions/ai-trip/index.ts
supabase/v2_0_ai_chat.sql
sw.js
tests/chat.test.js
```

## 阶段8 旅行增强

提交范围：`c8b12fa..05e943d`

```text
2bf8c44 feat(travel): derive conservative next stops navigation and ticket scope
c14c784 feat(travel): enhance existing mode with reversible mobile dashboard
05e943d test(travel): verify mobile offline timezone and downgrade workflows
```

变更文件：

```text
STAGE8-TRAVEL-MODE-V21.md
app.js
docs/stage8/travel-v21-320-chrome.png
docs/stage8/travel-v21-360-chrome.png
docs/stage8/travel-v21-390-chrome.png
docs/stage8/travel-v21-390-webkit.png
docs/stage8/travel-v21-430-chrome.png
docs/stage8/travel-v21-768-chrome.png
docs/stage8/travel-v21-cards-chrome.png
docs/stage8/travel-v21-landscape-chrome.png
docs/stage8/travel-v21-landscape-webkit.png
index.html
package-lock.json
package.json
qa/browser-v14.mjs
qa/travel-mode-browser.mjs
sw.js
tests/travel-mode.test.js
tickets-ui.js
travel-mode-core.js
travel-mode-ui.js
travel-mode.css
```

## 阶段9 联调及待审发布

提交范围：`05e943d..HEAD`；报告最终提交以分支git log为准。

```text
2503013 test(system): exercise the full favorites chat and travel flow in one database
89711af fix(pwa): preserve coherent generations and offline queues across upgrades
c7e63e0 fix(chat): serialize conversation transitions before enabling input
808eb0b chore(release): gate candidate checks and audit deployable assets
810ff59 test(release): verify cached bytes and reproducible source hashes
```

变更文件：

```text
.github/workflows/checks.yml
.gitignore
STAGE9-SYSTEM-ACCEPTANCE.md
ai-ui.js
chat-controller.js
docs/stage9/STAGE-COMMITS-AND-FILES.md
docs/stage9/acceptance-status.json
docs/stage9/production-readonly-baseline.json
docs/stage9/pwa-upgrade-chrome.json
docs/stage9/pwa-upgrade-offline-chrome.png
docs/stage9/pwa-upgrade-offline-webkit.png
docs/stage9/pwa-upgrade-webkit.json
docs/stage9/release-audit.json
docs/stage9/system-flow.json
index.html
package-lock.json
package.json
qa/chat-browser.mjs
qa/generate-bridge.mjs
qa/live-smoke.mjs
qa/pwa-upgrade.mjs
qa/release-audit.mjs
qa/system-fixture.mjs
qa/system-flow.mjs
qa/takeout-synthetic.mjs
qa/worker-release.mjs
release/PRODUCTION-PLAN.md
release/production-preflight.sql
release/v111-bridge-sw.js
sw.js
```
