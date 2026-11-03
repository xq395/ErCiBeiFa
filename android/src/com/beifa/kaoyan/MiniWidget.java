package com.beifa.kaoyan;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;

import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Locale;

/** 最简单的小组件：一行字（日期 + 进度），点击打开 App。布局越简单，越不容易被桌面过滤掉。 */
public class MiniWidget extends AppWidgetProvider {
    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) mgr.updateAppWidget(id, build(ctx));
    }

    static void refreshAll(Context ctx) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        for (int id : mgr.getAppWidgetIds(new ComponentName(ctx, MiniWidget.class))) mgr.updateAppWidget(id, build(ctx));
    }

    static RemoteViews build(Context ctx) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_mini);
        Intent i = new Intent(ctx, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        v.setOnClickPendingIntent(R.id.m_root, PendingIntent.getActivity(ctx, 20, i,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        String text = "北伐打卡";
        try {
            Calendar c = Calendar.getInstance();
            String d = new SimpleDateFormat("yyyy-MM-dd", Locale.CHINA).format(c.getTime());
            String raw = ctx.getSharedPreferences(TodayWidget.PREFS, Context.MODE_PRIVATE).getString("data", null);
            JSONObject day = new JSONObject(raw).getJSONObject("days").optJSONObject(d);
            if (day != null) text = day.optString("title") + "\n" + day.optString("stat");
        } catch (Exception ignored) { }
        v.setTextViewText(R.id.m_text, text);
        return v;
    }
}
