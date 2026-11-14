export const artistPath = (name: string) => `/music/artist/${encodeURIComponent(name)}`;
export const songPath = (songKey: string) => `/music/song/${encodeURIComponent(songKey)}`;
export const albumPath = (artist: string, album: string) => `/music/album/${encodeURIComponent(artist)}/${encodeURIComponent(album)}`;
