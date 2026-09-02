# Post-Rename Integrity Check — ForgeOS

**Date:** 2026-09-02  
**Canonical path:** `C:\Apps\ForgeOS`  
**Previous path:** `C:\Apps\cursor-agent-os`  
**Scope:** Read-only verification — no code changes, no git init, no delete, no commit/push/release.

---

## Verdict: **NOT READY**

---

## 1. اكتمال النسخة (`ForgeOS` vs `cursor-agent-os`)

| المقياس | النتيجة |
|---------|---------|
| الملفات | **565** في كل مجلد |
| المجلدات | **207** في كل مجلد |
| ملفات موجودة في أحد المجلدين فقط | **0** |
| اختلاف محتوى (SHA256) | **1 ملف فقط**: `release\checksums.json` |

الفرق الوحيد في `checksums.json` هو حقل `generated_at` فقط (توقيت مختلف بسبب تشغيل `validate-release` من `ForgeOS` أثناء الفحص). باقي الـ artifacts متطابقة.

**الخلاصة:** `C:\Apps\ForgeOS` نسخة كاملة ومتطابقة عمليًا مع المجلد القديم. الهيكل العلوي متطابق (`.cursor`, `.cursor-plugin`, `adapters`, `bootstrap`, `policy`, `runtime`, `release`, `tests`, …).

---

## 2. Git — **Blocker**

| الموقع | `.git` موجود؟ |
|--------|---------------|
| `C:\Apps\ForgeOS` | **لا** |
| `C:\Apps\cursor-agent-os` | **لا** |
| `C:\Apps` (parent) | **لا** |

**من `C:\Apps\ForgeOS`:**

```
git rev-parse --show-toplevel
→ fatal: not a git repository (or any of the parent directories): .git

git status
→ fatal: not a git repository (or any of the parent directories): .git
```

**السبب:** لا يوجد مجلد `.git` ولا gitfile ولا worktree metadata في أي من المسارين. يوجد `.gitignore` و `.gitattributes` و `.github/` لكن **بدون repository فعلي على القرص**.

**معيار القرار:** غياب Git metadata في `ForgeOS` = blocker. لم يُجرَ `git init` ولا re-clone ولا أي إصلاح تلقائي.

---

## 3. `ForgeOS.code-workspace`

**صالح** — JSON يُ parse بنجاح:

- Root واحد: `"name": "ForgeOS"`, `"path": "."`
- Excludes لـ `release/dist/**` و `node_modules/**`

**مسار الملف:**

```
C:\Apps\ForgeOS\ForgeOS.code-workspace
```

---

## 4. التكوين والمراجع

| العنصر | الحالة |
|--------|--------|
| `FORGEOS_DEV_ROOT` | يُقرأ من env عبر `policy/identity.mjs` — لا hardcode لمسار قديم |
| Install manifest | `%USERPROFILE%\.cursor\agent-os\install.json` → `"plugin_root": "C:/Apps/ForgeOS"` ✓ |
| Plugin root resolution | `C:\Apps\ForgeOS` (source: `user_install_manifest`) ✓ |
| Runtime / policy / distribution | `product_id: forgeos`, `repository: forgeos`, `plugin_id: cursor-agent-os` (legacy adapter ID — مقصود) ✓ |
| Cursor adapter | `adapters/cursor/manifest.json` → `product: forgeos`, `plugin_id: cursor-agent-os` ✓ |

### مراجع `C:\Apps\cursor-agent-os`

**مراجع غير مقصودة في active source:** **لا يوجد**

المراجع الموجودة مقصودة أو مسموحة:

- `cursor-agent-os` كـ legacy/plugin ID
- compatibility environment variables
- frozen historical release artifacts (`release/dist/cursor-agent-os-1.0.0/`)
- historical documentation (PHASE 11–17)
- tests كـ guard assertions (`tests/runtime-integration.test.mjs`, `tests/plugin-portability.test.mjs`)
- `scripts/release/validate-release.mjs` كـ forbidden pattern scanner

---

## 5. الاختبارات

| Test | Result |
|------|--------|
| `npm run test:branding` | 7/7 PASS |
| `npm run test:plugin` | 7/7 PASS |
| `npm run test:runtime` | 10/10 PASS |
| `npm run test:migration` | 5/5 PASS |
| `npm run test:neutrality` | 5/5 PASS |
| `npm run validate-release` | **READY** (0 blocked, 1 warn: speed-flexy في docs/historical) |

---

## 6. لماذا NOT READY؟

1. **Git metadata مفقودة من `C:\Apps\ForgeOS`** — blocker صريح. لا يمكن `git status` ولا `git rev-parse` ولا أي عمليات git من المسار الجديد.
2. المجلد القديم **لا يحتوي Git أيضًا** — حذفه لن يفقد `.git` موجود في `ForgeOS`، لكن **المشروع ككل ليس git-backed محليًا** حتى بعد الحذف.
3. `release\checksums.json` يختلف timestamp بين المجلدين (تافه، ليس blocker للحذف).

---

## 7. قبل أن تصبح READY TO DELETE OLD FOLDER

1. **استعد `.git`** — re-clone من remote، أو انسخ `.git` من مصدر موثوق، أو `git init` + remote (يدويًا).
2. تحقق أن `git rev-parse --show-toplevel` يُرجع `C:\Apps\ForgeOS`.
3. أغلق workspace على `cursor-agent-os` ثم احذف `C:\Apps\cursor-agent-os` يدويًا.

---

## 8. ما لم يُنفَّذ (حسب التعليمات)

- لم يُحذف `C:\Apps\cursor-agent-os`
- لم يُعدَّل أي ملف (باستثناء إنشاء هذا التقرير)
- لم يُنشأ commit أو push أو release
- لم يُجرَ `git init` ولا re-clone ولا أي إصلاح git تلقائي
