/**
 * Kill switches for the 2026-09-14 YouTube distribution experiment.
 *
 * Set as repo Variables (Settings → Secrets and variables → Actions →
 * Variables) and passed to the pipeline by daily-video.yml:
 *   YT_TITLE_TEMPLATE  per-day title + description   (off = legacy metadata)
 *   YT_OPENING_HOOK    YouTube-only TOP1 opening     (off = shared video)
 *   YT_SET_THUMBNAIL   thumbnails.set on the upload  (off = auto thumbnail)
 *
 * Fail-safe towards the pre-experiment behaviour: a feature is ON only when
 * its Variable is unset/empty or an explicit "on" value. "false", "off",
 * "standard" — and any unrecognized value such as a typo — turn it OFF
 * (unrecognized values also log a warning). Never throws: a bad Variable must
 * not stop the morning post.
 */

const ON_VALUES = new Set(["", "true", "on", "1", "yes", "top1"]);
const OFF_VALUES = new Set(["false", "off", "0", "no", "standard"]);

export function switchOn(value, name, warn = console.warn) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (ON_VALUES.has(normalized)) return true;
  if (!OFF_VALUES.has(normalized)) {
    warn(
      `Unrecognized ${name}="${value}" — treated as off (pre-experiment behaviour). Leave unset for on, or use "false" for off.`
    );
  }
  return false;
}
