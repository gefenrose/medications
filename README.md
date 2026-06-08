# מעקב תרופות – דיור מוגן

מערכת PWA לניהול וחלוקת תרופות לדיירי דיור מוגן.  
Hebrew RTL, works offline, installable on iOS & Android.

## העלאה ל-GitHub Pages

```bash
git init
git add .
git commit -m "init"
git branch -M main
git remote add origin https://github.com/<username>/medications
git push -u origin main
```

לאחר מכן: Settings → Pages → Source: `main` / `root`  
האפליקציה תהיה זמינה בכתובת: `https://<username>.github.io/medications/`

## כניסה לדגמה

| תפקיד | שם משתמש | סיסמה |
|-------|-----------|--------|
| מנהל | admin | 1234 |
| מדריכה | sarah | 1234 |
| מדריכה | rachel | 1234 |
| מדריכה | miriam | 1234 |

## התקנה כאפליקציה

**iOS Safari:** שתף ← הוסף למסך הבית  
**Android Chrome:** תפריט ← הוסף למסך הבית (או באנר אוטומטי)

## מבנה הקבצים

```
index.html      — האפליקציה המלאה
manifest.json   — PWA manifest
sw.js           — Service Worker (תמיכה אופליין)
icons/
  icon-192.png
  icon-512.png
README.md
```

## נתונים

כל הנתונים נשמרים ב-`localStorage` של הדפדפן.  
לגיבוי: ייצוא PDF דרך לשונית "ייצוא" בממשק המנהל.
