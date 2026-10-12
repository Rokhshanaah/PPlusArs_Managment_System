# راه‌اندازی اثر انگشت واقعی ZKTeco ZK4500

این نسخه صفحه کارت‌خوان را برای اسکن واقعی ZK4500 آماده می‌کند. مرورگر مستقیماً USB/DLL را نمی‌خواند؛ بنابراین `ZKTecoBridge.exe` بین React و ZKFinger SDK قرار دارد.

## 1) وضعیت دستگاه
در Device Manager باید `ZK4500` بدون علامت زرد دیده شود. Demo رسمی ZKTeco باید بتواند تصویر اثر انگشت را بگیرد و Register / Identify 1:N انجام دهد.

## 2) DLL رسمی SDK
فایل x86 زیر لازم است:

`ZKFinger Standard SDK 5.3.0.33\C#\lib\x86\libzkfpcsharp.dll`

آن را در مسیر زیر قرار بده:

`bridge\ZKTecoBridge\sdk\libzkfpcsharp.dll`

یا `AUTO-COPY-ZK4500-SDK.bat` را اجرا کن تا در Downloads دنبال نسخه x86 بگردد.

## 3) Build Bridge

`BUILD-ZK4500-BRIDGE.bat`

اگر موفق باشد باید `BUILD SUCCESS` ببینی و این فایل ساخته شود:

`bridge\ZKTecoBridge\bin\Release\ZKTecoBridge.exe`

## 4) اجازه پورت (فقط بار اول)
فایل زیر را با **Run as administrator** اجرا کن:

`bridge\ZKTecoBridge\INSTALL-ZK4500-BRIDGE-AS-ADMIN.bat`

این فایل URLACL پورت 18181 را ثبت می‌کند، Bridge را Build می‌کند و اجرا می‌کند.

## 5) تست Bridge
در Chrome باز کن:

`http://127.0.0.1:18181/health`

باید `ok: true` ببینی.

## 6) اجرای نرم‌افزار
در یک پنجره PowerShell:

```powershell
npm install
npm run dev
```

و Bridge را در پنجره جدا باز نگه دار:

`START-ZK4500-BRIDGE.bat`

## رفتار صفحه کارت‌خوان

### شناسایی
روی **شناسایی اثر انگشت** بزن و انگشت را روی ZK4500 بگذار. Template واقعی توسط SDK گرفته می‌شود و با Templateهای ثبت‌شده Match می‌شود. اگر پیدا شود، پروفایل کامل مشتری باز می‌شود.

### ثبت شخص جدید
روی **ثبت اثر انگشت شخص جدید** بزن. SDK چند نمونه می‌گیرد و Template ثبت تولید می‌کند. سپس معلومات شخص و تراکنش را ذخیره کن. Template در MySQL ذخیره می‌شود.

### ثبت دوباره
قبل از ثبت جدید، Match انجام می‌شود. اگر انگشت قبلاً ثبت شده باشد، سیستم شخص موجود را نمایش می‌دهد و Template جدید برای شخص دیگر ذخیره نمی‌کند.

### شماره کارت
شماره کارت را وارد کن یا Enter بزن. سیستم شماره را نرمال می‌کند (فاصله و `-` را نادیده می‌گیرد) و اگر پیدا شود معلومات کامل شخص را نشان می‌دهد.

## نکته امنیتی
Fingerprint image فقط برای preview است. شناسایی بر اساس تصویر یا Hash تصویر انجام نمی‌شود؛ Matching واقعی با Template و الگوریتم ZKFinger SDK انجام می‌شود.
