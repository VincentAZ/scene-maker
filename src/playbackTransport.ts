/** Playback transport state around route planning. Planning pauses playback
 * so no stale route is shown; a playback the planner interrupted resumes by
 * itself once planning settles, unless the creator used the transport in
 * between, a cast conversation owns playback, or the project changed. */
export function createPlaybackTransport(apply: (playing: boolean) => void) {
  let playing = false;
  let resume = false;
  return {
    get playing() {
      return playing;
    },
    get resumePending() {
      return resume;
    },
    /** Explicit transport use (Play, Pause, Rewind, a new project). */
    setPlaying(value: boolean | ((current: boolean) => boolean)) {
      resume = false;
      playing = typeof value === "function" ? value(playing) : value;
      apply(playing);
    },
    /** Planning started while playing: pause and remember to resume. */
    pauseForPlanning() {
      if (playing) resume = true;
      playing = false;
      apply(false);
    },
    /** Planning finished for the current scene. A conversation keeps its own
     * resume; a superseded job never reaches this point. */
    planningSettled(conversationActive = false) {
      if (!resume || conversationActive) return;
      resume = false;
      playing = true;
      apply(true);
    },
    /** Something else owns playback now (project switch, conversation end). */
    cancelResume() {
      resume = false;
    },
  };
}
