// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(target_os = "linux")]
fn env_flag_enabled(name: &str) -> bool {
    matches!(
        std::env::var(name).ok().as_deref(),
        Some("1")
            | Some("true")
            | Some("TRUE")
            | Some("yes")
            | Some("YES")
            | Some("on")
            | Some("ON")
    )
}

#[cfg(target_os = "linux")]
fn is_niri_session() -> bool {
    if std::env::var_os("NIRI_SOCKET").is_some() {
        return true;
    }

    std::env::var("XDG_CURRENT_DESKTOP")
        .map(|value| value.to_ascii_lowercase().contains("niri"))
        .unwrap_or(false)
}

#[cfg(target_os = "linux")]
fn is_wayland_session() -> bool {
    if std::env::var_os("WAYLAND_DISPLAY").is_some() {
        return true;
    }

    std::env::var("XDG_SESSION_TYPE")
        .map(|value| value.eq_ignore_ascii_case("wayland"))
        .unwrap_or(false)
}

#[cfg(target_os = "linux")]
fn set_env_if_missing(key: &str, value: &str) {
    if std::env::var_os(key).is_some() {
        return;
    }

    std::env::set_var(key, value);
    eprintln!("[OtoMusic] set {key}={value}");
}

#[cfg(target_os = "linux")]
fn configure_linux_runtime_workarounds() {
    if env_flag_enabled("OTOMUSIC_DISABLE_WEBKIT_WORKAROUND") {
        return;
    }

    let force = env_flag_enabled("OTOMUSIC_FORCE_WEBKIT_WORKAROUND");
    let wayland = is_wayland_session();
    let niri = is_niri_session();
    let should_apply = force || wayland || niri;
    if !should_apply {
        return;
    }

    if force || wayland || niri {
        set_env_if_missing("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }

    if force || niri {
        set_env_if_missing("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
    }
}

fn main() {
    #[cfg(target_os = "linux")]
    configure_linux_runtime_workarounds();

    otomusic_lib::run();
}
