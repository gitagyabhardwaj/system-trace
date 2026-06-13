import { useEffect, useState, type ReactNode } from "react";
import {
  Plus,
  Trash2,
  Download,
  Upload,
  AlertTriangle,
  Save,
  RotateCcw,
  RefreshCw,
  Keyboard,
} from "lucide-react";
import { save, open } from "@tauri-apps/plugin-dialog";
import {
  addExclusion,
  backupDatabase,
  exportData,
  getExclusions,
  getSettings,
  importData,
  isTauri,
  removeExclusion,
  restoreDatabase,
  setSetting,
  wipeAllData,
} from "../lib/api";
import { checkForUpdate } from "../lib/update";
import { LANGUAGES, setLanguage } from "../lib/i18n";
import type {
  ExclusionMatchType,
  ExportFormat,
  Exclusion,
  Settings as SettingsModel,
  SettingKey,
  SummaryCadence,
  ThemePreference,
} from "../lib/types";
import { useTheme } from "../theme/ThemeProvider";
import { Card, CardTitle, Segmented, Toggle, cx } from "../components/ui";

const PALETTES: { value: string; label: string; swatch: string }[] = [
  { value: "signal", label: "Signal", swatch: "#2DD4BF" },
  { value: "slate", label: "Slate", swatch: "#94A3B8" },
  { value: "solar", label: "Solar", swatch: "#FBBF24" },
  { value: "cocoa", label: "Cocoa", swatch: "#C79A6F" },
];

function Row({
  title,
  description,
  control,
}: {
  title: string;
  description?: string;
  control: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-6 px-5 py-3.5">
      <div className="min-w-0">
        <div className="text-body-strong text-text">{title}</div>
        {description ? (
          <div className="text-label text-text-muted">{description}</div>
        ) : null}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <CardTitle>{title}</CardTitle>
      <Card className="divide-y divide-border">{children}</Card>
    </div>
  );
}

export function Settings() {
  const { setTheme, palette, setPalette } = useTheme();
  const [s, setS] = useState<SettingsModel | null>(null);
  const [exclusions, setExclusions] = useState<Exclusion[]>([]);
  const [pattern, setPattern] = useState("");
  const [matchType, setMatchType] = useState<ExclusionMatchType>("app");
  const [status, setStatus] = useState<string | null>(null);
  const [exportFrom, setExportFrom] = useState("");
  const [exportTo, setExportTo] = useState("");

  useEffect(() => {
    getSettings().then(setS).catch(() => {});
    getExclusions().then(setExclusions).catch(() => {});
  }, []);

  function flash(msg: string) {
    setStatus(msg);
    window.setTimeout(() => setStatus(null), 3000);
  }

  function setBool(key: SettingKey & keyof SettingsModel, val: boolean) {
    setS((prev) => (prev ? ({ ...prev, [key]: val } as SettingsModel) : prev));
    setSetting(key, val ? "true" : "false").catch(() => {});
  }

  function setNum(key: SettingKey & keyof SettingsModel, val: number) {
    setS((prev) => (prev ? ({ ...prev, [key]: val } as SettingsModel) : prev));
    setSetting(key, String(val)).catch(() => {});
  }

  function setStr(key: SettingKey & keyof SettingsModel, val: string) {
    setS((prev) => (prev ? ({ ...prev, [key]: val } as SettingsModel) : prev));
    setSetting(key, val).catch(() => {});
  }

  function chooseTheme(t: ThemePreference) {
    setS((prev) => (prev ? { ...prev, theme: t } : prev));
    setTheme(t);
  }

  async function addEx() {
    const p = pattern.trim();
    if (!p) return;
    const created = await addExclusion({ match_type: matchType, pattern: p });
    setExclusions((list) => [...list, created]);
    setPattern("");
  }

  async function removeEx(id: number) {
    await removeExclusion(id);
    setExclusions((list) => list.filter((e) => e.id !== id));
  }

  async function doExport(format: ExportFormat) {
    let path = `system-trace-export.${format}`;
    if (isTauri) {
      const picked = await save({
        defaultPath: path,
        filters: [{ name: format.toUpperCase(), extensions: [format] }],
      });
      if (!picked) return;
      path = picked;
    }
    const from = exportFrom || null;
    const to = exportTo || null;
    const res = await exportData(format, path, from, to);
    const scope = from || to ? " for the chosen range" : "";
    flash(`Exported ${res.rows_written} rows to ${res.format.toUpperCase()}${scope}.`);
  }

  async function doBackup() {
    if (!isTauri) {
      flash("Backup is available in the desktop app.");
      return;
    }
    const picked = await save({
      defaultPath: "system-trace-backup.sqlite",
      filters: [{ name: "SQLite", extensions: ["sqlite"] }],
    });
    if (!picked) return;
    const res = await backupDatabase(picked);
    flash(`Backed up ${(res.bytes / 1024).toFixed(0)} KB.`);
  }

  async function doRestore() {
    if (!isTauri) {
      flash("Restore is available in the desktop app.");
      return;
    }
    const picked = await open({
      multiple: false,
      filters: [{ name: "SQLite", extensions: ["sqlite"] }],
    });
    if (!picked || Array.isArray(picked)) return;
    const ok = window.confirm(
      "Restore will replace your current data with the backup. Continue?",
    );
    if (!ok) return;
    try {
      await restoreDatabase(picked);
      flash("Restored. Please quit and reopen System Trace to load the data.");
    } catch (e) {
      flash(String(e));
    }
  }

  async function doCheckUpdate() {
    flash("Checking for updates...");
    try {
      const info = await checkForUpdate();
      if (info.update_available) {
        flash(`Update available: v${info.latest} (you have v${info.current}).`);
      } else {
        flash(`You are on the latest version (v${info.current}).`);
      }
    } catch (e) {
      flash(`Could not check for updates: ${String(e)}`);
    }
  }

  async function doImport() {
    if (!isTauri) {
      flash("Import is available in the desktop app.");
      return;
    }
    const picked = await open({
      multiple: false,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (!picked || Array.isArray(picked)) return;
    const res = await importData(picked);
    flash(`Merged ${res.events_merged} events across ${res.days_affected} days.`);
  }

  async function doWipe() {
    const ok = window.confirm(
      "Delete ALL local data (events, apps, exclusions)? This cannot be undone.",
    );
    if (!ok) return;
    await wipeAllData();
    flash("All local data deleted.");
  }

  if (!s) return null;

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-10">
      {status ? (
        <div className="rounded-md border border-accent/40 bg-accent/10 px-4 py-2 text-body text-text">
          {status}
        </div>
      ) : null}

      <Section title="Appearance">
        <Row
          title="Theme"
          description="System follows your OS setting."
          control={
            <Segmented<ThemePreference>
              value={s.theme}
              onChange={chooseTheme}
              options={[
                { value: "system", label: "System" },
                { value: "light", label: "Light" },
                { value: "dark", label: "Dark" },
              ]}
            />
          }
        />
        <Row
          title="Accent palette"
          description="The highlight color used across charts and buttons."
          control={
            <div className="flex gap-1.5" role="group" aria-label="Accent palette">
              {PALETTES.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setPalette(p.value)}
                  aria-pressed={palette === p.value}
                  title={p.label}
                  className={cx(
                    "flex h-8 w-8 items-center justify-center rounded-full border-2",
                    palette === p.value ? "border-text" : "border-transparent",
                  )}
                >
                  <span
                    className="h-5 w-5 rounded-full"
                    style={{ backgroundColor: p.swatch }}
                    aria-hidden
                  />
                </button>
              ))}
            </div>
          }
        />
        <Row
          title="Language"
          description="More languages are community-contributed."
          control={
            <select
              value={s.language}
              onChange={(e) => {
                setStr("language", e.target.value);
                setLanguage(e.target.value);
              }}
              aria-label="Language"
              className="rounded-md border border-border bg-bg px-2 py-1.5 text-body text-text"
            >
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          }
        />
      </Section>

      <Section title="Tracking">
        <Row
          title="Idle threshold"
          description="Seconds of no input before time stops counting."
          control={
            <input
              type="number"
              min={15}
              max={3600}
              value={s.idle_threshold_secs}
              onChange={(e) => setNum("idle_threshold_secs", Number(e.target.value))}
              className="w-24 rounded-md border border-border bg-bg px-2 py-1.5 text-body text-text"
            />
          }
        />
        <Row
          title="Capture window titles"
          description="Off by default for privacy. Titles can contain private text."
          control={
            <Toggle checked={s.capture_titles} onChange={(v) => setBool("capture_titles", v)} />
          }
        />
        <Row
          title="Productivity scoring"
          description="Optional. Adds a Focus Score and productive/distracting labels."
          control={
            <Toggle checked={s.scoring_enabled} onChange={(v) => setBool("scoring_enabled", v)} />
          }
        />
        <Row
          title="Summary notifications"
          description="A recap of your screen time: off, daily, weekly, or both. Catches up if the app was closed."
          control={
            <Segmented<SummaryCadence>
              options={[
                { value: "off", label: "Off" },
                { value: "daily", label: "Daily" },
                { value: "weekly", label: "Weekly" },
                { value: "both", label: "Both" },
              ]}
              value={s.summary_cadence}
              onChange={(v) => setStr("summary_cadence", v)}
            />
          }
        />
      </Section>

      <Section title="Startup">
        <Row
          title="Launch at login"
          control={
            <Toggle checked={s.launch_at_login} onChange={(v) => setBool("launch_at_login", v)} />
          }
        />
        <Row
          title="Start minimized to tray"
          control={
            <Toggle checked={s.start_minimized} onChange={(v) => setBool("start_minimized", v)} />
          }
        />
      </Section>

      <Section title="Privacy and data">
        <Row
          title="Keep raw events for"
          description="Daily summaries are kept forever; raw events older than this are trimmed."
          control={
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={7}
                max={3650}
                value={s.retention_days}
                onChange={(e) => setNum("retention_days", Number(e.target.value))}
                className="w-24 rounded-md border border-border bg-bg px-2 py-1.5 text-body text-text"
              />
              <span className="text-body text-text-muted">days</span>
            </div>
          }
        />

        <div className="px-5 py-3.5">
          <div className="text-body-strong text-text">Exclusions</div>
          <div className="text-label text-text-muted">
            Apps or window titles that are never tracked.
          </div>
          <div className="mt-3 flex gap-2">
            <select
              value={matchType}
              onChange={(e) => setMatchType(e.target.value as ExclusionMatchType)}
              className="rounded-md border border-border bg-bg px-2 py-1.5 text-body text-text"
            >
              <option value="app">App is</option>
              <option value="title_contains">Title contains</option>
            </select>
            <input
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              placeholder={matchType === "app" ? "e.g. 1password.exe" : "e.g. Incognito"}
              className="flex-1 rounded-md border border-border bg-bg px-3 py-1.5 text-body text-text placeholder:text-text-muted"
            />
            <button
              type="button"
              onClick={addEx}
              className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-body-strong text-white"
            >
              <Plus className="h-4 w-4" aria-hidden /> Add
            </button>
          </div>
          {exclusions.length > 0 ? (
            <ul className="mt-3 space-y-1.5">
              {exclusions.map((e) => (
                <li
                  key={e.id}
                  className="flex items-center justify-between rounded-md border border-border bg-bg px-3 py-2 text-body"
                >
                  <span className="text-text">
                    <span className="text-text-muted">
                      {e.match_type === "app" ? "App is " : "Title contains "}
                    </span>
                    {e.pattern}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeEx(e.id)}
                    className="text-text-muted hover:text-negative"
                    aria-label={`Remove exclusion ${e.pattern}`}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="px-5 py-3.5">
          <div className="text-body-strong text-text">Export your data</div>
          <div className="text-label text-text-muted">
            A copy of your events. Leave the dates empty to export everything.
          </div>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-label text-text-muted">From</span>
              <input
                type="date"
                value={exportFrom}
                onChange={(e) => setExportFrom(e.target.value)}
                className="rounded-md border border-border bg-bg px-2 py-1.5 text-body text-text"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-label text-text-muted">To</span>
              <input
                type="date"
                value={exportTo}
                onChange={(e) => setExportTo(e.target.value)}
                className="rounded-md border border-border bg-bg px-2 py-1.5 text-body text-text"
              />
            </label>
            <button
              type="button"
              onClick={() => doExport("csv")}
              className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-body-strong text-text hover:bg-surface-2"
            >
              <Download className="h-4 w-4" aria-hidden /> CSV
            </button>
            <button
              type="button"
              onClick={() => doExport("json")}
              className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-body-strong text-text hover:bg-surface-2"
            >
              <Download className="h-4 w-4" aria-hidden /> JSON
            </button>
          </div>
        </div>
        <Row
          title="Import data"
          description="Merge a JSON export from another computer."
          control={
            <button
              type="button"
              onClick={doImport}
              className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-body-strong text-text hover:bg-surface-2"
            >
              <Upload className="h-4 w-4" aria-hidden /> Import
            </button>
          }
        />
        <Row
          title="Backup and restore"
          description="A full snapshot of your local database. Restore replaces current data."
          control={
            <div className="flex gap-2">
              <button
                type="button"
                onClick={doBackup}
                className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-body-strong text-text hover:bg-surface-2"
              >
                <Save className="h-4 w-4" aria-hidden /> Backup
              </button>
              <button
                type="button"
                onClick={doRestore}
                className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-body-strong text-text hover:bg-surface-2"
              >
                <RotateCcw className="h-4 w-4" aria-hidden /> Restore
              </button>
            </div>
          }
        />
      </Section>

      <Section title="Updates and shortcuts">
        <Row
          title="Pause / resume hotkey"
          description="Toggle tracking from anywhere with this global shortcut."
          control={
            <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-bg px-2.5 py-1.5 text-label text-text-muted">
              <Keyboard className="h-4 w-4" aria-hidden /> Ctrl + Alt + P
            </span>
          }
        />
        <Row
          title="Check for updates"
          description="Asks GitHub for the latest version. Nothing is sent."
          control={
            <button
              type="button"
              onClick={doCheckUpdate}
              className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-body-strong text-text hover:bg-surface-2"
            >
              <RefreshCw className="h-4 w-4" aria-hidden /> Check
            </button>
          }
        />
      </Section>

      <Section title="Danger zone">
        <Row
          title="Delete all data"
          description="Permanently remove every event, app, and exclusion."
          control={
            <button
              type="button"
              onClick={doWipe}
              className={cx(
                "flex items-center gap-1.5 rounded-md border border-negative/50 px-3 py-1.5 text-body-strong text-negative",
                "hover:bg-negative/10",
              )}
            >
              <AlertTriangle className="h-4 w-4" aria-hidden /> Delete everything
            </button>
          }
        />
      </Section>
    </div>
  );
}
