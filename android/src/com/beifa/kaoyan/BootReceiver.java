package com.beifa.kaoyan;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** 开机、App 升级后重新排小组件的刷新闹钟 */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent i) {
        TodayWidget.refreshAll(ctx);
    }
}
