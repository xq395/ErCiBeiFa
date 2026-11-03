package com.beifa.kaoyan;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.Locale;

/**
 * 桌面小组件：当天课表 + 各科下一课时。数据由网页通过 Native.setWidget 推送，
 * 格式见 web/native.js 的 widgetData()。这里只负责按当前时间挑出"正在上/下一节"并显示。
 */
public class TodayWidget extends AppWidgetProvider {
    static final String PREFS = "widget";
    static final String REFRESH = "com.beifa.kaoyan.REFRESH";
    static final String PINNED = "com.beifa.kaoyan.PINNED";
    private static final int MAX_ROWS = 5;

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) mgr.updateAppWidget(id, build(ctx, mgr.getAppWidgetOptions(id)));
        scheduleNext(ctx);
    }

    @Override
    public void onAppWidgetOptionsChanged(Context ctx, AppWidgetManager mgr, int id, Bundle opts) {
        mgr.updateAppWidget(id, build(ctx, opts));
    }

    @Override
    public void onReceive(Context ctx, Intent i) {
        super.onReceive(ctx, i);
        if (REFRESH.equals(i.getAction())) refreshAll(ctx);
        if (PINNED.equals(i.getAction())) {
            refreshAll(ctx);
            android.widget.Toast.makeText(ctx, "已添加到桌面", android.widget.Toast.LENGTH_SHORT).show();
        }
    }

    static void refreshAll(Context ctx) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        int[] ids = mgr.getAppWidgetIds(new ComponentName(ctx, TodayWidget.class));
        for (int id : ids) mgr.updateAppWidget(id, build(ctx, mgr.getAppWidgetOptions(id)));
        if (ids.length > 0) scheduleNext(ctx);
    }

    private static PendingIntent open(Context ctx, String tab, int req) {
        Intent i = new Intent(ctx, MainActivity.class);
        i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        if (tab != null) i.putExtra("tab", tab);
        return PendingIntent.getActivity(ctx, req, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static String today() {
        Calendar c = Calendar.getInstance();
        // 小组件按日历日期，0 点切换（打卡记录在网页里另算，4 点切换）
        return new SimpleDateFormat("yyyy-MM-dd", Locale.CHINA).format(c.getTime());
    }

    private static String nowHM() {
        return new SimpleDateFormat("HH:mm", Locale.CHINA).format(new Date());
    }

    static RemoteViews build(Context ctx, Bundle opts) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget);
        v.setOnClickPendingIntent(R.id.w_root, open(ctx, "tt", 0));
        v.setOnClickPendingIntent(R.id.w_head, open(ctx, "today", 1));

        int rowIds[] = {R.id.w_r0, R.id.w_r1, R.id.w_r2, R.id.w_r3, R.id.w_r4};
        int timeIds[] = {R.id.w_t0, R.id.w_t1, R.id.w_t2, R.id.w_t3, R.id.w_t4};
        int nameIds[] = {R.id.w_n0, R.id.w_n1, R.id.w_n2, R.id.w_n3, R.id.w_n4};
        int subIds[] = {R.id.w_s0, R.id.w_s1, R.id.w_s2, R.id.w_s3, R.id.w_s4};
        for (int r : rowIds) v.setViewVisibility(r, View.GONE);

        // 小组件高度不够时少显示几行
        int maxRows = MAX_ROWS;
        if (opts != null) {
            int h = opts.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0);
            if (h > 0) maxRows = Math.max(1, Math.min(MAX_ROWS, (h - 70) / 34));
        }

        String raw = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("data", null);
        String d = today();
        JSONObject day = null;
        JSONObject all = null;
        try {
            if (raw != null) {
                all = new JSONObject(raw);
                JSONObject days = all.optJSONObject("days");
                if (days != null) day = days.optJSONObject(d);
            }
        } catch (Exception ignored) { }

        if (day == null) {
            v.setTextViewText(R.id.w_title, "北伐打卡");
            v.setTextViewText(R.id.w_sub, raw == null ? "打开一次 App 就会显示今日课表" : "今天的数据还没生成，点一下打开");
            v.setTextViewText(R.id.w_stat, "");
            v.setViewVisibility(R.id.w_empty, View.VISIBLE);
            v.setTextViewText(R.id.w_empty, "点击进入");
            return v;
        }
        v.setViewVisibility(R.id.w_empty, View.GONE);
        v.setTextViewText(R.id.w_title, day.optString("title", d));
        v.setTextViewText(R.id.w_stat, day.optString("stat", ""));

        String now = nowHM();
        JSONArray items = day.optJSONArray("items");
        int shown = 0, start = 0;
        if (items != null) {
            // 跳过已经结束的项，至少保留"正在进行"那一条
            for (int i = 0; i < items.length(); i++) {
                JSONObject it = items.optJSONObject(i);
                if (it != null && it.optString("to").compareTo(now) > 0) { start = i; break; }
                start = items.length();
            }
            for (int i = start; i < items.length() && shown < maxRows; i++) {
                JSONObject it = items.optJSONObject(i);
                if (it == null) continue;
                boolean on = it.optString("from").compareTo(now) <= 0 && it.optString("to").compareTo(now) > 0;
                boolean free = "free".equals(it.optString("kind"));
                v.setViewVisibility(rowIds[shown], View.VISIBLE);
                v.setTextViewText(timeIds[shown], it.optString("from"));
                v.setTextViewText(nameIds[shown], (on ? "▶ " : "") + it.optString("name"));
                v.setTextColor(nameIds[shown], free ? 0xFF6CC98A : (on ? 0xFFE0A84F : 0xFFE6E8EB));
                v.setTextViewText(subIds[shown], it.optString("sub"));
                v.setOnClickPendingIntent(rowIds[shown], open(ctx, free ? "today" : "tt", 10 + shown));
                shown++;
            }
        }
        if (shown == 0) {
            v.setViewVisibility(R.id.w_empty, View.VISIBLE);
            v.setTextViewText(R.id.w_empty, items == null || items.length() == 0 ? "今天没课 · 点击开始学习" : "今天的课都上完了 · 点击打卡");
        }
        String sub = day.optString("next", "");
        v.setTextViewText(R.id.w_sub, sub);
        return v;
    }

    /** 在下一个"开始/结束"时间点刷新一次，让"正在上"自动往下走；没有就第二天 04:05 刷新 */
    static void scheduleNext(Context ctx) {
        AlarmManager am = ctx.getSystemService(AlarmManager.class);
        Intent i = new Intent(ctx, TodayWidget.class).setAction(REFRESH);
        PendingIntent pi = PendingIntent.getBroadcast(ctx, 0, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        long next = nextBoundary(ctx);
        am.set(AlarmManager.RTC, next, pi); // 非精确：省电，晚几分钟无所谓
    }

    private static long nextBoundary(Context ctx) {
        Calendar now = Calendar.getInstance();
        long best = Long.MAX_VALUE;
        try {
            String raw = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("data", null);
            JSONObject day = new JSONObject(raw).getJSONObject("days").optJSONObject(today());
            JSONArray items = day == null ? null : day.optJSONArray("items");
            for (int k = 0; items != null && k < items.length(); k++) {
                JSONObject it = items.getJSONObject(k);
                for (String key : new String[]{"from", "to"}) {
                    String[] hm = it.optString(key, "").split(":");
                    if (hm.length != 2) continue;
                    Calendar c = (Calendar) now.clone();
                    c.set(Calendar.HOUR_OF_DAY, Integer.parseInt(hm[0]));
                    c.set(Calendar.MINUTE, Integer.parseInt(hm[1]));
                    c.set(Calendar.SECOND, 5);
                    if (c.after(now) && c.getTimeInMillis() < best) best = c.getTimeInMillis();
                }
            }
        } catch (Exception ignored) { }
        if (best == Long.MAX_VALUE) {
            Calendar c = (Calendar) now.clone();
            c.add(Calendar.DAY_OF_MONTH, 1);
            c.set(Calendar.HOUR_OF_DAY, 0);
            c.set(Calendar.MINUTE, 1);
            c.set(Calendar.SECOND, 0);
            best = c.getTimeInMillis();
        }
        return best;
    }
}
