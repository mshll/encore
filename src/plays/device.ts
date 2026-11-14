import type { Device } from "../db/schema";

const rules: [RegExp, Device][] = [
  [/playstation|ps4|ps5|xbox|nintendo/i, "console"],
  [/carplay|android_auto|\bcar\b/i, "car"],
  [/sonos|speaker|google_home|amazon|alexa|echo/i, "speaker"],
  [/\btv\b|_tv|chromecast|roku|tizen|webos/i, "tv"],
  [/ios|iphone|ipad/i, "ios"],
  [/android/i, "android"],
  [/osx|macos|mac os/i, "mac"],
  [/windows/i, "windows"],
  [/linux/i, "linux"],
  [/web_player|web player|\bweb\b/i, "web"],
];

export function deviceFromPlatform(platform: string | null | undefined): Device {
  if (!platform || platform.trim().toLowerCase() === "unknown") return "unknown";
  return rules.find(([pattern]) => pattern.test(platform))?.[1] ?? "other";
}

const spotifyTypes: Record<string, Device> = {
  speaker: "speaker",
  avr: "speaker",
  castaudio: "speaker",
  tv: "tv",
  stb: "tv",
  castvideo: "tv",
  gameconsole: "console",
  automobile: "car",
};

export function deviceFromSpotify(type: string, name: string): Device {
  const byType = spotifyTypes[type.toLowerCase()];
  if (byType) return byType;
  const byName = deviceFromPlatform(name);
  if (byName !== "unknown" && byName !== "other") return byName;
  if (type.toLowerCase() === "computer") return /\bmac/i.test(name) ? "mac" : "other";
  return type.toLowerCase() === "smartphone" ? "other" : "unknown";
}
