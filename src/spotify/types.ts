export type SpotifyImage = { url: string; width: number | null; height: number | null };

export type SpotifyTrack = {
  id: string;
  uri: string;
  name: string;
  duration_ms: number;
  artists: { id: string; name: string; uri: string }[];
  album: { id: string; name: string; release_date?: string; images?: SpotifyImage[] };
};

export type RecentlyPlayed = {
  items: { track: SpotifyTrack; played_at: string; context: { uri: string; type: string } | null }[];
};

export type SpotifyMe = { id: string; display_name: string | null };

export type SpotifySearch = { tracks: { items: SpotifyTrack[] } };

export type SpotifyPlaylist = { id: string; external_urls: { spotify: string } };
