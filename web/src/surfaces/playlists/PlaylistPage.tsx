import { LivingPage, PlaylistMissing } from "./LivingPage";
import { SetPage } from "./SetPage";
import { isLivingId } from "./shared";

/** `/playlists/:id`: a set (`set-12`), a built-in kind or a rule playlist, each on the one playlist template. */
export function PlaylistPage({ id }: { id: string }) {
  const setId = id.match(/^set-(\d+)$/)?.[1];
  if (setId) return <SetPage key={id} id={Number(setId)} />;
  if (isLivingId(id)) return <LivingPage key={id} id={id} />;
  return <PlaylistMissing />;
}
