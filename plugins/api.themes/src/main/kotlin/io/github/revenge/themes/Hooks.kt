package io.github.revenge.themes

import de.robv.android.xposed.XC_MethodHook
import de.robv.android.xposed.XposedBridge
import java.lang.reflect.Method

internal fun ClassLoader.loadClassOrNull(name: String): Class<*>? = try {
    loadClass(name)
} catch (_: ClassNotFoundException) {
    null
}

internal inline fun Method.hookBefore(
    crossinline block: XC_MethodHook.MethodHookParam.() -> Unit,
): XC_MethodHook.Unhook = XposedBridge.hookMethod(this, object : XC_MethodHook() {
    override fun beforeHookedMethod(param: MethodHookParam) = param.block()
})

internal inline fun Method.hookAfter(
    crossinline block: XC_MethodHook.MethodHookParam.() -> Unit,
): XC_MethodHook.Unhook = XposedBridge.hookMethod(this, object : XC_MethodHook() {
    override fun afterHookedMethod(param: MethodHookParam) = param.block()
})
