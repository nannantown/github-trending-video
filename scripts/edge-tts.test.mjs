import { test } from "node:test";
import assert from "node:assert/strict";
import { secMsGecV2 } from "./edge-tts.mjs";

// Expected values from rany2/edge-tts v7.3.1 drm.generate_sec_ms_gec_v2(t) (Python reference).
test("Sec-MS-GEC v2 matches the edge-tts reference implementation", () => {
  assert.equal(secMsGecV2(0), "52BC7A17B50DFEC9-28C4394775C8751CD2F6859C030C06DB1489ACAB3B3A7651831FC26895177ED6");
  assert.equal(secMsGecV2(1700000000), "2CD23A2CA0B2595A-F3C846C370E05F9CC83ACC5F995C5F5D87A4D0F14CE8936A0F902E64099E38A2");
  assert.equal(secMsGecV2(1761300000.5), "FB5DBA9FF3D535F8-C63AE68E039A9D5A9ADD9FA6648858E3F6A6E20D99B3E279E5440EBEA674C198");
  assert.equal(secMsGecV2(1793000000), "781C1B76C9F739B3-1A772624F17530DF13FBF300637917F70D55C163861ADEC2DA70A248A0DE438A");
});

test("Sec-MS-GEC v2 is stable within a 5-minute window", () => {
  assert.equal(secMsGecV2(1700000050), secMsGecV2(1700000000));
  assert.notEqual(secMsGecV2(1700000100), secMsGecV2(1700000000));
});
