//! System Trace core library. The binary (`main.rs`) is a thin entry point that
//! calls `run()`. Splitting into a lib lets `cargo test` exercise the pure core
//! (collector state machine, aggregation, migrations) without the OS watchers.

// The `objc` 0.2 crate uses a legacy `cfg(feature = "cargo-clippy")` check in
// its `msg_send!` / `class!` macros that trips the newer `unexpected_cfgs`
// lint. The lint fires inside the expanded macro, so it has to be allowed at
// the crate root (module-level `#![allow]` does not reach into upstream
// macro expansions).
#![allow(unexpected_cfgs)]

pub mod blocker;
pub mod collector;
pub mod commands;
pub mod db;
pub mod grayscale;
pub mod models;
pub mod platform;
pub mod state;

use state::{AppState, Shared};
use std::sync::{Arc, Mutex};
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::TrayIconBuilder;
use tauri::Manager;
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};

/// Build and run the System Trace desktop app.
pub fn run() {
    // Test mode is opt-in via env var; gates both the WDIO plugin (so
    // production builds don't load it) and the data-isolation hooks inside
    // `.setup()`.
    let is_test = std::env::var("SYSTEM_TRACE_TEST_MODE").is_ok();

    let mut builder = tauri::Builder::default()
        // Single instance must be registered first: a second launch focuses the
        // existing window instead of starting a new collector.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build());

    // Only load the WDIO bridge during E2E runs. End-user installs never see it.
    if is_test {
        builder = builder.plugin(tauri_plugin_wdio::init());
    }

    builder
        .setup(move |app| {
            // Local database in the OS app-data directory (no cloud).
            let dir = app
                .path()
                .app_data_dir()
                .expect("could not resolve app data dir");

            let db_path = if is_test {
                std::env::temp_dir().join("system-trace-test.sqlite")
            } else {
                dir.join("system-trace.sqlite")
            };

            // If it's a new test run, we might want to wipe the test DB.
            if is_test && db_path.exists() {
                let _ = std::fs::remove_file(&db_path);
            }

            let conn = db::open(&db_path).expect("failed to open database");

            // In E2E test mode the database is fresh each run, which would
            // otherwise drop the app on the first-run onboarding screen and
            // hide the dashboard the smoke tests assert on. Mark onboarding
            // complete so test mode boots straight to the dashboard.
            if is_test {
                let _ = db::set_setting(&conn, "onboarding_complete", "true");
            }

            let settings = db::get_settings(&conn).expect("failed to read settings");
            // Trim raw events past the retention window on startup.
            let _ = db::trim_old_events(&conn, settings.retention_days);

            // Apply the launch-at-login preference (skip in test mode).
            if !is_test {
                let mgr = app.autolaunch();
                if settings.launch_at_login {
                    let _ = mgr.enable();
                } else {
                    let _ = mgr.disable();
                }
            }

            let tracking_paused = if is_test {
                true
            } else {
                settings.tracking_paused
            };

            let shared = Arc::new(Mutex::new(Shared::new(
                settings.idle_threshold_secs as u64 * 1000,
                settings.capture_titles,
                tracking_paused,
            )));
            let db = Arc::new(Mutex::new(conn));

            app.manage(AppState {
                db: db.clone(),
                shared: shared.clone(),
                db_path: db_path.clone(),
            });

            // Register the global pause/resume hotkey (default Ctrl+Alt+P).
            // Toggling shared.paused is enough: the collector reads it every
            // loop and the UI catches up on the next usage_tick.
            {
                use tauri_plugin_global_shortcut::{
                    Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState,
                };
                let hotkey = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyP);
                let shared_for_key = shared.clone();
                let gs = app.global_shortcut();
                let reg = gs.on_shortcut(hotkey, move |_app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        if let Ok(mut s) = shared_for_key.lock() {
                            s.paused = !s.paused;
                            s.state = if s.paused {
                                crate::models::CollectorState::Paused
                            } else {
                                crate::models::CollectorState::Idle
                            };
                            if s.paused {
                                s.active_app = None;
                            }
                        }
                    }
                });
                if let Err(e) = reg {
                    log::warn!("could not register pause hotkey: {e}");
                }
            }

            // Hide the window on autostart-from-boot launches (the autostart
            // plugin passes "--minimized") or when the user picked
            // "Start minimized to tray" in Settings. The collector is already
            // spinning at this point, so tracing continues either way.
            let launched_minimized = std::env::args().any(|a| a == "--minimized");
            if launched_minimized || settings.start_minimized {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.hide();
                }
            }

            // System tray with Show / Quit.
            let show = MenuItemBuilder::with_id("show", "Show System Trace").build(app)?;
            let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
            let menu = MenuBuilder::new(app).items(&[&show, &quit]).build()?;
            let _tray = TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("System Trace")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            // The whole point of System Trace is to keep tracing in the
            // background even after the user dismisses the window. Without
            // this handler, clicking the X tears the window down and Tauri
            // exits the process, which kills the collector. Hide the main
            // window instead and rely on the tray's Quit item for a real
            // exit. Child windows (none today) still close normally.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_today_overview,
            commands::get_range_overview,
            commands::get_day_overview,
            commands::get_focus_score,
            commands::get_category_goals,
            commands::set_category_goal,
            commands::remove_category_goal,
            commands::get_goal_streaks,
            commands::search_usage,
            commands::save_focus_session,
            commands::list_focus_sessions,
            commands::backup_database,
            commands::restore_database,
            commands::get_apps,
            commands::set_app_category,
            commands::get_categories,
            commands::upsert_category,
            commands::delete_category,
            commands::get_settings,
            commands::set_setting,
            commands::get_exclusions,
            commands::add_exclusion,
            commands::remove_exclusion,
            commands::export_data,
            commands::import_data,
            commands::wipe_all_data,
            commands::get_collector_state,
            commands::set_tracking_paused,
            commands::get_limits,
            commands::set_limit,
            commands::remove_limit,
            commands::get_block_rules,
            commands::set_block_rule,
            commands::remove_block_rule,
            commands::start_focus_session,
            commands::stop_focus_session,
            commands::get_focus_state,
            commands::apply_website_block,
            commands::clear_website_block,
        ])
        .run(tauri::generate_context!())
        .expect("error while running System Trace");
}
