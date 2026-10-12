
## Important npm registry note

This package uses the public npm registry. If npm was previously configured differently, run `FIX-NPM-WINDOWS.bat` once or execute:

```powershell
npm config set registry https://registry.npmjs.org/
npm install --no-audit --no-fund
```

# PPlus.Arz — React + Node.js + MySQL

نسخه بازسازی‌شده PPlus.Arz برای **Node.js 24.16.0** و **npm 11.13.0**.

## تکنالوژی‌ها

- Frontend: React 19 + Vite 8
- Backend: Node.js 24 + Express 5
- Real-time: Socket.io
- Database: MySQL 8 / MariaDB سازگار با XAMPP
- ORM و تراکنش‌ها: Sequelize + MySQL transactions
- زبان‌ها: دری، پښتو و English

دیزاین صفحه ورود، لوگو، رنگ‌بندی و ساختار صفحات نسخه اصلی حفظ شده است.

## ویژگی‌های سیستم

- مشتریان و معلومات هویتی
- حساب مشتری، رسید، پرداخت و مانده هر ارز
- ارزها و ارز مبنا
- نرخ خرید، فروش و نرخ ویژه
- خرید ارز، فروش ارز و تبدیل ارز
- محاسبه خودکار مبلغ و کارمزد
- صندوق‌ها، شعبه‌ها و موجودی چندارزی
- حواله بین شعبه‌ها با رمز پرداخت
- روزنامچه حسابداری و سند دوطرفه
- گزارش‌ها و خروجی CSV
- رسید چاپی و برگشت معامله
- کارمندان، نقش‌ها و صلاحیت‌ها
- Audit Log و Socket.io برای تازه‌سازی زنده

## اجرای پروژه در VS Code

### 1. MySQL را روشن کنید

در XAMPP Control Panel مقابل **MySQL** روی Start بزنید.

### 2. پروژه را در VS Code باز کنید

باید فولدری را باز کنید که فایل `package.json`، فولدر `server` و فولدر `frontend` داخل آن است.

### 3. نصب پکیج‌ها

فقط از فولدر اصلی پروژه اجرا کنید:

```powershell
npm install
```

این پروژه از npm workspaces و فقط یک `package-lock.json` استفاده می‌کند. داخل `frontend` یا `server` دوباره `npm install` اجرا نکنید.

### 4. تنظیم MySQL

فایل `server/.env` برای XAMPP بدون رمز از قبل آماده است:

```env
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=zarin_hesab
DB_USER=root
DB_PASSWORD=
```

اگر MySQL رمز دارد، آن را در `DB_PASSWORD` بنویسید.

### 5. ساخت دیتابیس واقعی MySQL

```powershell
npm run db:setup
```

این دستور دیتابیس `zarin_hesab`، تمام جدول‌ها، ارزها، شعبه مرکزی، صندوق مرکزی و مدیر اولیه را می‌سازد.

### 6. اجرای Frontend و Backend

```powershell
npm run dev
```

آدرس‌ها:

- Frontend: http://localhost:5173
- Backend API: http://localhost:5000/api
- Health: http://localhost:5000/api/health

ورود اولیه:

```text
Username: admin
Password: 12345678
```

## اجرای آسان در Windows

بار اول:

```text
SETUP-WINDOWS.bat
```

دفعات بعد:

```text
RUN-WINDOWS.bat
```

## نسخه نصبی قابل‌حمل (بدون وابستگی به Node سیستم)

برای مشتریانی که نسخه Node ویندوزشان با پروژه یکی نیست، بستهٔ portable بسازید:

```text
BUILD-PORTABLE-WINDOWS.bat
```

یا:

```powershell
npm run pack:portable
```

خروجی:

- `release\PPlusArz-Portable\` — فولدر آماده نصب
- `release\PPlusArz-Portable.zip` — برای کپی به سیستم دیگر

روی سیستم مشتری فقط MySQL لازم است. Node داخل بسته است:

1. `INSTALL.bat` (بار اول)
2. `RUN.bat` (هر بار)
3. باز کردن http://localhost:5001

## فایل نصبی Windows (Setup.exe)

برای ساخت فایل نصب با آیکن برنامه و رمز نصب:

```text
BUILD-INSTALLER-WINDOWS.bat
```

یا:

```powershell
npm run pack:installer
```

خروجی: `release\PPlus.Arz-Setup-3.0.0.exe`

- نام میانبر دسکتاپ و منوی استارت: **PPlus.Arz**
- آیکن از `zarin-logo.png`
- نصب فقط با رمز نصب (هنگام ساخت ست می‌شود) و محتویات Setup رمزنگاری شده است
- روی لپ‌تاپ مشتری Node لازم نیست؛ فقط MySQL/XAMPP
- بعد از نصب، `PPlus.Arz.exe` را باز کنید (پنجره کوچک باز می‌ماند و مرورگر را باز می‌کند)

## انتقال اطلاعات نسخه Laravel

فایل اطلاعات قبلی داخل پروژه موجود است. برای انتقال بدون پاک‌کردن جدول‌های دارای اطلاعات:

```powershell
npm run db:import-legacy
```

برای جایگزینی داده‌های جدول‌ها با داده قدیمی:

```powershell
npm run db:import-legacy:force
```

یا فایل زیر را اجرا کنید:

```text
IMPORT-OLD-DATA-WINDOWS.bat
```

## فایل SQL کامل

فایل زیر شامل ساختار واقعی MySQL و اطلاعات موجود نسخه قبلی است:

```text
database/zarin_hesab_full.sql
```

برای واردکردن آن با Node.js:

```powershell
npm run db:import-sql
```

همچنین می‌توانید این فایل را مستقیماً از phpMyAdmin وارد کنید.

## تست و Build

```powershell
npm test
npm run build
```

یا هر دو با یک دستور:

```powershell
npm run check
```

## نکته مهم

تمام دستورهای npm را از **فولدر اصلی پروژه** اجرا کنید. مسیر ترمینال باید شبیه این باشد:

```text
E:\pplus-arz-node24-mysql>
```

## UI layout fix (v3.1)

This package includes the corrected dashboard layout:

- Fixed RTL desktop grid so the sidebar remains 300px on the right and content uses the remaining width.
- Added a separate LTR layout for English.
- Rebuilt responsive behavior for desktop, tablet, and mobile.
- Replaced the checkerboard logo asset with a clean transparent logo.
- Restyled dashboard cards, balances, and recent transactions without changing accounting APIs.
