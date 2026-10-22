// Shared composer mode state: the message being edited (composer mirrors
// its text) and the message the composer will reply to. A single module
// keeps actions/composer/main on the same bindings without import cycles.
export const composerState = { editingMsg: null, replyTarget: null };
