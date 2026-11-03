package com.beifa.kaoyan;

import android.Manifest;
import android.app.Activity;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.view.View;
import android.view.Window;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.MimeTypeMap;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

public class MainActivity extends Activity {
    static final String CHANNEL = "beifa";
    private static final int PICK_FILE = 1;
    private WebView web;
    private ValueCallback<Uri[]> fileCallback;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        Window w = getWindow();
        w.setStatusBarColor(Color.parseColor("#14161a"));
        w.setNavigationBarColor(Color.parseColor("#1e2127"));

        createChannel();
        cleanPicked();
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 2);
        }

        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#14161a"));
        setContentView(web);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowFileAccessFromFileURLs(true);
        s.setAllowUniversalAccessFromFileURLs(true); // 从 file:// 页面直连 DeepSeek 和电脑
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setTextZoom(100);
        web.addJavascriptInterface(new Bridge(), "Native");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                if ("file".equals(u.getScheme())) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) { }
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = cb;
                Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                String[] acc = p.getAcceptTypes();
                boolean img = acc != null && acc.length > 0 && acc[0].startsWith("image");
                i.setType(img ? "image/*" : "*/*");
                if (p.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                try {
                    // 不再套一层 createChooser：ACTION_GET_CONTENT 本身就会弹选择器，
                    // 多套一层在部分 ROM 上会让结果回不到 onActivityResult
                    startActivityForResult(i, PICK_FILE);
                } catch (Exception e) {
                    fileCallback = null;
                    return false;
                }
                return true;
            }

            @Override
            public boolean onConsoleMessage(ConsoleMessage m) { return true; }
        });
        web.loadUrl("file:///android_asset/index.html" + tabFrom(getIntent()));
    }

    private String tabFrom(Intent i) {
        String tab = i == null ? null : i.getStringExtra("tab");
        return tab == null ? "" : "#" + tab;
    }

    @Override
    protected void onNewIntent(Intent i) {
        super.onNewIntent(i);
        String tab = i.getStringExtra("tab");
        if (tab != null && web != null) {
            web.evaluateJavascript("window.openTab && openTab(" + jsString(tab) + ")", null);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.evaluateJavascript("window.onNativeResume && onNativeResume()", null);
    }

    @Override
    protected void onPause() {
        super.onPause();
        TodayWidget.refreshAll(this);
        MiniWidget.refreshAll(this);
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        if (req == PICK_FILE && fileCallback != null) {
            Uri[] r = null;
            if (res == RESULT_OK && data != null) {
                if (data.getClipData() != null) {
                    r = new Uri[data.getClipData().getItemCount()];
                    for (int k = 0; k < r.length; k++) r[k] = data.getClipData().getItemAt(k).getUri();
                } else if (data.getData() != null) r = new Uri[]{data.getData()};
            }
            if (r != null && r.length == 0) r = null;
            if (r == null && res == RESULT_OK) {
                Toast.makeText(this, "没拿到文件，请再选一次", Toast.LENGTH_SHORT).show();
            }
            // OPPO/vivo 的相册给的是 content://，WebView 渲染进程读不到（打开是空的）。
            // 先复制到 App 私有缓存，再把 file:// 交给 WebView，兼容所有来源。
            fileCallback.onReceiveValue(localize(r));
            fileCallback = null;
            return;
        }
        super.onActivityResult(req, res, data);
    }

    private Uri[] localize(Uri[] picked) {
        if (picked == null) return null;
        Uri[] out = new Uri[picked.length];
        File dir = new File(new File(getCacheDir(), "picked"), String.valueOf(System.currentTimeMillis()));
        if (!dir.exists()) dir.mkdirs();
        for (int i = 0; i < picked.length; i++) {
            Uri u = picked[i];
            if (u == null) { out[i] = null; continue; }
            if (!"content".equals(u.getScheme())) { out[i] = u; continue; }
            try {
                String name = pickName(u);
                String ext = pickExt(name, getContentResolver().getType(u));
                String safe = name == null ? "" : name.replaceAll("[\\\\/:*?\"<>|\\s]+", "_").trim();
                if (safe.isEmpty()) safe = "file";
                if (safe.length() > 48) safe = safe.substring(0, 48);
                if (!safe.toLowerCase(Locale.ROOT).endsWith(ext.toLowerCase(Locale.ROOT))) safe += ext;
                File dest = new File(dir, safe);
                if (dest.exists()) dest = new File(dir, i + "_" + safe);
                InputStream in = getContentResolver().openInputStream(u);
                if (in == null) { out[i] = u; continue; }
                try (OutputStream os = new FileOutputStream(dest)) {
                    byte[] buf = new byte[8192];
                    int n;
                    while ((n = in.read(buf)) > 0) os.write(buf, 0, n);
                } finally {
                    in.close();
                }
                out[i] = Uri.fromFile(dest);
            } catch (Exception e) {
                out[i] = u; // 复制失败就退回原 URI，至少有的机型能直接读
            }
        }
        return out;
    }

    private String pickName(Uri u) {
        try (Cursor c = getContentResolver().query(u, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                int i = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (i >= 0) {
                    String n = c.getString(i);
                    if (n != null && !n.isEmpty()) return n;
                }
            }
        } catch (Exception ignored) { }
        String p = u.getLastPathSegment();
        if (p == null) return "";
        int slash = p.lastIndexOf('/');
        return slash >= 0 ? p.substring(slash + 1) : p;
    }

    private String pickExt(String name, String mime) {
        if (name != null) {
            int dot = name.lastIndexOf('.');
            if (dot > 0 && dot < name.length() - 1) {
                String e = name.substring(dot + 1).replaceAll("[^A-Za-z0-9]", "");
                if (!e.isEmpty() && e.length() <= 8) return "." + e.toLowerCase(Locale.ROOT);
            }
        }
        if (mime != null) {
            String e = MimeTypeMap.getSingleton().getExtensionFromMimeType(mime);
            if (e != null && !e.isEmpty()) return "." + e;
        }
        return ".bin";
    }

    private void cleanPicked() {
        File[] fs = new File(getCacheDir(), "picked").listFiles();
        if (fs == null) return;
        long cutoff = System.currentTimeMillis() - 24L * 3600 * 1000;
        for (File f : fs) if (f.lastModified() < cutoff) rm(f);
    }

    private void rm(File f) {
        if (f.isDirectory()) {
            File[] cs = f.listFiles();
            if (cs != null) for (File c : cs) rm(c);
        }
        f.delete();
    }

    @Override
    public void onBackPressed() {
        web.evaluateJavascript("window.onNativeBack ? onNativeBack() : false", v -> {
            if (!"true".equals(v)) moveTaskToBack(true);
        });
    }

    private void createChannel() {
        NotificationChannel c = new NotificationChannel(CHANNEL, "计时提醒", NotificationManager.IMPORTANCE_HIGH);
        c.setDescription("40 分钟课时到点提醒");
        c.enableVibration(true);
        getSystemService(NotificationManager.class).createNotificationChannel(c);
    }

    static String sysProp(String key) {
        try {
            Class<?> c = Class.forName("android.os.SystemProperties");
            return (String) c.getMethod("get", String.class).invoke(null, key);
        } catch (Throwable e) {
            return "";
        }
    }

    static String jsString(String s) {
        StringBuilder b = new StringBuilder("\"");
        for (char ch : s.toCharArray()) {
            if (ch == '"' || ch == '\\') b.append('\\').append(ch);
            else if (ch < 0x20) b.append(String.format("\\u%04x", (int) ch));
            else b.append(ch);
        }
        return b.append('"').toString();
    }

    /** 网页通过 window.Native 调用 */
    class Bridge {
        @JavascriptInterface
        public String version() { return "1"; }

        /** 本机的局域网 IPv4 地址（逗号分隔），用来在同一网段里找电脑 */
        @JavascriptInterface
        public String ipv4() {
            StringBuilder b = new StringBuilder();
            try {
                for (java.net.NetworkInterface n : java.util.Collections.list(java.net.NetworkInterface.getNetworkInterfaces())) {
                    if (!n.isUp() || n.isLoopback()) continue;
                    for (java.net.InetAddress a : java.util.Collections.list(n.getInetAddresses())) {
                        if (a instanceof java.net.Inet4Address && a.isSiteLocalAddress()) b.append(b.length() > 0 ? "," : "").append(a.getHostAddress());
                    }
                }
            } catch (Exception e) { /* 拿不到就返回空 */ }
            return b.toString();
        }

        /** 网页推送小组件数据（JSON），存下来并刷新小组件 */
        @JavascriptInterface
        public void setWidget(String json) {
            getSharedPreferences(TodayWidget.PREFS, MODE_PRIVATE).edit().putString("data", json).apply();
            TodayWidget.refreshAll(MainActivity.this);
            MiniWidget.refreshAll(MainActivity.this);
        }

        /** 保存文件到 下载/北伐打卡/，返回给用户看的路径 */
        @JavascriptInterface
        public String saveFile(String name, String content) {
            byte[] bytes = content.getBytes(StandardCharsets.UTF_8);
            try {
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.Downloads.DISPLAY_NAME, name);
                    v.put(MediaStore.Downloads.MIME_TYPE, name.endsWith(".csv") ? "text/csv" : "application/json");
                    v.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/北伐打卡");
                    Uri u = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                    if (u == null) throw new Exception("无法创建文件");
                    try (OutputStream o = getContentResolver().openOutputStream(u)) { o.write(bytes); }
                } else {
                    File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "北伐打卡");
                    dir.mkdirs();
                    try (FileOutputStream o = new FileOutputStream(new File(dir, name))) { o.write(bytes); }
                }
                return "下载/北伐打卡/" + name;
            } catch (Exception e) {
                return "ERR " + e.getMessage();
            }
        }

        /** 存图片到 相册/Pictures/北伐打卡（Android 10+ 不需要权限），返回 content:// 地址或 "ERR ..." */
        @JavascriptInterface
        public String saveImage(String name, String base64) {
            try {
                byte[] bytes = android.util.Base64.decode(base64, android.util.Base64.DEFAULT);
                String mime = name.endsWith(".jpg") ? "image/jpeg" : "image/png";
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.Images.Media.DISPLAY_NAME, name);
                    v.put(MediaStore.Images.Media.MIME_TYPE, mime);
                    v.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/北伐打卡");
                    Uri u = getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, v);
                    if (u == null) throw new Exception("无法创建图片");
                    try (OutputStream o = getContentResolver().openOutputStream(u)) { o.write(bytes); }
                    return u.toString();
                }
                if (checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
                    runOnUiThread(() -> requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, 3));
                    return "ERR 需要存储权限，允许后再点一次";
                }
                File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES), "北伐打卡");
                dir.mkdirs();
                File f = new File(dir, name);
                try (FileOutputStream o = new FileOutputStream(f)) { o.write(bytes); }
                android.media.MediaScannerConnection.scanFile(MainActivity.this, new String[]{f.getAbsolutePath()}, new String[]{mime}, null);
                return Uri.fromFile(f).toString();
            } catch (Exception e) {
                return "ERR " + e.getMessage();
            }
        }

        /** 存到相册后调起系统分享（发微信、QQ 等） */
        @JavascriptInterface
        public String shareImage(String name, String base64) {
            String r = saveImage(name, base64);
            if (r.startsWith("ERR")) return r;
            if (!r.startsWith("content://")) return "ERR 这个系统版本只能保存，不能直接分享，去相册里发";
            Intent s = new Intent(Intent.ACTION_SEND);
            s.setType("image/*");
            s.putExtra(Intent.EXTRA_STREAM, Uri.parse(r));
            s.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            runOnUiThread(() -> { try { startActivity(Intent.createChooser(s, "分享今日打卡")); } catch (Exception ignored) { } });
            return r;
        }

        /** 计时到点提醒：App 在后台或锁屏也能响 */
        @JavascriptInterface
        public void scheduleTimer(long atMillis, String title, String body) {
            AlarmReceiver.schedule(MainActivity.this, atMillis, title, body);
        }

        @JavascriptInterface
        public void cancelTimer() { AlarmReceiver.cancel(MainActivity.this); }

        /** 自检：App 版本、系统能不能看到我们的小组件、桌面支持情况 */
        @JavascriptInterface
        public String diag() {
            org.json.JSONObject o = new org.json.JSONObject();
            try {
                android.content.pm.PackageInfo pi = getPackageManager().getPackageInfo(getPackageName(), 0);
                o.put("versionName", pi.versionName);
                o.put("versionCode", pi.getLongVersionCode());
                o.put("installer", String.valueOf(getPackageManager().getInstallSourceInfo(getPackageName()).getInstallingPackageName()));
                o.put("sdk", Build.VERSION.SDK_INT);
                o.put("device", Build.MANUFACTURER + " " + Build.MODEL);
                o.put("rom", sysProp("ro.build.version.opporom") + " / " + Build.DISPLAY);
                AppWidgetManager m = AppWidgetManager.getInstance(MainActivity.this);
                java.util.List<android.appwidget.AppWidgetProviderInfo> mine = new java.util.ArrayList<>();
                for (android.appwidget.AppWidgetProviderInfo i : m.getInstalledProviders()) {
                    if (getPackageName().equals(i.provider.getPackageName())) mine.add(i);
                }
                o.put("providersTotal", m.getInstalledProviders().size());
                o.put("ourProviders", mine.size());
                if (!mine.isEmpty()) {
                    android.appwidget.AppWidgetProviderInfo i = mine.get(0);
                    o.put("ourLabel", i.loadLabel(getPackageManager()));
                    o.put("ourMinW", i.minWidth);
                    o.put("ourMinH", i.minHeight);
                }
                o.put("pinSupported", m.isRequestPinAppWidgetSupported());
                o.put("placed", m.getAppWidgetIds(new ComponentName(MainActivity.this, TodayWidget.class)).length);
                o.put("placedMini", m.getAppWidgetIds(new ComponentName(MainActivity.this, MiniWidget.class)).length);
                StringBuilder names = new StringBuilder();
                for (android.appwidget.AppWidgetProviderInfo i : mine) names.append(i.provider.getShortClassName()).append(' ');
                o.put("ourNames", names.toString().trim());
                android.content.pm.ActivityInfo ri = getPackageManager().getReceiverInfo(
                        new ComponentName(MainActivity.this, TodayWidget.class), 0);
                o.put("receiverEnabled", ri.enabled);
                Intent home = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME);
                android.content.pm.ResolveInfo r = getPackageManager().resolveActivity(home, 0);
                o.put("launcher", r == null ? "?" : r.activityInfo.packageName);
            } catch (Throwable e) {
                try { o.put("error", e.toString()); } catch (Exception ignored) { }
            }
            return o.toString();
        }

        /** 已经放到桌面上的卡片数量 */
        @JavascriptInterface
        public int widgetCount() {
            AppWidgetManager m = AppWidgetManager.getInstance(MainActivity.this);
            return m.getAppWidgetIds(new ComponentName(MainActivity.this, TodayWidget.class)).length;
        }

        /** 弹出系统"添加到桌面"窗口。返回 ok / unsupported */
        @JavascriptInterface
        public String pinWidget() {
            try {
                AppWidgetManager m = AppWidgetManager.getInstance(MainActivity.this);
                if (!m.isRequestPinAppWidgetSupported()) return "unsupported";
                ComponentName cn = new ComponentName(MainActivity.this, TodayWidget.class);
                boolean known = false;
                for (android.appwidget.AppWidgetProviderInfo i : m.getInstalledProviders()) {
                    if (cn.equals(i.provider)) known = true;
                }
                if (!known) return "notregistered";
                Intent cb = new Intent(MainActivity.this, TodayWidget.class).setAction(TodayWidget.PINNED);
                PendingIntent pi = PendingIntent.getBroadcast(MainActivity.this, 3, cb,
                        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
                final boolean[] ok = {false};
                final Throwable[] err = {null};
                java.util.concurrent.CountDownLatch done = new java.util.concurrent.CountDownLatch(1);
                runOnUiThread(() -> {
                    try { ok[0] = m.requestPinAppWidget(cn, null, pi); } catch (Throwable t) { err[0] = t; }
                    done.countDown();
                });
                done.await(3, java.util.concurrent.TimeUnit.SECONDS);
                if (err[0] != null) return "ERR " + err[0];
                return ok[0] ? "ok" : "refused";
            } catch (Throwable t) {
                return "ERR " + t;
            }
        }

        /** 打开本应用的系统设置页（耗电、通知、权限） */
        @JavascriptInterface
        public void openAppSettings() {
            Intent i = new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.parse("package:" + getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
        }

        @JavascriptInterface
        public void toast(String msg) {
            runOnUiThread(() -> Toast.makeText(MainActivity.this, msg, Toast.LENGTH_SHORT).show());
        }
    }
}
