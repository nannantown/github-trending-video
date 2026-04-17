import { Config } from "@remotion/cli/config";

Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
// Instagram rejects the default yuvj420p (JPEG full-range) output. Force the
// TV-range yuv420p pixel format so Reels uploads don't need a post-render
// re-encode pass.
Config.setPixelFormat("yuv420p");
