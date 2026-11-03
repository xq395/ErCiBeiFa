package com.beifa.kaoyan;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

/** 计时器到点通知。App 被切到后台、锁屏时也会响。 */
public class AlarmReceiver extends BroadcastReceiver {

    private static PendingIntent pending(Context ctx, String title, String body) {
        Intent i = new Intent(ctx, AlarmReceiver.class);
        if (title != null) i.putExtra("title", title);
        if (body != null) i.putExtra("body", body);
        return PendingIntent.getBroadcast(ctx, 1, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static void schedule(Context ctx, long at, String title, String body) {
        AlarmManager am = ctx.getSystemService(AlarmManager.class);
        PendingIntent pi = pending(ctx, title, body);
        boolean exact = Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms();
        if (exact) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
        else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
    }

    static void cancel(Context ctx) {
        ctx.getSystemService(AlarmManager.class).cancel(pending(ctx, null, null));
    }

    @Override
    public void onReceive(Context ctx, Intent i) {
        Intent open = new Intent(ctx, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(ctx, 2, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification n = new Notification.Builder(ctx, MainActivity.CHANNEL)
                .setSmallIcon(R.drawable.ic_stat)
                .setContentTitle(i.getStringExtra("title") == null ? "40 分钟到了" : i.getStringExtra("title"))
                .setContentText(i.getStringExtra("body") == null ? "回到 App 结束并记录" : i.getStringExtra("body"))
                .setContentIntent(pi)
                .setAutoCancel(true)
                .setCategory(Notification.CATEGORY_ALARM)
                .build();
        try {
            ctx.getSystemService(NotificationManager.class).notify(1, n);
        } catch (SecurityException ignored) { /* 用户关了通知权限 */ }
    }
}
