# تكامل Electron — نظام الحسابات والإدارة المالية للمزرعة

## الحالة الحالية

في بيئة Bolt (متصفح): يعمل التطبيق بقاعدة بيانات PGlite (Postgres WASM) محفوظة في IndexedDB — حفظ محلي حقيقي دون إنترنت.

في بيئة Windows الإنتاجية: يستخدم التطبيق Electron + better-sqlite3 كقاعدة بيانات محلية.

## البنية

```
electron/
  src/
    main.js      — العملية الرئيسية (نافذة التطبيق + IPC + قاعدة البيانات)
    preload.js   — جسر آمن بين الواجهة و Node.js
  package.json   — إعدادات Electron + electron-builder
```

## مواقع البيانات على Windows

- قاعدة البيانات: `%APPDATA%/FarmAccounting/Database/farm.db`
- النسخ الاحتياطية: `%APPDATA%/FarmAccounting/Backups/`

هذه المجلدات **خارج** مجلد التثبيت فلا تضيع البيانات عند التحديث.

## لبناء ملف تثبيت Windows EXE

### المتطلبات على جهاز Windows:
1. Node.js 18+ 
2. تثبيت اعتمادات المشروع:
   ```bash
   npm install
   cd electron && npm install
   ```

2. إضافة better-sqlite3:
   ```bash
   npm install better-sqlite3
   ```

3. تعديل `electron/src/main.js` لتفعيل better-sqlite3 (الكود موجود كتعليقات).

4. تعديل `src/db/db.ts` لاستخدام IPC بدلًا من PGlite في بيئة Electron.

5. بناء ملف التثبيت:
   ```bash
   cd electron
   npm run build:win
   ```

6. النتيجة في مجلد `electron/release/` — ملف `.exe` قابل للتثبيت.

## ملاحظات

- يجب توفير أيقونة التطبيق في `public/icon.png` (256x256 على الأقل).
- التطبيق يعمل دون إنترنت بالكامل بعد التثبيت.
- البيانات محفوظة محليًا في AppData ولا تعتمد على أي خدمة سحابية.
