use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{
  menu::{MenuBuilder, MenuItemBuilder},
  tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
  Emitter, Manager, WindowEvent,
};

static IS_QUITTING: AtomicBool = AtomicBool::new(false);

#[allow(dead_code)]
struct TrayState {
  tray: tauri::tray::TrayIcon,
}

fn emit_tray_action(app: &tauri::AppHandle, action: &str) {
  let _ = app.emit("tray-action", action.to_string());
}

fn show_main_window(app: &tauri::AppHandle) {
  if let Some(window) = app.get_webview_window("main") {
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
  }
}

fn setup_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
  let show = MenuItemBuilder::with_id("show", "显示主窗口").build(app)?;
  let play_pause = MenuItemBuilder::with_id("play-pause", "播放 / 暂停").build(app)?;
  let previous = MenuItemBuilder::with_id("previous", "上一首").build(app)?;
  let next = MenuItemBuilder::with_id("next", "下一首").build(app)?;
  let quit = MenuItemBuilder::with_id("quit", "退出 OtoMusic").build(app)?;

  let menu = MenuBuilder::new(app)
    .items(&[&show, &play_pause, &previous, &next, &quit])
    .build()?;

  let tray = TrayIconBuilder::new()
    .menu(&menu)
    .tooltip("OtoMusic")
    .show_menu_on_left_click(false)
    .on_menu_event(|app, event| match event.id().as_ref() {
      "show" => {
        show_main_window(app);
        emit_tray_action(app, "show");
      }
      "play-pause" => emit_tray_action(app, "play-pause"),
      "previous" => emit_tray_action(app, "previous"),
      "next" => emit_tray_action(app, "next"),
      "quit" => {
        IS_QUITTING.store(true, Ordering::SeqCst);
        app.exit(0);
      }
      _ => {}
    })
    .on_tray_icon_event(|tray, event| {
      if let TrayIconEvent::Click {
        button: MouseButton::Left,
        button_state: MouseButtonState::Up,
        ..
      } = event
      {
        show_main_window(tray.app_handle());
      }
    })
    .build(app)?;

  app.manage(TrayState { tray });

  Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      setup_tray(&app.handle())?;
      Ok(())
    })
    .on_window_event(|window, event| {
      if window.label() != "main" {
        return;
      }

      if let WindowEvent::CloseRequested { api, .. } = event {
        if IS_QUITTING.load(Ordering::SeqCst) {
          return;
        }

        api.prevent_close();
        let _ = window.hide();
      }
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
