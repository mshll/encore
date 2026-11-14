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

export type SpotifyArtist = { id: string; name: string; images?: SpotifyImage[] };

export type SpotifyDevice = {
  id: string | null;
  is_active: boolean;
  is_restricted: boolean;
  name: string;
  type: string;
  volume_percent: number | null;
};

export type SpotifyContext = { uri: string; type: string };

export type PlaybackState = {
  device: SpotifyDevice;
  shuffle_state: boolean;
  repeat_state: "off" | "track" | "context";
  timestamp: number;
  progress_ms: number | null;
  is_playing: boolean;
  currently_playing_type: "track" | "episode" | "ad" | "unknown";
  item: SpotifyTrack | null;
  context: SpotifyContext | null;
};

export type PlaybackQueue = { currently_playing: SpotifyTrack | null; queue: SpotifyTrack[] };

export type Page<T> = { items: T[]; next: string | null; total: number; offset: number; limit: number };

export type SavedTrack = { added_at: string; track: SpotifyTrack };

export type SimplifiedPlaylist = {
  id: string;
  uri: string;
  name: string;
  snapshot_id: string;
  owner: { id: string };
  items?: { total: number };
  tracks?: { total: number };
};

export type PlaylistEntry = { added_at: string | null; is_local?: boolean; item?: SpotifyTrack | null; track?: SpotifyTrack | null };

export type SimplifiedAlbum = {
  id: string;
  uri: string;
  name: string;
  album_type: string;
  release_date: string;
  release_date_precision: "year" | "month" | "day";
  total_tracks: number;
  images?: SpotifyImage[];
  artists: { id: string; name: string }[];
};
